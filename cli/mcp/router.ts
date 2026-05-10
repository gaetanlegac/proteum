import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs-extra';
import http from 'http';
import { randomUUID } from 'crypto';
import path from 'path';
import { realpath } from 'fs/promises';
import { z } from 'zod/v4';

import { buildContractsDoctorResponse } from '../../common/dev/contractsDoctor';
import { buildDoctorResponse } from '../../common/dev/diagnostics';
import { explainOwner } from '../../common/dev/inspection';
import { compactWorkflowStartResponse, createMcpPayload, stringifyMcpPayload } from '../../common/dev/mcpPayloads';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import {
    createMachineMcpDaemonRecord,
    removeMachineMcpDaemonRecord,
    removeMachineMcpDaemonRecordSync,
    writeMachineMcpDaemonRecord,
} from '../runtime/mcpDaemon';
import {
    listMachineDevSessionInspections,
    resolveProteumProjectId,
    resolveMachineDevSessionInspection,
    type TMachineDevSessionRecord,
} from '../runtime/devSessions';
import {
    createStartDevCommand,
    createRuntimeStatusCommand,
    findNearestProteumAppRoot,
    findProteumAppRootsUnder,
    readProteumAppRootSummary,
    type TProteumAppRootSummary,
} from '../utils/appRoots';
import { inspectDevPort, type TDevPortInspection } from '../runtime/ports';

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
const databaseLimitSchema = z.number().int().min(1).max(500).optional();
const databaseTimeoutSchema = z.number().int().min(100).max(30_000).optional();
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
                    reason: 'Resolve the Proteum project before calling app-bound tools.',
                },
            ],
        },
        true,
    );

const compactProject = (record: TMachineDevSessionRecord) => ({
    projectId: record.projectId,
    appRoot: record.appRoot,
    live: true,
    pid: record.pid,
    routerPort: record.routerPort,
    publicUrl: record.publicUrl,
    mcpUrl: record.mcpUrl,
    sessionFilePath: record.sessionFilePath,
    state: record.state,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
});

const compactProjectMatch = (record: TMachineDevSessionRecord, matchReason: string) => ({
    ...compactProject(record),
    matchReason,
});

type TOfflineProject = TProteumAppRootSummary & {
    devPort?: TDevPortInspection;
    live: false;
    matchReason: string;
    nextAction: {
        command: string;
        label: string;
        reason: string;
    };
    projectId: string;
    state: 'offline';
};

const createOfflineNextAction = async ({
    appRoot,
    baseRoot,
    portInspection,
    summary,
}: {
    appRoot: string;
    baseRoot?: string;
    portInspection?: TDevPortInspection;
    summary: TProteumAppRootSummary;
}) => {
    if (!summary.manifest) {
        return {
            label: 'Check Runtime Status',
            command: createRuntimeStatusCommand({ appRoot, baseRoot }),
            reason: 'Resolve the app manifest and exact dev-session recovery action before runtime diagnosis.',
        };
    }

    if (portInspection?.router.proteum && portInspection.router.matchesApp) {
        return {
            label: 'Repair Runtime Tracking',
            command: createRuntimeStatusCommand({ appRoot, baseRoot }),
            reason:
                'A Proteum runtime for this app already responds on the configured port but is not registered as a live machine project. Do not start a second dev server; use runtime status to repair or stop it before retrying workflow_start.',
        };
    }

    const startPort =
        portInspection && !portInspection.canStartOnConfiguredPort ? portInspection.recommendedPort : summary.manifest.routerPort;

    return {
        label: 'Start Dev',
        command: createStartDevCommand({
            appRoot: summary.appRoot,
            baseRoot,
            port: startPort,
        }),
        reason:
            portInspection && !portInspection.canStartOnConfiguredPort
                ? 'The configured router/HMR port pair is occupied; start exactly one tracked Proteum dev server on this alternate free pair before runtime diagnosis.'
                : 'Start exactly one tracked Proteum dev server from this app root before runtime diagnosis.',
    };
};

const compactOfflineProject = async ({
    appRoot,
    baseRoot,
    matchReason,
}: {
    appRoot: string;
    baseRoot?: string;
    matchReason: string;
}): Promise<TOfflineProject> => {
    const summary = readProteumAppRootSummary(appRoot, baseRoot);
    const portInspection = summary.manifest
        ? await inspectDevPort({
              appRoot: summary.appRoot,
              port: summary.manifest.routerPort,
          })
        : undefined;

    return {
        ...summary,
        devPort: portInspection,
        live: false,
        matchReason,
        nextAction: await createOfflineNextAction({ appRoot: summary.appRoot, baseRoot, portInspection, summary }),
        projectId: await resolveProteumProjectId(summary.appRoot),
        state: 'offline',
    };
};

const createHttpDevMcpClient = (version: string): TCreateDevMcpClient => async (record) => {
    const client = new Client({ name: 'proteum-machine-router', version });
    const transport = new StreamableHTTPClientTransport(new URL(record.mcpUrl));

    await client.connect(transport);

    return {
        callTool: async (input) => (await client.callTool(input)) as CallToolResult,
        close: async () => await client.close(),
    };
};

const stripProjectRouting = ({ cwd: _cwd, projectId: _projectId, ...input }: Record<string, unknown>) => input;

const normalizeExistingPath = async (value: string) => {
    const resolved = path.resolve(value);

    try {
        return path.normalize(await realpath(resolved));
    } catch (_error) {
        return path.normalize(resolved);
    }
};

const withTrailingSeparator = (value: string) => (value.endsWith(path.sep) ? value : `${value}${path.sep}`);

const isSameOrDescendant = (candidate: string, ancestor: string) =>
    candidate === ancestor || candidate.startsWith(withTrailingSeparator(ancestor));

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

    const closeAllClients = async () => {
        const cachedClients = [...clients.values()];
        clients.clear();
        await Promise.all(cachedClients.map(async (client) => await client.close().catch(() => undefined)));
    };

    const listLiveRecords = async () =>
        (await listMachineDevSessionInspections())
            .map((inspection) => inspection.record)
            .filter((record): record is TMachineDevSessionRecord => record !== null);

    type TProjectMatch = {
        offline?: TOfflineProject;
        project: ReturnType<typeof compactProjectMatch> | TOfflineProject;
        record?: TMachineDevSessionRecord;
    };

    const resolveProjectMatches = async ({
        cwd,
        projectId,
        query,
    }: {
        cwd?: unknown;
        projectId?: unknown;
        query?: unknown;
    }) => {
        const records = await listLiveRecords();
        const matches = new Map<string, TProjectMatch>();
        const addMatch = (record: TMachineDevSessionRecord, reason: string) => {
            if (!matches.has(record.projectId)) matches.set(record.projectId, { project: compactProjectMatch(record, reason), record });
        };
        const addOfflineMatch = async (appRoot: string, reason: string, baseRoot?: string) => {
            const offline = await compactOfflineProject({ appRoot, baseRoot, matchReason: reason });
            if (!matches.has(offline.projectId)) matches.set(offline.projectId, { offline, project: offline });
        };
        const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : '';
        const normalizedQuery = typeof query === 'string' ? query.trim() : '';

        if (normalizedProjectId) {
            const record = records.find((candidate) => candidate.projectId === normalizedProjectId);
            if (record) addMatch(record, 'projectId');
        }

        if (normalizedQuery) {
            const queryIsExistingAbsolutePath = path.isAbsolute(normalizedQuery) && fs.pathExistsSync(normalizedQuery);
            const normalizedQueryPath = queryIsExistingAbsolutePath ? await normalizeExistingPath(normalizedQuery) : '';

            for (const record of records) {
                if (
                    record.projectId === normalizedQuery ||
                    record.appRoot === normalizedQuery ||
                    record.appRoot.includes(normalizedQuery) ||
                    (normalizedQueryPath &&
                        (isSameOrDescendant(normalizedQueryPath, path.normalize(record.appRoot)) ||
                            isSameOrDescendant(path.normalize(record.appRoot), normalizedQueryPath)))
                ) {
                    addMatch(record, 'query');
                }
            }

            if (queryIsExistingAbsolutePath) {
                const nearestAppRoot = findNearestProteumAppRoot(normalizedQueryPath);
                if (nearestAppRoot) await addOfflineMatch(nearestAppRoot, 'query-inside-app', nearestAppRoot);
                else {
                    for (const appRoot of findProteumAppRootsUnder(normalizedQueryPath)) {
                        await addOfflineMatch(appRoot, 'app-under-query', normalizedQueryPath);
                    }
                }
            }
        }

        if (typeof cwd === 'string' && cwd.trim()) {
            const normalizedCwd = await normalizeExistingPath(cwd.trim());
            const directMatches = records
                .filter((record) => isSameOrDescendant(normalizedCwd, path.normalize(record.appRoot)))
                .sort((left, right) => right.appRoot.length - left.appRoot.length);

            for (const record of directMatches) addMatch(record, 'cwd-inside-app');

            if (directMatches.length === 0) {
                const childMatches = records
                    .filter((record) => isSameOrDescendant(path.normalize(record.appRoot), normalizedCwd))
                    .sort((left, right) => left.appRoot.localeCompare(right.appRoot));

                for (const record of childMatches) addMatch(record, 'app-under-cwd');
            }

            const nearestAppRoot = findNearestProteumAppRoot(normalizedCwd);
            if (nearestAppRoot) {
                await addOfflineMatch(nearestAppRoot, 'cwd-inside-app', normalizedCwd);
            } else {
                for (const appRoot of findProteumAppRootsUnder(normalizedCwd)) {
                    await addOfflineMatch(appRoot, 'app-under-cwd', normalizedCwd);
                }
            }
        }

        return [...matches.values()];
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
                arguments: stripProjectRouting(input),
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

    const createOfflineWorkflowStartResult = (offline: TOfflineProject, input: Record<string, unknown>) => {
        let manifest: ReturnType<typeof readProteumManifest>;
        try {
            manifest = readProteumManifest(offline.appRoot);
        } catch (error) {
            return jsonToolResult(
                createMcpPayload({
                    summary: `Matched offline Proteum app ${offline.appRoot}, but no readable manifest is available.`,
                    data: {
                        project: offline,
                        error: error instanceof Error ? error.message : String(error),
                    },
                    nextActions: [
                        offline.nextAction,
                        {
                            label: 'Refresh Manifest',
                            command: 'npx proteum refresh',
                            reason: 'Generate the compact manifest before owner, route, or instruction routing reads.',
                        },
                    ],
                }),
            );
        }

        const doctor = buildDoctorResponse(manifest);
        const contracts = buildContractsDoctorResponse(manifest);
        const route = typeof input.route === 'string' ? input.route : undefined;
        const file = typeof input.file === 'string' ? input.file : undefined;
        const query = typeof input.query === 'string' ? input.query : undefined;
        const task = typeof input.task === 'string' ? input.task : undefined;
        const ownerQuery = [route, file, query]
            .map((value) => value?.trim())
            .find((value): value is string => Boolean(value));
        const payload = compactWorkflowStartResponse({
            contracts,
            doctor,
            file,
            health: {
                reachable: false,
                error: 'No live tracked Proteum dev session is available for this app.',
            },
            manifest,
            owner: ownerQuery ? explainOwner(manifest, ownerQuery) : undefined,
            query,
            route,
            task,
        });

        return jsonToolResult({
            ...payload,
            data: {
                project: offline,
                ...payload.data,
            },
            nextActions: [
                offline.nextAction,
                ...(Array.isArray(payload.nextActions)
                    ? payload.nextActions.filter((action: { label?: unknown }) => action.label !== 'Start Dev')
                    : []),
            ],
        });
    };

    const workflowStart = async (input: Record<string, unknown>) => {
        const matches = await resolveProjectMatches({
            cwd: input.cwd,
            projectId: input.projectId,
            query: input.projectId ? undefined : input.cwd ? undefined : input.query,
        });

        if (matches.length !== 1) {
            return errorToolResult(
                matches.length === 0
                    ? 'Could not resolve a live or offline Proteum project for workflow_start. Pass projectId or cwd, or call project_resolve.'
                    : 'workflow_start matched multiple Proteum projects. Pass the intended projectId or app cwd.',
                {
                    matches: matches.map((match) => match.project),
                },
            );
        }

        const selectedMatch = matches[0];
        const record = selectedMatch.record;

        if (!record && selectedMatch.offline) return createOfflineWorkflowStartResult(selectedMatch.offline, input);
        if (!record) {
            return errorToolResult('Could not resolve a live Proteum project for workflow_start. Call projects_list or project_resolve.', {
                matches: matches.map((match) => match.project),
            });
        }

        try {
            const client = await getClient(record);
            const result = await client.callTool({
                arguments: stripProjectRouting(input),
                name: 'workflow_start',
            });

            if (result.content[0]?.type !== 'text') return result;

            const payload = JSON.parse(result.content[0].text);
            const routedNextActions = Array.isArray(payload.nextActions)
                ? payload.nextActions.map((action: Record<string, unknown>) =>
                      action.tool && typeof action.tool === 'string'
                          ? {
                                ...action,
                                toolArgs: {
                                    projectId: record.projectId,
                                    ...((action.toolArgs as Record<string, unknown> | undefined) || {}),
                                },
                            }
                          : action,
                  )
                : undefined;

            return jsonToolResult({
                ...payload,
                data: {
                    project: compactProject(record),
                    ...payload.data,
                },
                ...(routedNextActions && routedNextActions.length > 0 ? { nextActions: routedNextActions } : {}),
            });
        } catch (error) {
            await closeClient(record);
            return errorToolResult(`Could not reach Proteum dev MCP for ${record.projectId}.`, {
                error: error instanceof Error ? error.message : String(error),
                mcpUrl: record.mcpUrl,
                projectId: record.projectId,
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
                                      label: 'Resolve Project',
                                      tool: 'project_resolve',
                                      reason:
                                          'Pass the intended cwd so Proteum can choose the app root and inspect configured ports before suggesting a dev start.',
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
            description:
                'Resolve a Proteum project by projectId, cwd, app root, or app-root substring from live sessions or offline app roots.',
            inputSchema: {
                cwd: z.string().optional().describe('Current working directory to match to the nearest live app root.'),
                projectId: z.string().optional().describe('Optional exact project id from projects_list.'),
                query: z.string().optional().describe('Project id, app root, or distinctive app root substring.'),
            },
            title: 'Proteum Project Resolve',
        },
        async ({ cwd, projectId, query }) => {
            const normalizedQuery = query?.trim() || projectId?.trim() || cwd?.trim() || '';
            const matches = await resolveProjectMatches({ cwd, projectId, query });
            const projects = matches.map((match) => match.project);

            return jsonToolResult(
                createMcpPayload({
                    summary:
                        projects.length === 0
                            ? `No live or offline Proteum project matched ${normalizedQuery || 'the provided project selector'}.`
                            : `Matched ${projects.length} Proteum project${projects.length === 1 ? '' : 's'}.`,
                    data: { cwd, projectId, projects, query: normalizedQuery },
                    nextActions:
                        projects.length === 1
                            ? [
                                  {
                                      label: 'Workflow Start',
                                      tool: 'workflow_start',
                                      toolArgs:
                                          projects[0].live === true
                                              ? { projectId: projects[0].projectId }
                                              : { cwd: projects[0].appRoot },
                                      reason: 'Bootstrap compact runtime, instruction, owner, and next-action context in one MCP call.',
                                  },
                              ]
                            : projects.length === 0
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
        'workflow_start',
        {
            annotations: readOnlyAnnotations,
            description:
                'Resolve one live or offline project and return compact runtime, instruction, owner, doctor, and next-action context in one read.',
            inputSchema: {
                cwd: z.string().optional().describe('Current working directory. Used only to resolve projectId.'),
                file: z.string().optional().describe('Optional source file or generated artifact path in scope.'),
                projectId: projectIdSchema,
                query: z.string().optional().describe('Optional task, route, controller, file, or owner query.'),
                route: z.string().optional().describe('Optional route path in scope.'),
                task: z.string().optional().describe('Optional short natural-language task description.'),
            },
            title: 'Proteum Workflow Start',
        },
        async (input) => await workflowStart(input),
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
        'route_candidates',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact route candidates for a live project without dumping raw route arrays.',
            inputSchema: {
                limit: z.number().int().min(1).max(50).optional(),
                projectId: projectIdSchema,
                query: z.string().min(1).describe('Route path or route-like search query.'),
            },
            title: 'Proteum Route Candidates',
        },
        async (input) => await forwardTool('route_candidates', input),
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

    server.registerTool(
        'db_query',
        {
            annotations: readOnlyAnnotations,
            description: 'Run one capped read-only database diagnostic query for one live Proteum project.',
            inputSchema: {
                limit: databaseLimitSchema,
                projectId: projectIdSchema,
                sql: z.string().min(1).describe('One SELECT, SHOW, or EXPLAIN SQL statement.'),
                timeoutMs: databaseTimeoutSchema,
            },
            title: 'Proteum Database Query',
        },
        async (input) => await forwardTool('db_query', input),
    );

    const closeServer = server.close.bind(server);
    server.close = async () => {
        await closeAllClients();
        await closeServer();
    };

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
