const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');
require('../cli/context.ts');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpPayload, compactTraceResponse, resolveInstructionRouting } = require('../common/dev/mcpPayloads.ts');
const { createProteumMcpServer } = require('../common/dev/mcpServer.ts');
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
        diagnose: async () => payload,
        doctor: async () => payload,
        explainSummary: async () => payload,
        instructionsResolve: async () => payload,
        logsTail: async () => payload,
        orient: async () => payload,
        perfRequest: async () => payload,
        perfTop: async () => payload,
        readResource: async () => payload,
        runtimeStatus: async () => payload,
        traceLatest: async () => payload,
        traceShow: async () => payload,
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
    t.after(() => {
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
    t.after(() => {
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
    t.after(() => {
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
            close: async () => {},
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
});
