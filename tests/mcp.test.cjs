const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');
require('../cli/context.ts');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const {
    createMcpPayload,
    compactOrientationResponse,
    compactRouteCandidatesResponse,
    compactTraceResponse,
    compactWorkflowStartResponse,
    resolveInstructionRouting,
} = require('../common/dev/mcpPayloads.ts');
const { createProteumMcpServer } = require('../common/dev/mcpServer.ts');
const {
    normalizeDatabaseReadLimit,
    validateDatabaseReadQuery,
} = require('../common/dev/database.ts');
const { databaseProtocolFromUrl } = require('../server/app/devDatabase.ts');
const { createProteumMachineMcpServer } = require('../cli/mcp/router.ts');
const {
    createDevSessionRecord,
    listMachineDevSessionInspections,
    resolveMachineDevSessionFilePath,
    resolveProteumProjectId,
    writeMachineDevSessionRecord,
} = require('../cli/runtime/devSessions.ts');
const {
    createMachineMcpDaemonRecord,
    inspectMachineMcpDaemonRecord,
    resolveMachineMcpDaemonPort,
    resolveMachineMcpDaemonRecordFilePath,
    writeMachineMcpDaemonRecord,
} = require('../cli/runtime/mcpDaemon.ts');

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
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

const createManifest = (appRoot, overrides = {}) => ({
    version: 10,
    app: {
        root: appRoot,
        coreRoot,
        identityFilepath: path.join(appRoot, 'identity.config.ts'),
        setupFilepath: path.join(appRoot, 'proteum.config.ts'),
        identity: {
            name: overrides.name || 'Test App',
            identifier: overrides.identifier || 'TestApp',
            description: '',
        },
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
            routerPort: overrides.routerPort || 3104,
            routerCurrentDomain: 'localhost',
            routerInternalUrl: `http://localhost:${overrides.routerPort || 3104}`,
        },
    },
    connectedProjects: [],
    services: { app: [], routerPlugins: [] },
    controllers: overrides.controllers || [],
    commands: [],
    routes: {
        client: overrides.clientRoutes || [],
        server: overrides.serverRoutes || [],
    },
    layouts: [],
    diagnostics: overrides.diagnostics || [],
});

const writeProteumAppFixture = (appRoot, manifestOverrides = {}) => {
    writeFile(path.join(appRoot, 'package.json'), '{"name":"fixture"}\n');
    writeFile(path.join(appRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFile(
        path.join(appRoot, '.env'),
        [
            'ENV_NAME=local',
            'ENV_PROFILE=dev',
            `PORT=${manifestOverrides.routerPort || 3104}`,
            `URL=http://localhost:${manifestOverrides.routerPort || 3104}`,
            `URL_INTERNAL=http://localhost:${manifestOverrides.routerPort || 3104}`,
            '',
        ].join('\n'),
    );
    fs.mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
    writeFile(path.join(appRoot, 'identity.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'client', 'AGENTS.md'), '# Client\n');
    writeFile(path.join(appRoot, 'client', 'pages', 'AGENTS.md'), '# Pages\n');
    writeFile(path.join(appRoot, 'server', 'AGENTS.md'), '# Server\n');
    writeFile(path.join(appRoot, 'server', 'routes', 'AGENTS.md'), '# Routes\n');
    writeFile(path.join(appRoot, 'AGENTS.md'), '# App\n');
    writeFile(path.join(appRoot, 'diagnostics.md'), '# Diagnostics\n');
    writeFile(path.join(appRoot, '.proteum', 'manifest.json'), JSON.stringify(createManifest(appRoot, manifestOverrides), null, 2));
};

const writeFreshCopyFixture = (appRoot, manifestOverrides = {}) => {
    writeFile(path.join(appRoot, 'package.json'), '{"name":"fresh-copy"}\n');
    writeFile(path.join(appRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFile(
        path.join(appRoot, '.env.example'),
        [
            'ENV_NAME=local',
            'ENV_PROFILE=dev',
            'PORT=3020',
            'URL=http://localhost:3020',
            'URL_INTERNAL=http://localhost:3020',
            'DATABASE_URL=mysql://user:pass@localhost:3306/app',
            '',
        ].join('\n'),
    );
    writeFile(path.join(appRoot, 'identity.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');
    writeFile(
        path.join(appRoot, 'prisma', 'schema.prisma'),
        ['generator client {', '  provider = "prisma-client-js"', '  output = "../var/prisma"', '}', '', 'datasource db {', '  provider = "mysql"', '}'].join(
            '\n',
        ),
    );
    writeFile(path.join(appRoot, 'client', 'AGENTS.md'), '# Client\n');
    writeFile(path.join(appRoot, 'client', 'pages', 'AGENTS.md'), '# Pages\n');
    writeFile(path.join(appRoot, 'server', 'AGENTS.md'), '# Server\n');
    writeFile(path.join(appRoot, 'server', 'routes', 'AGENTS.md'), '# Routes\n');
    writeFile(path.join(appRoot, 'AGENTS.md'), '# App\n');
    writeFile(path.join(appRoot, 'diagnostics.md'), '# Diagnostics\n');
    writeFile(path.join(appRoot, '.proteum', 'manifest.json'), JSON.stringify(createManifest(appRoot, manifestOverrides), null, 2));
};

test('instruction routing returns compact selected files for a page query', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-app-'));

    writeFile(path.join(appRoot, 'AGENTS.md'), '# App Agents\n\n- root\n');
    writeFile(path.join(appRoot, 'client', 'AGENTS.md'), '# Client Agents\n\n- client\n');
    writeFile(path.join(appRoot, 'client', 'pages', 'AGENTS.md'), '# Page Agents\n\n- pages\n');
    writeFile(path.join(appRoot, 'DOCUMENTATION.md'), '# Documentation\n\n- docs\n');
    writeFile(path.join(appRoot, 'diagnostics.md'), '# Diagnostics\n\n- diagnose\n');

    const payload = resolveInstructionRouting({ appRoot, query: '/domains/:slug client/pages/domain.tsx' });

    assert.equal(payload.ok, true);
    assert.equal(payload.format, 'proteum-mcp-v1');
    assert.deepEqual(
        payload.data.selected.map((entry) => path.relative(appRoot, entry.file)).sort(),
        ['AGENTS.md', 'client/AGENTS.md', 'client/pages/AGENTS.md'],
    );
    assert.equal(payload.data.readWhen.some((entry) => entry.file && entry.file.endsWith('DOCUMENTATION.md')), true);
    assert.equal(payload.data.readWhen.some((entry) => entry.file && entry.file.endsWith('diagnostics.md')), true);
});

test('database read query policy allows only capped SELECT SHOW and EXPLAIN diagnostics', () => {
    assert.deepEqual(validateDatabaseReadQuery(' SELECT 1; '), { kind: 'select', sql: 'SELECT 1' });
    assert.deepEqual(validateDatabaseReadQuery('/* plan */ EXPLAIN SELECT * FROM User'), {
        kind: 'explain',
        sql: '/* plan */ EXPLAIN SELECT * FROM User',
    });
    assert.deepEqual(validateDatabaseReadQuery('SHOW TABLES'), { kind: 'show', sql: 'SHOW TABLES' });
    assert.equal(normalizeDatabaseReadLimit(999), 500);

    assert.throws(() => validateDatabaseReadQuery('UPDATE User SET role = "admin"'), /Only SELECT, SHOW, and EXPLAIN/);
    assert.throws(() => validateDatabaseReadQuery('SELECT 1; DROP TABLE User'), /Only one read-only SQL statement/);
    assert.throws(() => validateDatabaseReadQuery('EXPLAIN ANALYZE SELECT * FROM User'), /EXPLAIN ANALYZE/);
    assert.throws(() => validateDatabaseReadQuery('SELECT LOAD_FILE("/etc/passwd")'), /file-read/);
    assert.throws(() => validateDatabaseReadQuery("SELECT pg_read_file('/etc/passwd')"), /file-read/);
    assert.throws(() => validateDatabaseReadQuery('SELECT * FROM "User" FOR SHARE'), /Locking read/);
    assert.throws(() => validateDatabaseReadQuery('SELECT pg_sleep(1)'), /Sleep and benchmark/);
});

test('database diagnostics support MySQL MariaDB and PostgreSQL URLs', () => {
    assert.equal(databaseProtocolFromUrl('mysql://user:pass@localhost:3306/app'), 'mariadb');
    assert.equal(databaseProtocolFromUrl('mariadb://user:pass@localhost:3306/app'), 'mariadb');
    assert.equal(databaseProtocolFromUrl('postgres://user:pass@localhost:5432/app'), 'postgresql');
    assert.equal(databaseProtocolFromUrl('postgresql://user:pass@localhost:5432/app'), 'postgresql');
    assert.throws(() => databaseProtocolFromUrl('sqlite://local.db'), /postgresql/);
});

test('instruction routing promotes triggered full instruction files', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-trigger-app-'));
    const fallbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-trigger-core-'));
    const fallbackAgents = path.join(fallbackRoot, 'agents', 'project', 'AGENTS.md');

    writeFile(fallbackAgents, '# Full Root Contract\n\n- Conventional Commits live here.\n');
    writeFile(
        path.join(appRoot, 'AGENTS.md'),
        ['# App Router', '', `- Root contract fallback: ${fallbackAgents}`, ''].join('\n'),
    );
    writeFile(path.join(appRoot, 'CODING_STYLE.md'), '# Coding Style\n\n- Style\n');
    writeFile(path.join(appRoot, 'diagnostics.md'), '# Diagnostics\n\n- Diagnose\n');
    writeFile(path.join(appRoot, 'DOCUMENTATION.md'), '# Documentation\n\n- Docs\n');
    writeFile(path.join(appRoot, 'optimizations.md'), '# Optimizations\n\n- Optimize\n');

    const payload = resolveInstructionRouting({ appRoot, query: 'increase quota and commit' });
    const selected = payload.data.selected.map((entry) => entry.file);

    assert.equal(selected.includes(path.join(appRoot, 'AGENTS.md')), true);
    assert.equal(selected.includes(fallbackAgents), true);
    assert.equal(selected.includes(path.join(appRoot, 'CODING_STYLE.md')), true);
    assert.equal(
        payload.data.selected.some(
            (entry) => entry.file === fallbackAgents && /Git lifecycle trigger/.test(entry.reason),
        ),
        true,
    );
    assert.equal(payload.data.fullReadPolicy.default.includes('read-only'), true);
    assert.equal(payload.data.selected.some((entry) => entry.fullRead === 'full-before-action'), true);

    const bugFixPayload = resolveInstructionRouting({ appRoot, query: 'fix OAuth redirect bug' });
    assert.equal(
        bugFixPayload.data.selected.some(
            (entry) => entry.file === path.join(appRoot, 'DOCUMENTATION.md') && /Bug fix/.test(entry.reason),
        ),
        true,
    );
});

test('workflow start payload combines compact runtime, instructions, owner, and duplicate guidance', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-workflow-app-'));
    const pageFile = path.join(appRoot, 'client/pages/domains.tsx');

    writeFile(path.join(appRoot, 'AGENTS.md'), '# App Agents\n\n- root\n');
    writeFile(path.join(appRoot, 'client', 'AGENTS.md'), '# Client Agents\n\n- client\n');
    writeFile(path.join(appRoot, 'client', 'pages', 'AGENTS.md'), '# Page Agents\n\n- pages\n');
    writeFile(pageFile, 'export default function Domains() { return null; }\n');

    const manifest = {
        version: 10,
        app: {
            root: appRoot,
            coreRoot,
            identityFilepath: path.join(appRoot, 'identity.config.ts'),
            setupFilepath: path.join(appRoot, 'proteum.config.ts'),
            identity: {
                name: 'Workflow App',
                identifier: 'WorkflowApp',
                description: '',
            },
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
                routerPort: 3104,
                routerCurrentDomain: 'localhost',
                routerInternalUrl: 'http://localhost:3104',
            },
        },
        connectedProjects: [],
        services: { app: [], routerPlugins: [] },
        controllers: [],
        commands: [],
        routes: { client: [], server: [] },
        layouts: [],
        diagnostics: [],
    };
    const doctor = { summary: { errors: 0, warnings: 0, strictFailed: false }, diagnostics: [] };
    const payload = compactWorkflowStartResponse({
        contracts: doctor,
        doctor,
        manifest,
        owner: {
            matches: [
                {
                    details: [],
                    kind: 'route',
                    label: '/domains',
                    matchedOn: ['path'],
                    originHint: 'manifest',
                    scopeLabel: 'local',
                    score: 100,
                    source: { filepath: pageFile, line: 1, column: 1 },
                },
            ],
            normalizedQuery: '/domains',
            query: '/domains',
        },
        route: '/domains',
        runtime: { publicUrl: 'http://localhost:3104', mcpUrl: 'http://localhost:3104/__proteum/mcp' },
        task: 'read-only runtime health pass',
    });

    assert.equal(payload.data.runtime.manifest.identifier, 'WorkflowApp');
    assert.equal(payload.data.instructions.selected.length >= 2, true);
    assert.equal(payload.data.owner.top.label, '/domains');
    assert.equal(payload.nextActions[0].tool, 'diagnose');
    assert.equal(payload.data.duplicateAvoidance.some((line) => /do not run CLI runtime status/.test(line)), true);
});

test('orientation payload suggests MCP owner and runtime next actions before CLI fallback', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-orient-app-'));

    writeFile(path.join(appRoot, 'AGENTS.md'), '# App Agents\n\n- root\n');
    writeFile(path.join(appRoot, 'diagnostics.md'), '# Diagnostics\n\n- diagnose\n');
    writeFile(path.join(appRoot, 'DOCUMENTATION.md'), '# Documentation\n\n- docs\n');
    writeFile(path.join(appRoot, 'CODING_STYLE.md'), '# Coding Style\n\n- style\n');
    writeFile(path.join(appRoot, 'optimizations.md'), '# Optimizations\n\n- optimize\n');

    const payload = compactOrientationResponse({
        app: { appRoot, identifier: 'TestApp', repoRoot: appRoot, routerPort: 3101 },
        connected: { imports: [], producers: [] },
        guidance: {
            agents: path.join(appRoot, 'AGENTS.md'),
            areaAgents: [],
            codingStyle: path.join(appRoot, 'CODING_STYLE.md'),
            diagnostics: path.join(appRoot, 'diagnostics.md'),
            documentation: path.join(appRoot, 'DOCUMENTATION.md'),
            optimizations: path.join(appRoot, 'optimizations.md'),
        },
        normalizedQuery: '/auth/login',
        nextSteps: [{ command: 'proteum orient /auth/login', label: 'CLI Orient', reason: 'Fallback command.' }],
        owner: {
            matches: [
                {
                    details: [],
                    kind: 'route',
                    label: '/auth/login',
                    matchedOn: ['path'],
                    originHint: 'manifest',
                    scopeLabel: 'local',
                    score: 100,
                    source: { filepath: path.join(appRoot, 'client/pages/auth.tsx'), line: 1, column: 1 },
                },
            ],
            normalizedQuery: '/auth/login',
            query: '/auth/login',
        },
        query: '/auth/login',
        warnings: [],
    });

    assert.equal(payload.nextActions[0].tool, 'explain_summary');
    assert.equal(payload.nextActions[1].tool, 'diagnose');
    assert.equal(payload.nextActions[2].tool, 'perf_request');
    assert.equal(payload.nextActions.some((action) => action.command === 'proteum orient /auth/login'), true);
});

test('route candidates payload avoids raw route dumps', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-routes-app-'));
    const routeFile = path.join(appRoot, 'client/pages/domains.tsx');
    const manifest = createManifest(appRoot, {
        clientRoutes: [
            {
                chunkId: 'domains',
                filepath: routeFile,
                hasData: false,
                invalidOptionKeys: [],
                kind: 'client-page',
                methodName: 'page',
                normalizedOptionKeys: [],
                optionKeys: [],
                path: '/domains',
                scope: 'app',
                serviceLocalName: 'Router',
                sourceLocation: { line: 1, column: 1 },
                targetResolution: 'literal',
            },
        ],
    });

    const payload = compactRouteCandidatesResponse({ manifest, query: '/domains' });

    assert.equal(payload.data.candidates.length, 1);
    assert.equal(payload.data.candidates[0].label, '/domains');
    assert.equal(payload.nextActions[0].tool, 'explain_summary');
});

test('trace payload keeps default output compact and paginates full details', () => {
    const request = {
        id: 'req_1',
        method: 'GET',
        path: '/domains',
        url: 'http://localhost:3000/domains',
        capture: 'deep',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 42,
        statusCode: 200,
        droppedEvents: 0,
        calls: Array.from({ length: 3 }, (_, index) => ({
            id: `call_${index}`,
            origin: 'server',
            label: `Call ${index}`,
            method: 'POST',
            path: `/api/${index}`,
            statusCode: 200,
            durationMs: 10 + index,
            requestDataKeys: [],
            resultKeys: [],
        })),
        events: Array.from({ length: 12 }, (_, index) => ({
            index,
            elapsedMs: index,
            type: index === 2 ? 'error' : 'mark',
            details: { index, long: 'x'.repeat(300) },
        })),
        sqlQueries: Array.from({ length: 4 }, (_, index) => ({
            id: `sql_${index}`,
            callerLabel: 'Service.query',
            callerMethod: 'query',
            callerPath: 'server/services/Domain/index.ts',
            kind: 'query',
            operation: 'findMany',
            model: 'Domain',
            durationMs: index + 1,
            fingerprint: `fp_${index}`,
            query: 'select * from Domain where id = ?',
        })),
    };

    const compact = compactTraceResponse({ request });
    const full = compactTraceResponse({ detail: 'full', limit: 5, offset: 4, request });

    assert.equal(compact.data.page, undefined);
    assert.equal(compact.omitted.length, 1);
    assert.equal(full.data.page.events.length, 5);
    assert.equal(full.data.page.hasMore, true);
});

test('MCP server registers the Proteum read-only tool contract', async () => {
    const payload = createMcpPayload({ summary: 'ok', data: { value: 1 } });
    const provider = {
        dbQuery: async () => payload,
        diagnose: async () => payload,
        doctor: async () => payload,
        explainSummary: async () => payload,
        instructionsResolve: async () => payload,
        logsTail: async () => payload,
        orient: async () => payload,
        perfRequest: async () => payload,
        perfTop: async () => payload,
        readResource: async () => payload,
        routeCandidates: async () => payload,
        runtimeStatus: async () => payload,
        traceLatest: async () => payload,
        traceShow: async () => payload,
        workflowStart: async () => payload,
    };
    const server = createProteumMcpServer({ provider, version: 'test' });
    const client = new Client({ name: 'mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const result = await client.callTool({ name: 'runtime_status', arguments: {} });
    const resource = await client.readResource({ uri: 'proteum://runtime/status' });

    assert.equal(tools.tools.some((tool) => tool.name === 'runtime_status'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'workflow_start'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'route_candidates'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'db_query'), true);
    assert.match(result.content[0].text, /proteum-mcp-v1/);
    assert.match(resource.contents[0].text, /proteum-mcp-v1/);

    await client.close();
    await server.close();
});

test('machine project id is deterministic for a canonical app root', async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-project-id-'));

    const firstProjectId = await resolveProteumProjectId(appRoot);
    const secondProjectId = await resolveProteumProjectId(appRoot);

    assert.equal(firstProjectId, secondProjectId);
    assert.match(firstProjectId, /^prj_[a-f0-9]{12}$/);
});

test('machine registry cleans stale sessions and preserves live sessions', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-registry-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const liveAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-live-'));
    const staleAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-stale-'));
    const liveRecord = createDevSessionRecord({
        appRoot: liveAppRoot,
        port: 3101,
        sessionFilePath: path.join(liveAppRoot, 'var/run/proteum/dev/3101.json'),
    });
    const staleRecord = {
        ...createDevSessionRecord({
            appRoot: staleAppRoot,
            port: 3102,
            sessionFilePath: path.join(staleAppRoot, 'var/run/proteum/dev/3102.json'),
        }),
        pid: 999999,
    };

    const liveMachineRecord = await writeMachineDevSessionRecord(liveRecord);
    const staleMachineRecord = await writeMachineDevSessionRecord(staleRecord);
    const invalidFilePath = path.join(registryDir, 'invalid.json');
    fs.writeFileSync(invalidFilePath, '{ invalid json');

    const inspections = await listMachineDevSessionInspections();

    assert.deepEqual(
        inspections.map((inspection) => inspection.record.projectId),
        [liveMachineRecord.projectId],
    );
    assert.equal(fs.existsSync(resolveMachineDevSessionFilePath(liveMachineRecord.projectId)), true);
    assert.equal(fs.existsSync(resolveMachineDevSessionFilePath(staleMachineRecord.projectId)), false);
    assert.equal(fs.existsSync(invalidFilePath), false);
});

test('machine MCP daemon registry cleans stale records and resolves port override', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_MCP_DIR;
    const previousPort = process.env.PROTEUM_MCP_PORT;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-mcp-daemon-'));
    process.env.PROTEUM_MACHINE_MCP_DIR = registryDir;
    process.env.PROTEUM_MCP_PORT = '4567';
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_MCP_DIR;
        else process.env.PROTEUM_MACHINE_MCP_DIR = previousRegistryDir;
        if (previousPort === undefined) delete process.env.PROTEUM_MCP_PORT;
        else process.env.PROTEUM_MCP_PORT = previousPort;
    });

    const liveRecord = createMachineMcpDaemonRecord({
        command: [process.execPath, 'cli/bin.js', 'mcp', '--daemon'],
        port: resolveMachineMcpDaemonPort(),
    });
    await writeMachineMcpDaemonRecord(liveRecord);

    const liveInspection = await inspectMachineMcpDaemonRecord();

    assert.equal(liveInspection.live, true);
    assert.equal(liveInspection.record.port, 4567);
    assert.equal(liveInspection.record.mcpUrl, 'http://127.0.0.1:4567/mcp');

    await writeMachineMcpDaemonRecord({
        ...liveRecord,
        pid: 999999,
    });

    const staleInspection = await inspectMachineMcpDaemonRecord();

    assert.equal(staleInspection.live, false);
    assert.equal(staleInspection.stale, true);
    assert.equal(fs.existsSync(resolveMachineMcpDaemonRecordFilePath()), false);
});

test('machine MCP router rejects app-bound tools without projectId', async () => {
    const server = createProteumMachineMcpServer({ version: 'test' });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'runtime_status', arguments: {} });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Missing required projectId/);
    assert.match(result.content[0].text, /projects_list/);

    await client.close();
    await server.close();
});

test('machine MCP router forwards app tools without leaking projectId', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-router-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-app-'));
    const sessionRecord = createDevSessionRecord({
        appRoot,
        port: 3103,
        sessionFilePath: path.join(appRoot, 'var/run/proteum/dev/3103.json'),
    });
    const machineRecord = await writeMachineDevSessionRecord({
        ...sessionRecord,
        publicUrl: 'http://localhost:3103',
        state: 'ready',
    });
    let forwardedCall = null;
    let closeCount = 0;
    const server = createProteumMachineMcpServer({
        createDevMcpClient: async () => ({
            callTool: async (input) => {
                forwardedCall = input;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ ok: true, format: 'proteum-mcp-v1', summary: 'forwarded', data: {} }),
                        },
                    ],
                };
            },
            close: async () => {
                closeCount += 1;
            },
        }),
        version: 'test',
    });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const projects = await client.callTool({ name: 'projects_list', arguments: {} });
    await client.callTool({
        name: 'orient',
        arguments: {
            projectId: machineRecord.projectId,
            query: '/domains',
        },
    });

    assert.equal(projects.content[0].text.includes(machineRecord.projectId), true);
    assert.equal(forwardedCall.name, 'orient');
    assert.deepEqual(forwardedCall.arguments, { query: '/domains' });

    await client.close();
    await server.close();
    assert.equal(closeCount, 1);
});

test('machine MCP router resolves projects by cwd and bootstraps workflow without duplicate discovery', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-workflow-router-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-monorepo-'));
    const productRoot = path.join(repoRoot, 'apps', 'product');
    const websiteRoot = path.join(repoRoot, 'apps', 'website');
    const productCwd = path.join(productRoot, 'client', 'pages');
    fs.mkdirSync(productCwd, { recursive: true });
    fs.mkdirSync(websiteRoot, { recursive: true });

    const productMachineRecord = await writeMachineDevSessionRecord({
        ...createDevSessionRecord({
            appRoot: productRoot,
            port: 3105,
            sessionFilePath: path.join(productRoot, 'var/run/proteum/dev/3105.json'),
        }),
        publicUrl: 'http://localhost:3105',
        state: 'ready',
    });
    await writeMachineDevSessionRecord({
        ...createDevSessionRecord({
            appRoot: websiteRoot,
            port: 3106,
            sessionFilePath: path.join(websiteRoot, 'var/run/proteum/dev/3106.json'),
        }),
        publicUrl: 'http://localhost:3106',
        state: 'ready',
    });

    let forwardedCall = null;
    const server = createProteumMachineMcpServer({
        createDevMcpClient: async () => ({
            callTool: async (input) => {
                forwardedCall = input;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                ok: true,
                                format: 'proteum-mcp-v1',
                                summary: 'workflow',
                                data: { runtime: { appRoot: productRoot } },
                                nextActions: [{ label: 'Diagnose Route', tool: 'diagnose', toolArgs: { path: '/domains' } }],
                            }),
                        },
                    ],
                };
            },
            close: async () => {},
        }),
        version: 'test',
    });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const monorepoResolve = await client.callTool({ name: 'project_resolve', arguments: { cwd: repoRoot } });
    const monorepoPayload = JSON.parse(monorepoResolve.content[0].text);
    assert.equal(monorepoPayload.data.projects.length, 2);
    assert.equal(monorepoPayload.data.projects.every((project) => project.matchReason === 'app-under-cwd'), true);

    const directResolve = await client.callTool({ name: 'project_resolve', arguments: { cwd: productCwd } });
    const directPayload = JSON.parse(directResolve.content[0].text);
    assert.equal(directPayload.data.projects.length, 1);
    assert.equal(directPayload.data.projects[0].projectId, productMachineRecord.projectId);
    assert.equal(directPayload.data.projects[0].matchReason, 'cwd-inside-app');

    const workflow = await client.callTool({
        name: 'workflow_start',
        arguments: { cwd: productCwd, route: '/domains', task: 'read-only runtime health pass' },
    });
    const workflowPayload = JSON.parse(workflow.content[0].text);

    assert.equal(forwardedCall.name, 'workflow_start');
    assert.deepEqual(forwardedCall.arguments, { route: '/domains', task: 'read-only runtime health pass' });
    assert.equal(workflowPayload.data.project.projectId, productMachineRecord.projectId);
    assert.equal(
        workflowPayload.nextActions.find((action) => action.tool === 'diagnose').toolArgs.projectId,
        productMachineRecord.projectId,
    );

    await client.close();
    await server.close();
});

test('machine MCP router resolves offline monorepo app candidates before dev is running', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-offline-registry-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-offline-monorepo-'));
    const productRoot = path.join(repoRoot, 'apps', 'product');
    const websiteRoot = path.join(repoRoot, 'apps', 'website');
    const domainsFile = path.join(productRoot, 'client/pages/domains.tsx');

    writeProteumAppFixture(productRoot, {
        identifier: 'ProductApp',
        name: 'Product',
        routerPort: 3020,
        clientRoutes: [
            {
                chunkId: 'domains',
                filepath: domainsFile,
                hasData: false,
                invalidOptionKeys: [],
                kind: 'client-page',
                methodName: 'page',
                normalizedOptionKeys: [],
                optionKeys: [],
                path: '/domains',
                scope: 'app',
                serviceLocalName: 'Router',
                sourceLocation: { line: 1, column: 1 },
                targetResolution: 'literal',
            },
        ],
    });
    writeProteumAppFixture(websiteRoot, {
        identifier: 'WebsiteApp',
        name: 'Website',
        routerPort: 3021,
    });

    const server = createProteumMachineMcpServer({ version: 'test' });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const resolve = await client.callTool({ name: 'project_resolve', arguments: { cwd: repoRoot } });
    const resolvePayload = JSON.parse(resolve.content[0].text);

    assert.equal(resolvePayload.data.projects.length, 2);
    assert.equal(resolvePayload.data.projects.every((project) => project.live === false), true);
    const canonicalProductRoot = fs.realpathSync(productRoot);
    assert.equal(
        resolvePayload.data.projects.some(
            (project) => project.appRoot === canonicalProductRoot && project.manifest.routerPort === 3020,
        ),
        true,
    );
    assert.match(resolvePayload.data.projects[0].nextAction.command, /npx proteum dev/);

    const workflow = await client.callTool({
        name: 'workflow_start',
        arguments: { cwd: path.join(productRoot, 'client', 'pages'), route: '/domains', task: 'read-only runtime health pass' },
    });
    const workflowPayload = JSON.parse(workflow.content[0].text);

    assert.equal(workflowPayload.ok, true);
    assert.equal(workflowPayload.data.project.live, false);
    assert.equal(workflowPayload.data.owner.top.label, '/domains');
    assert.equal(workflowPayload.nextActions[0].label, 'Start Dev');
    assert.equal(workflowPayload.nextActions.some((action) => action.tool === 'diagnose'), false);

    await client.close();
    await server.close();
});

test('machine MCP workflow_start reports fresh-copy setup blockers before dev start', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-fresh-copy-registry-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-fresh-copy-'));
    const appRoot = path.join(repoRoot, 'apps', 'product');
    writeFreshCopyFixture(appRoot, {
        identifier: 'FreshCopyApp',
        name: 'Fresh Copy',
        routerPort: 3022,
    });

    const server = createProteumMachineMcpServer({ version: 'test' });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const workflow = await client.callTool({
        name: 'workflow_start',
        arguments: { cwd: appRoot, task: 'prepare fresh copy' },
    });
    const payload = JSON.parse(workflow.content[0].text);
    const actionLabels = payload.nextActions.map((action) => action.label);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.readiness.state, 'blocked');
    assert.equal(payload.data.readiness.env.app.present, false);
    assert.equal(payload.data.readiness.dependencies.nodeModulesPresent, false);
    assert.equal(payload.data.readiness.database.detected, true);
    assert.equal(payload.data.readiness.database.generatedClientPresent, false);
    assert.equal(actionLabels.includes('Copy App Env Example'), true);
    assert.equal(actionLabels.includes('Install Dependencies'), true);
    assert.equal(actionLabels.includes('Generate Prisma Client'), true);
    assert.equal(actionLabels.includes('Start Dev'), true);
    assert.match(payload.nextActions.find((action) => action.label === 'Install Dependencies').command, /npm install/);
    assert.match(payload.nextActions.find((action) => action.label === 'Generate Prisma Client').command, /prisma generate/);
    assert.doesNotMatch(workflow.content[0].text, /mysql:\/\/user:pass/);

    await client.close();
    await server.close();
});

test('machine MCP workflow_start blocks offline unbootstrapped Codex worktrees', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-worktree-offline-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-worktree-repo-'));
    const appRoot = path.join(repoRoot, '.codex', 'worktrees', 'product');
    writeProteumAppFixture(appRoot, { identifier: 'ProductApp', name: 'Product', routerPort: 3020 });

    const server = createProteumMachineMcpServer({ version: 'test' });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const workflow = await client.callTool({ name: 'workflow_start', arguments: { cwd: appRoot, task: 'runtime health' } });
    const payload = JSON.parse(workflow.content[0].text);

    assert.equal(payload.ok, false);
    assert.match(payload.summary, /has not completed Proteum worktree bootstrap/);
    assert.equal(payload.nextActions.length, 1);
    assert.match(payload.nextActions[0].command, /proteum worktree init --source <source-app-root>/);

    await client.close();
    await server.close();
});

test('machine MCP workflow_start blocks live unbootstrapped Codex worktrees before forwarding', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-worktree-live-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-worktree-live-repo-'));
    const appRoot = path.join(repoRoot, '.codex', 'worktrees', 'product');
    writeProteumAppFixture(appRoot, { identifier: 'ProductApp', name: 'Product', routerPort: 3020 });
    await writeMachineDevSessionRecord({
        ...createDevSessionRecord({
            appRoot,
            port: 3020,
            sessionFilePath: path.join(appRoot, 'var/run/proteum/dev/3020.json'),
        }),
        publicUrl: 'http://localhost:3020',
        state: 'ready',
    });

    let forwarded = false;
    const server = createProteumMachineMcpServer({
        createDevMcpClient: async () => ({
            callTool: async () => {
                forwarded = true;
                throw new Error('should not forward');
            },
            close: async () => {},
        }),
        version: 'test',
    });
    const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const workflow = await client.callTool({ name: 'workflow_start', arguments: { cwd: appRoot, task: 'runtime health' } });
    const payload = JSON.parse(workflow.content[0].text);

    assert.equal(payload.ok, false);
    assert.equal(forwarded, false);
    assert.match(payload.nextActions[0].command, /proteum worktree init --source <source-app-root>/);

    await client.close();
    await server.close();
});

test('machine MCP offline resolution inspects occupied ports before suggesting dev start', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-offline-port-registry-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-offline-port-'));
    const otherRoot = path.join(repoRoot, 'apps', 'other');
    const productRoot = path.join(repoRoot, 'apps', 'product');
    const ownerServer = http.createServer((req, res) => {
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
        res.end('<html><body>wrong app page body that should not be routed into MCP</body></html>');
    });
    const occupiedPort = await listen(ownerServer);

    try {
        writeProteumAppFixture(productRoot, {
            identifier: 'ProductApp',
            name: 'Product',
            routerPort: occupiedPort,
        });

        const server = createProteumMachineMcpServer({ version: 'test' });
        const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        await server.connect(serverTransport);
        await client.connect(clientTransport);

        const resolve = await client.callTool({ name: 'project_resolve', arguments: { cwd: productRoot } });
        const payload = JSON.parse(resolve.content[0].text);
        const project = payload.data.projects[0];

        assert.equal(project.devPort.router.port, occupiedPort);
        assert.equal(project.devPort.router.proteum, true);
        assert.equal(project.devPort.router.matchesApp, false);
        assert.equal(project.devPort.router.app.identifier, 'OtherApp');
        assert.equal(project.nextAction.label, 'Start Dev');
        assert.match(project.nextAction.command, /npx proteum dev/);
        assert.doesNotMatch(project.nextAction.command, new RegExp(`--port ${occupiedPort}(\\D|$)`));
        assert.match(project.nextAction.reason, /alternate free pair/);
        assert.doesNotMatch(resolve.content[0].text, /wrong app page body/);

        await client.close();
        await server.close();
    } finally {
        await closeServer(ownerServer);
    }
});

test('machine MCP offline resolution does not start a second server for an untracked same-app runtime', async (t) => {
    const previousRegistryDir = process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-same-port-registry-'));
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = registryDir;
    t.onTestFinished(() => {
        if (previousRegistryDir === undefined) delete process.env.PROTEUM_MACHINE_DEV_SESSION_DIR;
        else process.env.PROTEUM_MACHINE_DEV_SESSION_DIR = previousRegistryDir;
    });

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-machine-same-port-'));
    const productRoot = path.join(repoRoot, 'apps', 'product');
    const ownerServer = http.createServer((req, res) => {
        if (req.url && req.url.startsWith('/__proteum/explain')) {
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    app: {
                        root: productRoot,
                        identity: { identifier: 'ProductApp', name: 'Product' },
                    },
                }),
            );
            return;
        }

        res.setHeader('content-type', 'text/html');
        res.end('<html><body>same app page body that should not be routed into MCP</body></html>');
    });
    const occupiedPort = await listen(ownerServer);

    try {
        writeProteumAppFixture(productRoot, {
            identifier: 'ProductApp',
            name: 'Product',
            routerPort: occupiedPort,
        });

        const server = createProteumMachineMcpServer({ version: 'test' });
        const client = new Client({ name: 'machine-mcp-test', version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        await server.connect(serverTransport);
        await client.connect(clientTransport);

        const resolve = await client.callTool({ name: 'project_resolve', arguments: { cwd: productRoot } });
        const payload = JSON.parse(resolve.content[0].text);
        const project = payload.data.projects[0];

        assert.equal(project.devPort.router.matchesApp, true);
        assert.equal(project.nextAction.label, 'Repair Runtime Tracking');
        assert.match(project.nextAction.command, /npx proteum runtime status/);
        assert.doesNotMatch(project.nextAction.command, /npx proteum dev/);
        assert.match(project.nextAction.reason, /Do not start a second dev server/);
        assert.doesNotMatch(resolve.content[0].text, /same app page body/);

        await client.close();
        await server.close();
    } finally {
        await closeServer(ownerServer);
    }
});
