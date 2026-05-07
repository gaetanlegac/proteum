import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { randomUUID } from 'crypto';
import { z } from 'zod/v4';

import { createMcpPayload, stringifyMcpPayload } from '../../common/dev/mcpPayloads';
import {
    createMachineMcpDaemonRecord,
    removeMachineMcpDaemonRecord,
    removeMachineMcpDaemonRecordSync,
    writeMachineMcpDaemonRecord,
} from '../runtime/mcpDaemon';
import {
    listMachineDevSessionInspections,
    resolveMachineDevSessionInspection,
    type TMachineDevSessionRecord,
} from '../runtime/devSessions';

type TDevMcpClient = {
    callTool: (input: { arguments?: Record<string, unknown>; name: string }) => Promise<CallToolResult>;
    close: () => Promise<void>;
};

type TCreateDevMcpClient = (record: TMachineDevSessionRecord) => Promise<TDevMcpClient>;

type TCreateProteumMachineMcpServerArgs = {
    createDevMcpClient?: TCreateDevMcpClient;
    version: string;
};

const readOnlyAnnotations = {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
};

const detailSchema = z.enum(['compact', 'full']).optional();
const logsLevelSchema = z.enum(['silly', 'log', 'info', 'warn', 'error']).optional();
const offsetSchema = z.number().int().min(0).max(10_000).optional();
const positiveLimitSchema = z.number().int().min(1).max(100).optional();
const projectIdSchema = z
    .string()
    .min(1)
    .optional()
    .describe('Required stable project id from projects_list, for example prj_0123abcd4567.');

const jsonToolResult = (payload: object, isError = false): CallToolResult => ({
    content: [
        {
            type: 'text',
            text: stringifyMcpPayload(payload),
        },
    ],
    ...(isError ? { isError: true } : {}),
});

const errorToolResult = (summary: string, data: Record<string, unknown> = {}) =>
    jsonToolResult(
        {
            ok: false,
            format: 'proteum-mcp-v1',
            summary,
            data,
            nextActions: [
                {
                    label: 'List Projects',
                    tool: 'projects_list',
                    reason: 'Resolve the live Proteum dev projectId before calling app-bound tools.',
                },
            ],
        },
        true,
    );

const compactProject = (record: TMachineDevSessionRecord) => ({
    projectId: record.projectId,
    appRoot: record.appRoot,
    pid: record.pid,
    routerPort: record.routerPort,
    publicUrl: record.publicUrl,
    mcpUrl: record.mcpUrl,
    sessionFilePath: record.sessionFilePath,
    state: record.state,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
});

const createHttpDevMcpClient = (version: string): TCreateDevMcpClient => async (record) => {
    const client = new Client({ name: 'proteum-machine-router', version });
    const transport = new StreamableHTTPClientTransport(new URL(record.mcpUrl));

    await client.connect(transport);

    return {
        callTool: async (input) => (await client.callTool(input)) as CallToolResult,
        close: async () => await client.close(),
    };
};

const stripProjectId = ({ projectId: _projectId, ...input }: Record<string, unknown>) => input;

export const createProteumMachineMcpServer = ({ createDevMcpClient, version }: TCreateProteumMachineMcpServerArgs) => {
    const server = new McpServer(
        {
            name: 'proteum',
            version,
        },
        {
            capabilities: {
                logging: {},
            },
        },
    );
    const clients = new Map<string, TDevMcpClient>();
    const resolveDevMcpClient = createDevMcpClient || createHttpDevMcpClient(version);

    const cacheKey = (record: TMachineDevSessionRecord) => `${record.projectId}:${record.mcpUrl}`;

    const getClient = async (record: TMachineDevSessionRecord) => {
        const key = cacheKey(record);
        const cached = clients.get(key);
        if (cached) return cached;

        const client = await resolveDevMcpClient(record);
        clients.set(key, client);
        return client;
    };

    const closeClient = async (record: TMachineDevSessionRecord) => {
        const key = cacheKey(record);
        const client = clients.get(key);
        clients.delete(key);
        if (client) await client.close().catch(() => undefined);
    };

    const resolveProject = async (projectId: unknown) => {
        if (typeof projectId !== 'string' || !projectId.trim()) {
            return {
                error: errorToolResult('Missing required projectId. Call projects_list, then pass the selected projectId.'),
                record: null,
            };
        }

        const inspection = await resolveMachineDevSessionInspection(projectId.trim());
        if (!inspection?.record) {
            return {
                error: errorToolResult(`Unknown or stale Proteum projectId: ${projectId}. Call projects_list and retry.`, {
                    projectId,
                }),
                record: null,
            };
        }

        return { error: null, record: inspection.record };
    };

    const forwardTool = async (name: string, input: Record<string, unknown>) => {
        const resolution = await resolveProject(input.projectId);
        if (!resolution.record) return resolution.error;

        try {
            const client = await getClient(resolution.record);
            return await client.callTool({
                arguments: stripProjectId(input),
                name,
            });
        } catch (error) {
            await closeClient(resolution.record);
            return errorToolResult(`Could not reach Proteum dev MCP for ${resolution.record.projectId}.`, {
                error: error instanceof Error ? error.message : String(error),
                mcpUrl: resolution.record.mcpUrl,
                projectId: resolution.record.projectId,
            });
        }
    };

    server.registerTool(
        'projects_list',
        {
            annotations: readOnlyAnnotations,
            description: 'List live Proteum dev projects on this machine and their stable projectId values.',
            inputSchema: {},
            title: 'Proteum Projects List',
        },
        async () => {
            const inspections = await listMachineDevSessionInspections();
            const projects = inspections
                .map((inspection) => inspection.record)
                .filter((record): record is TMachineDevSessionRecord => record !== null)
                .map(compactProject);

            return jsonToolResult(
                createMcpPayload({
                    summary:
                        projects.length === 0
                            ? 'No live Proteum dev projects found on this machine.'
                            : `Found ${projects.length} live Proteum dev project${projects.length === 1 ? '' : 's'}.`,
                    data: { projects },
                    nextActions:
                        projects.length === 0
                            ? [
                                  {
                                      label: 'Start Dev',
                                      command:
                                          'proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>',
                                      reason: 'Start exactly one tracked Proteum dev server in the intended worktree.',
                                  },
                              ]
                            : [],
                }),
            );
        },
    );

    server.registerTool(
        'project_resolve',
        {
            annotations: readOnlyAnnotations,
            description: 'Resolve a Proteum project by projectId or appRoot substring from the live machine registry.',
            inputSchema: {
                query: z.string().min(1).describe('Project id, app root, or distinctive app root substring.'),
            },
            title: 'Proteum Project Resolve',
        },
        async ({ query }) => {
            const normalizedQuery = query.trim();
            const inspections = await listMachineDevSessionInspections();
            const projects = inspections
                .map((inspection) => inspection.record)
                .filter((record): record is TMachineDevSessionRecord => record !== null)
                .filter(
                    (record) =>
                        record.projectId === normalizedQuery ||
                        record.appRoot === normalizedQuery ||
                        record.appRoot.includes(normalizedQuery),
                )
                .map(compactProject);

            return jsonToolResult(
                createMcpPayload({
                    summary:
                        projects.length === 0
                            ? `No live Proteum dev project matched ${normalizedQuery}.`
                            : `Matched ${projects.length} live Proteum dev project${projects.length === 1 ? '' : 's'}.`,
                    data: { projects, query: normalizedQuery },
                    nextActions:
                        projects.length === 0
                            ? [
                                  {
                                      label: 'List Projects',
                                      tool: 'projects_list',
                                      reason: 'Inspect all live Proteum dev projectId values.',
                                  },
                              ]
                            : [],
                }),
            );
        },
    );

    server.registerTool(
        'runtime_status',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact runtime status for one live Proteum dev project selected by projectId.',
            inputSchema: { projectId: projectIdSchema },
            title: 'Proteum Runtime Status',
        },
        async (input) => await forwardTool('runtime_status', input),
    );

    server.registerTool(
        'orient',
        {
            annotations: readOnlyAnnotations,
            description: 'Resolve owners, instructions, connected boundaries, and next actions for a project query.',
            inputSchema: {
                projectId: projectIdSchema,
                query: z.string().min(1).describe('Route, controller, file path, connected namespace, or task query.'),
            },
            title: 'Proteum Orient',
        },
        async (input) => await forwardTool('orient', input),
    );

    server.registerTool(
        'instructions_resolve',
        {
            annotations: readOnlyAnnotations,
            description: 'Return routed Proteum instruction files for one live project.',
            inputSchema: {
                projectId: projectIdSchema,
                query: z.string().optional().describe('Optional task, route, file path, or area query.'),
            },
            title: 'Proteum Instruction Routing',
        },
        async (input) => await forwardTool('instructions_resolve', input),
    );

    server.registerTool(
        'explain_summary',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact manifest summary or owner ranking for one live project.',
            inputSchema: {
                projectId: projectIdSchema,
                query: z.string().optional().describe('Optional owner query. Omit for manifest summary.'),
            },
            title: 'Proteum Explain Summary',
        },
        async (input) => await forwardTool('explain_summary', input),
    );

    server.registerTool(
        'doctor',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact diagnostics for one live Proteum project.',
            inputSchema: {
                contracts: z.boolean().optional().describe('Include generated contract diagnostics.'),
                projectId: projectIdSchema,
            },
            title: 'Proteum Doctor',
        },
        async (input) => await forwardTool('doctor', input),
    );

    server.registerTool(
        'diagnose',
        {
            annotations: readOnlyAnnotations,
            description: 'Read composite diagnosis for one live Proteum project.',
            inputSchema: {
                logsLevel: logsLevelSchema,
                logsLimit: z.number().int().min(0).max(100).optional(),
                path: z.string().optional(),
                projectId: projectIdSchema,
                query: z.string().optional(),
                requestId: z.string().optional(),
            },
            title: 'Proteum Diagnose',
        },
        async (input) => await forwardTool('diagnose', input),
    );

    server.registerTool(
        'trace_latest',
        {
            annotations: readOnlyAnnotations,
            description: 'Return latest trace summary for one live Proteum project.',
            inputSchema: {
                detail: detailSchema,
                limit: positiveLimitSchema,
                offset: offsetSchema,
                projectId: projectIdSchema,
            },
            title: 'Proteum Latest Trace',
        },
        async (input) => await forwardTool('trace_latest', input),
    );

    server.registerTool(
        'trace_show',
        {
            annotations: readOnlyAnnotations,
            description: 'Return a specific trace summary for one live Proteum project.',
            inputSchema: {
                detail: detailSchema,
                limit: positiveLimitSchema,
                offset: offsetSchema,
                projectId: projectIdSchema,
                requestId: z.string().min(1),
            },
            title: 'Proteum Trace Show',
        },
        async (input) => await forwardTool('trace_show', input),
    );

    server.registerTool(
        'perf_top',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact performance rollups for one live Proteum project.',
            inputSchema: {
                groupBy: z.enum(['path', 'route', 'controller']).optional(),
                limit: z.number().int().min(1).max(50).optional(),
                projectId: projectIdSchema,
                since: z.string().optional(),
            },
            title: 'Proteum Perf Top',
        },
        async (input) => await forwardTool('perf_top', input),
    );

    server.registerTool(
        'perf_request',
        {
            annotations: readOnlyAnnotations,
            description: 'Return one request waterfall for one live Proteum project.',
            inputSchema: {
                projectId: projectIdSchema,
                query: z.string().min(1).describe('Request id or path.'),
            },
            title: 'Proteum Perf Request',
        },
        async (input) => await forwardTool('perf_request', input),
    );

    server.registerTool(
        'logs_tail',
        {
            annotations: readOnlyAnnotations,
            description: 'Return capped recent logs for one live Proteum project.',
            inputSchema: {
                level: logsLevelSchema,
                limit: z.number().int().min(0).max(100).optional(),
                projectId: projectIdSchema,
            },
            title: 'Proteum Logs Tail',
        },
        async (input) => await forwardTool('logs_tail', input),
    );

    return server;
};

export const startProteumMachineMcpRouter = async ({ version }: { version: string }) => {
    const server = createProteumMachineMcpServer({ version });
    const transport = new StdioServerTransport();

    await server.connect(transport);
};

const readJsonBody = async (req: http.IncomingMessage) =>
    await new Promise<unknown>((resolve, reject) => {
        const chunks: Buffer[] = [];

        req.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on('error', reject);
        req.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8').trim();
            if (!rawBody) {
                resolve(undefined);
                return;
            }

            try {
                resolve(JSON.parse(rawBody));
            } catch (error) {
                reject(error);
            }
        });
    });

const readSessionId = (req: http.IncomingMessage) => {
    const value = req.headers['mcp-session-id'];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' && value.trim() ? value : undefined;
};

const writeJson = (res: http.ServerResponse, statusCode: number, payload: unknown) => {
    const body = JSON.stringify(payload);

    res.writeHead(statusCode, {
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json',
    });
    res.end(body);
};

const writeJsonRpcError = (res: http.ServerResponse, statusCode: number, message: string) => {
    writeJson(res, statusCode, {
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message,
        },
        id: null,
    });
};

export const startProteumMachineMcpRouterHttp = async ({
    port,
    version,
}: {
    port: number;
    version: string;
}) => {
    type TMcpTransportEntry = {
        server: ReturnType<typeof createProteumMachineMcpServer>;
        transport: StreamableHTTPServerTransport;
    };
    const transports = new Map<string, TMcpTransportEntry>();
    let daemonRecordWritten = false;

    const httpServer = http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);

        if (requestUrl.pathname === '/health') {
            writeJson(res, 200, {
                ok: true,
                format: 'proteum-mcp-daemon-v1',
                pid: process.pid,
                mcpUrl: `http://127.0.0.1:${port}/mcp`,
            });
            return;
        }

        if (requestUrl.pathname !== '/mcp') {
            writeJson(res, 404, {
                ok: false,
                format: 'proteum-mcp-daemon-v1',
                summary: 'Unknown Proteum MCP daemon route.',
            });
            return;
        }

        const sessionId = readSessionId(req);
        let entry = sessionId ? transports.get(sessionId) : undefined;

        try {
            const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;

            if (!entry && !sessionId && req.method === 'POST' && isInitializeRequest(parsedBody)) {
                const server = createProteumMachineMcpServer({ version });
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (initializedSessionId) => {
                        transports.set(initializedSessionId, { server, transport });
                    },
                });

                transport.onclose = () => {
                    const transportSessionId = transport.sessionId;
                    if (transportSessionId) transports.delete(transportSessionId);
                    void server.close().catch(() => undefined);
                };

                await server.connect(transport);
                entry = { server, transport };
            }

            if (!entry) {
                writeJsonRpcError(res, 400, 'Bad Request: initialize the Proteum machine MCP session before sending requests.');
                return;
            }

            await entry.transport.handleRequest(req, res, parsedBody);
        } catch (error) {
            if (!res.headersSent) {
                writeJsonRpcError(
                    res,
                    500,
                    error instanceof Error ? error.message : 'Internal Proteum machine MCP server error.',
                );
            }
        }
    });

    const closeTransports = async () => {
        await Promise.all(
            [...transports.values()].map(async (entry) => {
                entry.transport.onclose = undefined;
                await entry.server.close().catch(() => undefined);
                await entry.transport.close().catch(() => undefined);
            }),
        );
        transports.clear();
    };

    process.once('exit', () => {
        if (daemonRecordWritten) removeMachineMcpDaemonRecordSync();
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
            void (async () => {
                await closeTransports();
                await removeMachineMcpDaemonRecord();
                httpServer.close(() => process.exit(0));
            })();
        });
    }

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '127.0.0.1', () => {
            httpServer.off('error', reject);
            resolve();
        });
    });

    await writeMachineMcpDaemonRecord(
        createMachineMcpDaemonRecord({
            command: [process.execPath, ...process.argv.slice(1)],
            port,
        }),
    );
    daemonRecordWritten = true;
};
