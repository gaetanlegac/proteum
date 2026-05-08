const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TEST_PROMPT = `Follow this project's agent instructions exactly.

Do a read-only runtime orientation and health pass for this app.

1. Confirm the intended app/worktree and whether exactly one usable dev server is running for it. If no usable dev server exists, start one using the project's prescribed dev-session workflow. Do not start a second live server for the same worktree.
2. Report compact runtime status: app root, dev URL, package manager, route count, controller count, connected apps, and manifest freshness.
3. Resolve selected project instruction files and briefly say why each one was selected.
4. Pick one real browser route from the compact project map, prefer a public route; explain which page/controller owns it, then reproduce one request to that route.
5. Diagnose that request and summarize only the important result: status, owner, hot calls, SQL count, error events, and likely next action.
6. Show the latest trace/perf summary for that same request or route, capped to the smallest useful detail.
7. Include recent dev log lines only if they explain a warning or failure.
8. Do not edit files. Do not run broad tests unless the runtime evidence points to a concrete failure.

Return a compact report with:
- Runtime
- Selected Instructions
- Route Owner
- Diagnosis
- Trace/Perf
- Any Follow-up Needed
`;

const enabled = process.env.PROTEUM_RUN_CODEX_MCP_USAGE_TEST === '1';
const codexUsageTest = enabled ? test : test.skip;

const parsePositiveInteger = (value, fallback) => {
	const parsed = Number.parseInt(String(value || ''), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createOutputDir = () => {
	const configured = process.env.PROTEUM_CODEX_MCP_USAGE_OUTPUT_DIR;
	if (configured) {
		fs.mkdirSync(configured, { recursive: true });
		return configured;
	}

	return fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-codex-mcp-usage-'));
};

const runCodex = async ({ appRoot, codexCli, outputDir, timeoutMs }) =>
	await new Promise((resolve, reject) => {
		const lastMessageFile = path.join(outputDir, 'last-message.md');
		const child = spawn(
			codexCli,
			[
				'exec',
				'--json',
				'--color',
				'never',
				'--cd',
				appRoot,
				'--skip-git-repo-check',
				'--sandbox',
				'workspace-write',
				'--ask-for-approval',
				'never',
				'--output-last-message',
				lastMessageFile,
				'-',
			],
			{
				cwd: appRoot,
				env: {
					...process.env,
					NO_COLOR: '1',
				},
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		);
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			setTimeout(() => child.kill('SIGKILL'), 5000).unref();
		}, timeoutMs);

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.stdin.end(TEST_PROMPT);
		child.once('error', reject);
		child.once('close', (status) => {
			clearTimeout(timeout);
			resolve({
				lastMessage: fs.existsSync(lastMessageFile) ? fs.readFileSync(lastMessageFile, 'utf8') : '',
				lastMessageFile,
				status,
				stderr,
				stdout,
				timedOut,
			});
		});
	});

const parseJsonl = (content) =>
	content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try {
				return { json: JSON.parse(line), line };
			} catch {
				return { json: undefined, line };
			}
		});

const walk = (value, visitor, seen = new Set()) => {
	if (value === null || value === undefined) return;
	if (typeof value !== 'object') {
		visitor(value, undefined);
		return;
	}
	if (seen.has(value)) return;
	seen.add(value);

	if (Array.isArray(value)) {
		for (const entry of value) walk(entry, visitor, seen);
		return;
	}

	for (const [key, entry] of Object.entries(value)) {
		visitor(entry, key);
		walk(entry, visitor, seen);
	}
};

const tokenKeys = {
	cached: ['cached_input_tokens', 'cachedInputTokens', 'cached_tokens'],
	input: ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'],
	output: ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'],
	reasoning: ['reasoning_tokens', 'reasoningTokens', 'reasoning_output_tokens', 'reasoningOutputTokens'],
	total: ['total_tokens', 'totalTokens'],
};

const getNumericTokenField = (object, keys) => {
	for (const key of keys) {
		if (typeof object[key] === 'number' && Number.isFinite(object[key])) return object[key];
	}

	return 0;
};

const collectTokenUsage = (events) => {
	const samples = [];

	for (const event of events) {
		walk(event.json, (value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return;
			const sample = {
				cached: getNumericTokenField(value, tokenKeys.cached),
				input: getNumericTokenField(value, tokenKeys.input),
				output: getNumericTokenField(value, tokenKeys.output),
				reasoning: getNumericTokenField(value, tokenKeys.reasoning),
				total: getNumericTokenField(value, tokenKeys.total),
			};
			if (!sample.total) sample.total = sample.input + sample.output;
			if (sample.total || sample.input || sample.output || sample.cached || sample.reasoning) samples.push(sample);
		});
	}

	return samples.reduce(
		(summary, sample) => ({
			cached: Math.max(summary.cached, sample.cached),
			input: Math.max(summary.input, sample.input),
			output: Math.max(summary.output, sample.output),
			reasoning: Math.max(summary.reasoning, sample.reasoning),
			samples: summary.samples + 1,
			total: Math.max(summary.total, sample.total),
		}),
		{ cached: 0, input: 0, output: 0, reasoning: 0, samples: 0, total: 0 },
	);
};

const countByName = (names) =>
	names.reduce((counts, name) => {
		counts[name] = (counts[name] || 0) + 1;
		return counts;
	}, {});

const collectProteumMcpCalls = (events) => {
	const calls = [];

	for (const [index, event] of events.entries()) {
		const names = new Set();
		walk(event.json, (value, key) => {
			if (typeof value !== 'string') return;
			if (!['name', 'toolName', 'tool_name', 'recipient', 'recipient_name'].includes(String(key))) return;

			const match = value.match(/(?:mcp__proteum__|proteum[.:/])([A-Za-z0-9_]+)/);
			if (match) names.add(match[1]);
		});

		if (names.size === 0 && event.line.includes('mcp__proteum__')) {
			for (const match of event.line.matchAll(/mcp__proteum__([A-Za-z0-9_]+)/g)) names.add(match[1]);
		}

		for (const name of names) calls.push({ event: index, name });
	}

	const names = calls.map((call) => call.name);
	return { byName: countByName(names), calls, total: calls.length };
};

const collectProteumCliCalls = (events) => {
	const commands = [];
	const commandPattern = /(?:^|\s)(?:npx\s+)?proteum\s+[A-Za-z0-9:_-]+|node\s+\S*cli\/bin\.js\s+[A-Za-z0-9:_-]+/;

	for (const [index, event] of events.entries()) {
		const eventCommands = new Set();
		walk(event.json, (value, key) => {
			if (typeof value !== 'string') return;
			if (!['cmd', 'command', 'shell', 'args', 'arguments'].includes(String(key))) return;
			const match = value.match(commandPattern);
			if (match) eventCommands.add(match[0].trim());
		});

		for (const command of eventCommands) commands.push({ command, event: index });
	}

	return {
		byCommand: countByName(commands.map((entry) => entry.command)),
		commands,
		total: commands.length,
	};
};

const analyzeCodexOutput = ({ stdout, stderr, lastMessage }) => {
	const events = parseJsonl(stdout);
	const parseErrors = events.filter((event) => !event.json).length;
	const mcpCalls = collectProteumMcpCalls(events);
	const cliCalls = collectProteumCliCalls(events);

	return {
		cliCalls,
		eventCount: events.length,
		lastMessageCharacters: lastMessage.length,
		mcpCalls,
		parseErrors,
		stderrCharacters: stderr.length,
		tokenUsage: collectTokenUsage(events),
	};
};

codexUsageTest('Codex runtime health prompt uses Proteum MCP before CLI fallbacks', async () => {
	const appRoot = process.env.PROTEUM_CODEX_MCP_USAGE_CWD;
	assert.ok(appRoot, 'Set PROTEUM_CODEX_MCP_USAGE_CWD to the Proteum app root to test.');
	assert.equal(fs.existsSync(appRoot), true, `Proteum app root does not exist: ${appRoot}`);

	const outputDir = createOutputDir();
	const codexCli = process.env.CODEX_CLI || 'codex';
	const timeoutMs = parsePositiveInteger(process.env.PROTEUM_CODEX_MCP_USAGE_TIMEOUT_MS, 20 * 60 * 1000);
	const minMcpCalls = parsePositiveInteger(process.env.PROTEUM_CODEX_MCP_MIN_MCP_CALLS, 4);
	const maxCliCalls = parsePositiveInteger(process.env.PROTEUM_CODEX_MCP_MAX_CLI_CALLS, 4);

	const result = await runCodex({ appRoot, codexCli, outputDir, timeoutMs });
	const transcriptFile = path.join(outputDir, 'codex-events.jsonl');
	const stderrFile = path.join(outputDir, 'stderr.txt');
	const summaryFile = path.join(outputDir, 'summary.json');
	fs.writeFileSync(transcriptFile, result.stdout);
	fs.writeFileSync(stderrFile, result.stderr);

	const summary = analyzeCodexOutput(result);
	fs.writeFileSync(
		summaryFile,
		JSON.stringify(
			{
				...summary,
				appRoot,
				codexCli,
				status: result.status,
				timedOut: result.timedOut,
				transcriptFile,
				stderrFile,
				lastMessageFile: result.lastMessageFile,
			},
			null,
			2,
		),
	);

	assert.equal(result.timedOut, false, `Codex CLI timed out. Summary: ${summaryFile}`);
	assert.equal(result.status, 0, `Codex CLI exited with ${result.status}. Summary: ${summaryFile}`);
	assert.equal(summary.parseErrors, 0, `Codex JSONL output contained parse errors. Summary: ${summaryFile}`);
	assert.ok(summary.tokenUsage.samples > 0, `Codex JSONL output did not include token usage. Summary: ${summaryFile}`);
	assert.ok(summary.tokenUsage.total > 0, `Codex token usage was not quantified. Summary: ${summaryFile}`);
	assert.ok(summary.mcpCalls.total >= minMcpCalls, `Expected at least ${minMcpCalls} Proteum MCP calls. Summary: ${summaryFile}`);
	assert.ok(
		(summary.mcpCalls.byName.workflow_start || 0) >= 1,
		`Expected at least one Proteum MCP workflow_start call. Summary: ${summaryFile}`,
	);
	assert.ok(summary.cliCalls.total <= maxCliCalls, `Expected at most ${maxCliCalls} Proteum CLI calls. Summary: ${summaryFile}`);

	console.log(`Codex MCP usage summary: ${summaryFile}`);
}, 25 * 60 * 1000);
