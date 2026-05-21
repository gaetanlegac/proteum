const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
const cliBin = path.join(coreRoot, 'cli', 'bin.js');

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const createProteumApp = (appRoot, { routerPort = 3020 } = {}) => {
    writeFile(path.join(appRoot, 'package.json'), '{"name":"fixture"}\n');
    writeFile(path.join(appRoot, 'identity.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');
    fs.mkdirSync(path.join(appRoot, 'client'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'server'), { recursive: true });
    writeFile(
        path.join(appRoot, '.proteum', 'manifest.json'),
        JSON.stringify({
            version: 10,
            app: {
                root: appRoot,
                coreRoot,
                identityFilepath: path.join(appRoot, 'identity.config.ts'),
                setupFilepath: path.join(appRoot, 'proteum.config.ts'),
                identity: { name: 'Product', identifier: 'ProductApp', description: '' },
                setup: {},
            },
            conventions: { routeOptionKeys: [], reservedRouteOptionKeys: [] },
            env: {
                source: 'test',
                loadedVariableKeys: [],
                requiredVariables: [],
                resolved: {
                    name: 'test',
                    profile: 'dev',
                    routerPort,
                    routerCurrentDomain: 'localhost',
                    routerInternalUrl: `http://localhost:${routerPort}`,
                },
            },
            connectedProjects: [],
            services: { app: [], routerPlugins: [] },
            controllers: [],
            commands: [],
            routes: { client: [], server: [] },
            layouts: [],
            diagnostics: [],
        }),
    );
};

const hashFile = (filepath) => crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');

const writeFreshWorktreeBootstrapMarker = (appRoot) => {
    const timestamp = new Date().toISOString();
    fs.mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
    writeFile(path.join(appRoot, '.env'), 'PORT=3020\n');
    writeFile(path.join(appRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFile(path.join(appRoot, 'AGENTS.md'), '# Agents\n');

    writeFile(
        path.join(appRoot, '.proteum', 'worktree-bootstrap.json'),
        JSON.stringify(
            {
                version: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
                proteumVersion: require('../package.json').version,
                packageLockHash: hashFile(path.join(appRoot, 'package-lock.json')),
                proteumConfigHash: hashFile(path.join(appRoot, 'proteum.config.ts')),
                agentsHash: hashFile(path.join(appRoot, 'AGENTS.md')),
                env: { present: true, copied: false },
                refresh: { status: 'ok', ranAt: timestamp },
                dependencies: {
                    status: 'up-to-date',
                    ranAt: timestamp,
                    nodeModulesPresent: true,
                    packageLockHash: hashFile(path.join(appRoot, 'package-lock.json')),
                },
                runtimeStatus: { status: 'ok', checkedAt: timestamp, summary: 'runtime ok' },
            },
            null,
            2,
        ),
    );
};

const listen = async (server, port = 0) =>
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    });

const closeServer = async (server) =>
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });

const runCli = async (args, { cwd }) =>
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliBin, ...args], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (status) => resolve({ status, stdout, stderr }));
    });

const waitForChildOutput = async (child, predicate, timeoutMs = 10000) =>
    await new Promise((resolve, reject) => {
        let output = '';
        let settled = false;
        let timer;
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            child.stdout.off('data', handleData);
            child.stderr.off('data', handleData);
            child.off('close', handleClose);
        };
        const settle = (callback) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const handleData = (chunk) => {
            output += chunk.toString();
            if (predicate(output)) settle(() => resolve(output));
        };
        const handleClose = (status, signal) => {
            settle(() => reject(new Error(`Child exited before expected output. status=${status} signal=${signal}\n${output}`)));
        };
        timer = setTimeout(() => {
            child.kill('SIGTERM');
            settle(() => reject(new Error(`Timed out waiting for expected output.\n${output}`)));
        }, timeoutMs);

        child.stdout.on('data', handleData);
        child.stderr.on('data', handleData);
        child.once('close', handleClose);
    });

const writeLiveDaemonRecord = (registryDir, { port }) => {
    const timestamp = new Date().toISOString();

    writeFile(
        path.join(registryDir, 'router.json'),
        JSON.stringify(
            {
                version: 1,
                pid: process.pid,
                port,
                host: '127.0.0.1',
                mcpUrl: `http://127.0.0.1:${port}/mcp`,
                healthUrl: `http://127.0.0.1:${port}/health`,
                startedAt: timestamp,
                updatedAt: timestamp,
                command: [process.execPath, cliBin, 'mcp', '--daemon'],
            },
            null,
            2,
        ),
    );
};

test('top-level help lists the machine-scope mcp router', () => {
    const result = spawnSync(process.execPath, [cliBin, '--help'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /proteum mcp\b/);
    assert.match(result.stdout, /proteum worktree\b/);
    assert.match(result.stdout, /machine-scope MCP router/);
});

test('mcp help describes projectId routing', () => {
    const result = spawnSync(process.execPath, [cliBin, 'mcp', '--help'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /machine-scope MCP router/);
    assert.match(output, /projectId/);
    assert.match(output, /--daemon/);
    assert.match(output, /--stdio/);
});

test('mcp daemon launch prints a central MCP connection banner', async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-daemon-launch-'));
    const reserveServer = http.createServer((req, res) => res.end('reserved'));
    const port = await listen(reserveServer);
    await closeServer(reserveServer);
    const child = spawn(process.execPath, [cliBin, 'mcp', '--daemon', '--port', String(port)], {
        cwd: coreRoot,
        env: { ...process.env, PROTEUM_MACHINE_MCP_DIR: registryDir },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let closed = false;
    child.once('close', () => {
        closed = true;
    });

    try {
        const output = await waitForChildOutput(child, (value) =>
            value.includes(`Connect MCP client (HTTP): http://127.0.0.1:${port}/mcp`),
        );

        assert.match(output, /CENTRAL MCP READY/);
        assert.match(output, /Launched central MCP server/);
    } finally {
        if (!closed) {
            child.kill('SIGTERM');
            await new Promise((resolve) => child.once('close', resolve));
        }
    }
});

test('mcp daemon reuse prints a central MCP connection banner', () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-daemon-reuse-'));
    const port = 37977;
    writeLiveDaemonRecord(registryDir, { port });

    const result = spawnSync(process.execPath, [cliBin, 'mcp', '--daemon', '--port', String(port)], {
        cwd: coreRoot,
        encoding: 'utf8',
        env: { ...process.env, PROTEUM_MACHINE_MCP_DIR: registryDir },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /CENTRAL MCP READY/);
    assert.match(output, /Connected to central MCP server/);
    assert.match(output, new RegExp(`Connect MCP client \\(HTTP\\): http://127\\.0\\.0\\.1:${port}/mcp`));
});

test('db help describes read-only SQL diagnostics', () => {
    const result = spawnSync(process.execPath, [cliBin, 'db', '--help'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /SELECT, SHOW, and EXPLAIN/);
    assert.match(output, /--limit/);
    assert.match(output, /--timeout/);
});

test('explain help describes compact section summaries', () => {
    const result = spawnSync(process.execPath, [cliBin, 'explain', '--help'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /Summarize generated routes, controllers, and commands together/);
    assert.match(output, /--routes --controllers --commands --full/);
    assert.match(output, /Explicit section flags summarize those sections by default/);
});

test('runtime status from a monorepo wrapper returns app candidates instead of treating wrapper as app', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-wrapper-'));
    createProteumApp(path.join(repoRoot, 'apps', 'product'));

    const result = spawnSync(process.execPath, [cliBin, 'runtime', 'status'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.data.appCandidates.length, 1);
    assert.match(payload.nextActions[0].command, /cd "apps\/product"/);
    assert.match(payload.nextActions[0].command, /npx proteum runtime status/);
});

test('dev from a monorepo wrapper returns exact app-root start command', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-dev-wrapper-'));
    createProteumApp(path.join(repoRoot, 'apps', 'product'));

    const result = spawnSync(process.execPath, [cliBin, 'dev', 'list'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.ok, false);
    assert.match(payload.nextActions[0].command, /cd "apps\/product"/);
    assert.match(payload.nextActions[0].command, /npx proteum dev --session-file/);
});

test('runtime status manifest guard points to explain manifest', () => {
    const result = spawnSync(process.execPath, [cliBin, 'runtime', 'status', '--manifest'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.ok, false);
    assert.match(payload.summary, /not supported/);
    assert.match(payload.nextActions[0].command, /proteum explain --manifest/);
});

test('runtime status blocks unbootstrapped Codex worktrees', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-worktree-block-'));
    const appRoot = path.join(root, '.codex', 'worktrees', 'product');
    createProteumApp(appRoot);

    const result = spawnSync(process.execPath, [cliBin, 'runtime', 'status'], {
        cwd: appRoot,
        encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.ok, false);
    assert.match(payload.summary, /has not completed Proteum worktree bootstrap/);
    assert.match(payload.nextActions[0].command, /proteum worktree init --source <source-app-root>/);
});

test('runtime status allows fresh Codex worktree bootstrap markers and reports stale refresh action', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-worktree-fresh-'));
    const appRoot = path.join(root, '.codex', 'worktrees', 'product');
    createProteumApp(appRoot);
    writeFreshWorktreeBootstrapMarker(appRoot);

    const fresh = spawnSync(process.execPath, [cliBin, 'runtime', 'status'], {
        cwd: appRoot,
        encoding: 'utf8',
    });
    const freshPayload = JSON.parse(fresh.stdout);

    assert.equal(fresh.status, 0);
    assert.equal(freshPayload.ok, true);
    assert.equal(freshPayload.data.worktreeBootstrap.state, 'fresh');

    writeFile(path.join(appRoot, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');

    const stale = spawnSync(process.execPath, [cliBin, 'runtime', 'status'], {
        cwd: appRoot,
        encoding: 'utf8',
    });
    const stalePayload = JSON.parse(stale.stdout);

    assert.equal(stale.status, 1);
    assert.equal(stalePayload.ok, false);
    assert.match(stalePayload.nextActions[0].command, /--refresh/);
});

test('runtime status reports occupied configured port without probing page bodies', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-port-'));
    const otherRoot = path.join(repoRoot, 'apps', 'other');
    const appRoot = path.join(repoRoot, 'apps', 'product');
    const server = http.createServer((req, res) => {
        if (req.url && req.url.startsWith('/__proteum/explain')) {
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    app: {
                        root: otherRoot,
                        identity: { identifier: 'OtherApp', name: 'Other' },
                    },
                }),
            );
            return;
        }

        res.setHeader('content-type', 'text/html');
        res.end('<html><body>large wrong app page that should never be included</body></html>');
    });
    const occupiedPort = await listen(server);

    try {
        createProteumApp(appRoot, { routerPort: occupiedPort });

        const result = await runCli(['runtime', 'status'], {
            cwd: appRoot,
        });
        const payload = JSON.parse(result.stdout);

        assert.equal(result.status, 0);
        assert.equal(payload.ok, true);
        assert.equal(payload.data.configuredDevPort.router.port, occupiedPort);
        assert.equal(payload.data.configuredDevPort.router.available, false);
        assert.equal(payload.data.configuredDevPort.router.proteum, true);
        assert.equal(payload.data.configuredDevPort.router.matchesApp, false);
        assert.equal(payload.data.configuredDevPort.router.app.identifier, 'OtherApp');
        assert.notEqual(payload.data.configuredDevPort.recommendedPort, occupiedPort);
        assert.match(payload.summary, /occupied by OtherApp/);
        assert.match(payload.nextActions[0].command, /(npx )?proteum dev --session-file/);
        assert.doesNotMatch(payload.nextActions[0].command, new RegExp(`--port ${occupiedPort}(\\D|$)`));
        assert.match(payload.nextActions[0].reason, /do not probe page bodies/);
        assert.doesNotMatch(result.stdout, /large wrong app page/);
        assert.doesNotMatch(result.stdout, /<html>/);
    } finally {
        await closeServer(server);
    }
});

test('db query posts one read-only SQL statement to the running dev endpoint', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-db-'));
    const appRoot = path.join(repoRoot, 'apps', 'product');
    let receivedBody = '';
    const server = http.createServer((req, res) => {
        if (req.url === '/__proteum/db/query' && req.method === 'POST') {
            req.on('data', (chunk) => {
                receivedBody += chunk.toString();
            });
            req.on('end', () => {
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        kind: 'select',
                        sql: 'SELECT 1',
                        elapsedMs: 7,
                        limit: 5,
                        limited: false,
                        rowCount: 1,
                        columns: [{ name: 'value', type: 3 }],
                        rows: [{ value: 1 }],
                    }),
                );
            });
            return;
        }

        res.statusCode = 404;
        res.end('not found');
    });
    const port = await listen(server);

    try {
        createProteumApp(appRoot, { routerPort: port });

        const result = await runCli(['db', 'query', 'SELECT 1', '--limit', '5'], {
            cwd: appRoot,
        });
        const payload = JSON.parse(result.stdout);
        const body = JSON.parse(receivedBody);

        assert.equal(result.status, 0);
        assert.equal(body.sql, 'SELECT 1');
        assert.equal(body.limit, 5);
        assert.equal(payload.ok, true);
        assert.equal(payload.data.elapsedMs, 7);
        assert.deepEqual(payload.data.rows, [{ value: 1 }]);
    } finally {
        await closeServer(server);
    }
});

test('runtime status avoids starting a second dev server when the same app owns the port', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-cli-same-port-'));
    const appRoot = path.join(repoRoot, 'apps', 'product');
    const server = http.createServer((req, res) => {
        if (req.url && req.url.startsWith('/__proteum/explain')) {
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    app: {
                        root: appRoot,
                        identity: { identifier: 'ProductApp', name: 'Product' },
                    },
                }),
            );
            return;
        }

        res.setHeader('content-type', 'text/html');
        res.end('<html><body>same app page body that should not be included</body></html>');
    });
    const occupiedPort = await listen(server);

    try {
        createProteumApp(appRoot, { routerPort: occupiedPort });

        const result = await runCli(['runtime', 'status'], {
            cwd: appRoot,
        });
        const payload = JSON.parse(result.stdout);

        assert.equal(result.status, 0);
        assert.equal(payload.data.configuredDevPort.router.matchesApp, true);
        assert.equal(payload.nextActions[0].label, 'Use Existing Runtime');
        assert.match(payload.nextActions[0].command, new RegExp(`proteum diagnose "/" --port ${occupiedPort}`));
        assert.match(payload.nextActions[0].reason, /Do not start a second dev server/);
        assert.equal(payload.nextActions.some((action) => action.label === 'Start Dev'), false);
        assert.doesNotMatch(result.stdout, /same app page body/);
    } finally {
        await closeServer(server);
    }
});
