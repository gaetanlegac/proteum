import { spawn } from 'child_process';
import path from 'path';

import {
    compactWorktreeBootstrapStatus,
    runMonorepoWorktreeBootstrapCreate,
    runMonorepoWorktreeBootstrapInit,
} from './worktreeBootstrap';
import { inspectDevPort } from './ports';
import {
    resolveProteumAppRootContext,
    type TProteumAppRootSummary,
} from '../utils/appRoots';
import { printJson, quoteCommandArgument } from '../utils/agentOutput';

export const monorepoFanoutChildEnv = 'PROTEUM_MONOREPO_FANOUT_CHILD';

type TMonorepoCommandResult = {
    appRoot: string;
    exitCode: number | null;
    json?: unknown;
    ok: boolean;
    relativeAppRoot?: string;
    stderr: string;
    stdout: string;
};

type TParsedWorktreeArgs = {
    action: string;
    base?: string;
    branch?: string;
    json: boolean;
    reason?: string;
    refresh: boolean;
    skipDeps: boolean;
    source?: string;
    target?: string;
};

const defaultJsonCommandNames = new Set([
    'connect',
    'db',
    'diagnose',
    'doctor',
    'explain',
    'orient',
    'perf',
    'runtime',
    'trace',
]);
const genericFanoutCommands = new Set([
    'build',
    'check',
    'command',
    'connect',
    'db',
    'diagnose',
    'doctor',
    'e2e',
    'explain',
    'lint',
    'orient',
    'perf',
    'refresh',
    'runtime',
    'session',
    'trace',
    'typecheck',
]);
const optionNamesWithValue = new Set([
    '--base',
    '--branch',
    '--cwd',
    '--port',
    '--reason',
    '--session-file',
    '--source',
]);

export const isMonorepoFanoutChild = () => process.env[monorepoFanoutChildEnv] === '1';

const getCliBin = () => path.join(__dirname, '..', 'bin.js');

const hasFlag = (argv: string[], flag: string) => argv.includes(flag) || argv.some((arg) => arg.startsWith(`${flag}=`));

const getOptionValue = (argv: string[], optionName: string) => {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === optionName) return argv[index + 1];
        if (arg.startsWith(`${optionName}=`)) return arg.slice(optionName.length + 1);
    }

    return undefined;
};

const removeOptionsWithValues = (argv: string[], options: Set<string>) => {
    const nextArgv: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const exactOption = options.has(arg);
        const assignmentOption = [...options].some((option) => arg.startsWith(`${option}=`));

        if (assignmentOption) continue;
        if (exactOption) {
            index += 1;
            continue;
        }

        nextArgv.push(arg);
    }

    return nextArgv;
};

const getPositionals = (argv: string[]) => {
    const positionals: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg.startsWith('-')) {
            if (optionNamesWithValue.has(arg)) index += 1;
            continue;
        }

        positionals.push(arg);
    }

    return positionals;
};

const getCommandString = (argv: string[]) => ['proteum', ...argv].join(' ');

const shouldPrintJsonAggregate = (argv: string[]) => {
    const commandName = argv[0] || '';

    if (hasFlag(argv, '--human')) return false;
    if (hasFlag(argv, '--json')) return true;
    if (defaultJsonCommandNames.has(commandName)) return true;
    if (commandName === 'dev' && getPositionals(argv.slice(1))[0] === 'list' && hasFlag(argv, '--json')) return true;
    return false;
};

const parseJsonOutput = (stdout: string) => {
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;

    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
};

const runChildCommand = async ({
    app,
    argv,
}: {
    app: TProteumAppRootSummary;
    argv: string[];
}): Promise<TMonorepoCommandResult> =>
    await new Promise((resolve) => {
        const child = spawn(process.execPath, [getCliBin(), ...argv], {
            cwd: app.appRoot,
            env: {
                ...process.env,
                [monorepoFanoutChildEnv]: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
        child.on('error', (error) => {
            resolve({
                appRoot: app.appRoot,
                exitCode: 1,
                ok: false,
                relativeAppRoot: app.relativeAppRoot,
                stderr: error.message,
                stdout: '',
            });
        });
        child.on('close', (exitCode) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');

            resolve({
                appRoot: app.appRoot,
                exitCode,
                json: parseJsonOutput(stdout),
                ok: exitCode === 0,
                relativeAppRoot: app.relativeAppRoot,
                stderr,
                stdout,
            });
        });
    });

const printAggregateJson = ({
    argv,
    cwd,
    results,
}: {
    argv: string[];
    cwd: string;
    results: TMonorepoCommandResult[];
}) => {
    const passed = results.filter((result) => result.ok).length;

    printJson({
        ok: passed === results.length,
        format: 'proteum-agent-v1',
        summary: `Monorepo ${getCommandString(argv)}: ${passed}/${results.length} apps passed.`,
        data: {
            cwd,
            command: getCommandString(argv),
            apps: results,
        },
    });
};

const printAggregateHuman = ({
    argv,
    results,
}: {
    argv: string[];
    results: TMonorepoCommandResult[];
}) => {
    const lines = [
        `Proteum monorepo command: ${getCommandString(argv)}`,
        `Apps: ${results.length}`,
        '',
    ];

    for (const result of results) {
        lines.push(`## ${result.relativeAppRoot || result.appRoot} (exit ${result.exitCode ?? 'unknown'})`);
        if (result.stdout.trim()) lines.push(result.stdout.trimEnd());
        if (result.stderr.trim()) lines.push(result.stderr.trimEnd());
        lines.push('');
    }

    process.stdout.write(lines.join('\n'));
};

const runGenericFanout = async ({
    apps,
    argv,
    cwd,
}: {
    apps: TProteumAppRootSummary[];
    argv: string[];
    cwd: string;
}) => {
    const results: TMonorepoCommandResult[] = [];

    for (const app of apps) {
        results.push(await runChildCommand({ app, argv }));
    }

    if (shouldPrintJsonAggregate(argv)) printAggregateJson({ argv, cwd, results });
    else printAggregateHuman({ argv, results });

    if (results.some((result) => !result.ok)) process.exitCode = 1;
};

const parsePort = (value: string | undefined) => {
    if (!value) return undefined;

    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid --port value "${value}". Expected an integer between 1 and 65535.`);
    }

    return port;
};

const slugifyAppRoot = (relativeAppRoot: string | undefined, appRoot: string) =>
    (relativeAppRoot || path.basename(appRoot) || 'app').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

const allocateDevPort = async ({
    app,
    explicitStartPort,
    index,
    usedPorts,
}: {
    app: TProteumAppRootSummary;
    explicitStartPort?: number;
    index: number;
    usedPorts: Set<number>;
}) => {
    let port = explicitStartPort ? explicitStartPort + index * 2 : app.manifest?.routerPort || 3000 + index * 2;

    for (let attempts = 0; attempts < 80; attempts += 1) {
        if (usedPorts.has(port) || usedPorts.has(port + 1)) {
            port += 2;
            continue;
        }

        const inspection = await inspectDevPort({ appRoot: app.appRoot, port });
        if (inspection.canStartOnConfiguredPort) {
            usedPorts.add(port);
            usedPorts.add(port + 1);
            return port;
        }

        port = inspection.recommendedPort && !usedPorts.has(inspection.recommendedPort)
            ? inspection.recommendedPort
            : port + 2;
    }

    throw new Error(`Could not find a free router/HMR port pair for ${app.relativeAppRoot || app.appRoot}.`);
};

const prefixOutput = ({
    label,
    stream,
    target,
}: {
    label: string;
    stream: NodeJS.ReadableStream;
    target: NodeJS.WritableStream;
}) => {
    let pending = '';

    stream.on('data', (chunk) => {
        pending += Buffer.from(chunk).toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';

        for (const line of lines) target.write(`[${label}] ${line}\n`);
    });

    stream.on('end', () => {
        if (pending) target.write(`[${label}] ${pending}\n`);
    });
};

const runDevSupervisor = async ({
    apps,
    argv,
}: {
    apps: TProteumAppRootSummary[];
    argv: string[];
}) => {
    const explicitPort = parsePort(getOptionValue(argv, '--port'));
    const childArgvBase = removeOptionsWithValues(argv, new Set(['--cwd', '--port', '--session-file']));
    const usedPorts = new Set<number>();
    const children: Array<{ app: TProteumAppRootSummary; child: ReturnType<typeof spawn> }> = [];

    for (let index = 0; index < apps.length; index += 1) {
        const app = apps[index];
        const port = await allocateDevPort({ app, explicitStartPort: explicitPort, index, usedPorts });
        const slug = slugifyAppRoot(app.relativeAppRoot, app.appRoot);
        const sessionFile = `var/run/proteum/dev/monorepo/${slug}.json`;
        const childArgv = [...childArgvBase, '--port', String(port), '--session-file', sessionFile];
        const child = spawn(process.execPath, [getCliBin(), ...childArgv], {
            cwd: app.appRoot,
            env: {
                ...process.env,
                [monorepoFanoutChildEnv]: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const label = app.relativeAppRoot || app.appRoot;

        prefixOutput({ label, stream: child.stdout, target: process.stdout });
        prefixOutput({ label, stream: child.stderr, target: process.stderr });
        children.push({ app, child });
        process.stdout.write(`[${label}] starting on port ${port} with session ${sessionFile}\n`);
    }

    const stopChildren = () => {
        for (const { child } of children) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        }
    };

    process.once('SIGINT', () => {
        stopChildren();
    });
    process.once('SIGTERM', () => {
        stopChildren();
    });

    const results = await Promise.all(
        children.map(
            ({ app, child }) =>
                new Promise<TMonorepoCommandResult>((resolve) => {
                    child.on('close', (exitCode) => {
                        resolve({
                            appRoot: app.appRoot,
                            exitCode,
                            ok: exitCode === 0,
                            relativeAppRoot: app.relativeAppRoot,
                            stderr: '',
                            stdout: '',
                        });
                    });
                }),
        ),
    );

    if (results.some((result) => !result.ok)) process.exitCode = 1;
};

const parseWorktreeArgs = (argv: string[]): TParsedWorktreeArgs => {
    const [, action = '', ...rest] = argv;
    const positionals: string[] = [];
    const parsed: TParsedWorktreeArgs = {
        action,
        json: hasFlag(argv, '--json'),
        refresh: hasFlag(argv, '--refresh'),
        skipDeps: hasFlag(argv, '--skip-deps'),
    };

    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];

        if (arg === '--source') {
            parsed.source = rest[index + 1];
            index += 1;
        } else if (arg.startsWith('--source=')) {
            parsed.source = arg.slice('--source='.length);
        } else if (arg === '--branch') {
            parsed.branch = rest[index + 1];
            index += 1;
        } else if (arg.startsWith('--branch=')) {
            parsed.branch = arg.slice('--branch='.length);
        } else if (arg === '--base') {
            parsed.base = rest[index + 1];
            index += 1;
        } else if (arg.startsWith('--base=')) {
            parsed.base = arg.slice('--base='.length);
        } else if (arg === '--reason') {
            parsed.reason = rest[index + 1];
            index += 1;
        } else if (arg.startsWith('--reason=')) {
            parsed.reason = arg.slice('--reason='.length);
        } else if (!arg.startsWith('-')) {
            positionals.push(arg);
        }
    }

    parsed.target = positionals[0];
    return parsed;
};

const printWorktreeResult = ({
    data,
    json,
    ok,
    summary,
}: {
    data: object;
    json: boolean;
    ok: boolean;
    summary: string;
}) => {
    if (json) {
        printJson({
            ok,
            format: 'proteum-agent-v1',
            summary,
            data,
        });
        return;
    }

    printJson({
        ok,
        format: 'proteum-agent-v1',
        summary,
        data,
    });
};

const runWorktreeMonorepoCommand = async ({
    apps,
    argv,
    cwd,
}: {
    apps: TProteumAppRootSummary[];
    argv: string[];
    cwd: string;
}) => {
    const parsed = parseWorktreeArgs(argv);
    const common = {
        appRoots: apps.map((app) => app.appRoot),
        coreRoot: path.resolve(__dirname, '..', '..'),
        json: parsed.json,
        proteumVersion: require('../../package.json').version as string,
        reason: parsed.reason,
        refresh: parsed.refresh,
        skipDeps: parsed.skipDeps,
    };

    if (parsed.action === 'init') {
        const result = await runMonorepoWorktreeBootstrapInit({
            ...common,
            monorepoRoot: cwd,
            source: parsed.source ? path.resolve(cwd, parsed.source) : undefined,
        });

        printWorktreeResult({
            data: {
                ...result,
                apps: result.apps.map((app) => ({
                    ...app,
                    status: app.status ? compactWorktreeBootstrapStatus(app.status) : undefined,
                })),
            },
            json: parsed.json,
            ok: result.ok,
            summary: `Proteum monorepo worktree bootstrap completed for ${result.apps.length} app${result.apps.length === 1 ? '' : 's'}.`,
        });
        if (!result.ok) process.exitCode = 1;
        return;
    }

    if (parsed.action === 'create') {
        if (!parsed.target) throw new Error('worktree create requires <target-repo-root>.');

        const result = await runMonorepoWorktreeBootstrapCreate({
            base: parsed.base,
            branch: parsed.branch || '',
            coreRoot: common.coreRoot,
            json: common.json,
            monorepoRoot: cwd,
            proteumVersion: common.proteumVersion,
            reason: common.reason,
            refresh: common.refresh,
            skipDeps: common.skipDeps,
            source: parsed.source ? path.resolve(cwd, parsed.source) : cwd,
            targetRepoRoot: path.resolve(cwd, parsed.target),
        });

        printWorktreeResult({
            data: {
                ...result,
                worktreeBootstrap: {
                    ...result.worktreeBootstrap,
                    apps: result.worktreeBootstrap.apps.map((app) => ({
                        ...app,
                        status: app.status ? compactWorktreeBootstrapStatus(app.status) : undefined,
                    })),
                },
            },
            json: parsed.json,
            ok: result.worktreeBootstrap.ok,
            summary: `Created Proteum monorepo worktree at ${result.targetRepoRoot}.`,
        });
        if (!result.worktreeBootstrap.ok) process.exitCode = 1;
        return;
    }

    throw new Error('Usage: `proteum worktree init` or `proteum worktree create <target-repo-root>`.');
};

const isGenericFanoutCommand = (argv: string[]) => {
    const commandName = argv[0] || '';
    const commandPositionals = getPositionals(argv.slice(1));
    const action = commandPositionals[0] || '';

    if (commandName === 'build' && hasFlag(argv, '--analyze-serve')) return true;
    if (commandName === 'dev') return action === 'list' || action === 'stop';
    if (commandName === 'runtime') return action === '' || action === 'status';
    if (commandName === 'verify') return action === 'owner' || action === 'request' || action === 'browser';
    return genericFanoutCommands.has(commandName);
};

export const maybeRunMonorepoCommand = async (argv: string[]) => {
    if (isMonorepoFanoutChild()) return false;
    if (argv.length === 0) return false;

    const commandName = argv[0] || '';
    if ((commandName === 'dev' || commandName === 'e2e') && getOptionValue(argv, '--cwd')) return false;

    const context = resolveProteumAppRootContext(process.cwd());
    const apps = context.appCandidates;
    if (!context.isWrapper || apps.length === 0) return false;

    if (commandName === 'build' && hasFlag(argv, '--analyze-serve')) {
        printJson({
            ok: false,
            format: 'proteum-agent-v1',
            summary: '`proteum build --analyze-serve` cannot run as monorepo fan-out because analyzer servers stay open.',
            data: { cwd: context.cwd, appCandidates: apps },
            nextActions: apps.map((app) => ({
                label: `Analyze ${app.relativeAppRoot || app.appRoot}`,
                command: `cd ${quoteCommandArgument(app.relativeAppRoot || app.appRoot)} && proteum build --prod --analyze --analyze-serve --analyze-port auto`,
                reason: 'Run one analyzer server from the target app root.',
            })),
        });
        process.exitCode = 1;
        return true;
    }

    if (commandName === 'configure' && getPositionals(argv.slice(1))[0] === 'agents') {
        const { runConfigureAgentsMonorepoWizard } = await import('../commands/configure');

        await runConfigureAgentsMonorepoWizard({
            appRoots: apps.map((app) => app.appRoot),
            monorepoRoot: context.cwd,
        });
        return true;
    }

    if (commandName === 'worktree') {
        await runWorktreeMonorepoCommand({ apps, argv, cwd: context.cwd });
        return true;
    }

    if (commandName === 'dev' && getPositionals(argv.slice(1)).length === 0) {
        await runDevSupervisor({ apps, argv });
        return true;
    }

    if (!isGenericFanoutCommand(argv)) return false;

    await runGenericFanout({ apps, argv, cwd: context.cwd });
    return true;
};
