import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';

import { stringifyMcpPayload, type TProteumMcpPayload } from './mcpPayloads';

export type TProteumMcpDetail = 'compact' | 'full';

export type TProteumMcpProvider = {
    diagnose: (input: {
        logsLevel?: 'silly' | 'log' | 'info' | 'warn' | 'error';
        logsLimit?: number;
        path?: string;
        query?: string;
        requestId?: string;
    }) => Promise<TProteumMcpPayload>;
    doctor: (input: { contracts?: boolean }) => Promise<TProteumMcpPayload>;
    explainSummary: (input: { query?: string }) => Promise<TProteumMcpPayload>;
    instructionsResolve: (input: { query?: string }) => Promise<TProteumMcpPayload>;
    logsTail: (input: { level?: 'silly' | 'log' | 'info' | 'warn' | 'error'; limit?: number }) => Promise<TProteumMcpPayload>;
    orient: (input: { query: string }) => Promise<TProteumMcpPayload>;
    perfRequest: (input: { query: string }) => Promise<TProteumMcpPayload>;
    perfTop: (input: { groupBy?: 'path' | 'route' | 'controller'; limit?: number; since?: string }) => Promise<TProteumMcpPayload>;
    readResource: (uri: string) => Promise<TProteumMcpPayload>;
    runtimeStatus: (input: Record<string, never>) => Promise<TProteumMcpPayload>;
    traceLatest: (input: { detail?: TProteumMcpDetail; limit?: number; offset?: number }) => Promise<TProteumMcpPayload>;
    traceShow: (input: { detail?: TProteumMcpDetail; limit?: number; offset?: number; requestId: string }) => Promise<TProteumMcpPayload>;
};

type TCreateProteumMcpServerArgs = {
    provider: TProteumMcpProvider;
    version: string;
};

const jsonToolResult = (payload: object): CallToolResult => ({
    content: [
        {
            type: 'text',
            text: stringifyMcpPayload(payload),
        },
    ],
});

const jsonResourceResult = (uri: string, payload: object): ReadResourceResult => ({
    contents: [
        {
            mimeType: 'application/json',
            text: stringifyMcpPayload(payload),
            uri,
        },
    ],
});

const readOnlyAnnotations = {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
};

const detailSchema = z.enum(['compact', 'full']).optional();
const logsLevelSchema = z.enum(['silly', 'log', 'info', 'warn', 'error']).optional();
const positiveLimitSchema = z.number().int().min(1).max(100).optional();
const offsetSchema = z.number().int().min(0).max(10_000).optional();

export const createProteumMcpServer = ({ provider, version }: TCreateProteumMcpServerArgs) => {
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

    server.registerTool(
        'runtime_status',
        {
            annotations: readOnlyAnnotations,
            description: 'Return the compact Proteum app manifest, selected dev runtime, tracked sessions, and health.',
            inputSchema: {},
            title: 'Proteum Runtime Status',
        },
        async () => jsonToolResult(await provider.runtimeStatus({})),
    );

    server.registerTool(
        'orient',
        {
            annotations: readOnlyAnnotations,
            description: 'Resolve owners, instruction files, connected boundaries, and next diagnostic actions for a query.',
            inputSchema: {
                query: z.string().min(1).describe('Route, controller, file path, connected namespace, or task query.'),
            },
            title: 'Proteum Orient',
        },
        async ({ query }) => jsonToolResult(await provider.orient({ query })),
    );

    server.registerTool(
        'instructions_resolve',
        {
            annotations: readOnlyAnnotations,
            description: 'Return the routed Proteum instruction files an agent should read for the current query.',
            inputSchema: {
                query: z.string().optional().describe('Optional task, route, file path, or area query.'),
            },
            title: 'Proteum Instruction Routing',
        },
        async ({ query }) => jsonToolResult(await provider.instructionsResolve({ query })),
    );

    server.registerTool(
        'explain_summary',
        {
            annotations: readOnlyAnnotations,
            description: 'Return a compact manifest summary or owner ranking without dumping the full generated manifest.',
            inputSchema: {
                query: z.string().optional().describe('Optional owner query. Omit for the manifest summary.'),
            },
            title: 'Proteum Explain Summary',
        },
        async ({ query }) => jsonToolResult(await provider.explainSummary({ query })),
    );

    server.registerTool(
        'doctor',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact manifest diagnostics, optionally including generated-contract diagnostics.',
            inputSchema: {
                contracts: z.boolean().optional().describe('Include generated contract diagnostics.'),
            },
            title: 'Proteum Doctor',
        },
        async ({ contracts }) => jsonToolResult(await provider.doctor({ contracts })),
    );

    server.registerTool(
        'diagnose',
        {
            annotations: readOnlyAnnotations,
            description: 'Read the dev runtime composite diagnosis for an existing trace, route, request id, or query.',
            inputSchema: {
                logsLevel: logsLevelSchema,
                logsLimit: z.number().int().min(0).max(100).optional(),
                path: z.string().optional(),
                query: z.string().optional(),
                requestId: z.string().optional(),
            },
            title: 'Proteum Diagnose',
        },
        async ({ logsLevel, logsLimit, path, query, requestId }) =>
            jsonToolResult(await provider.diagnose({ logsLevel, logsLimit, path, query, requestId })),
    );

    server.registerTool(
        'trace_latest',
        {
            annotations: readOnlyAnnotations,
            description: 'Return a compact summary of the latest request trace, with optional paginated full detail.',
            inputSchema: {
                detail: detailSchema,
                limit: positiveLimitSchema,
                offset: offsetSchema,
            },
            title: 'Proteum Latest Trace',
        },
        async ({ detail, limit, offset }) => jsonToolResult(await provider.traceLatest({ detail, limit, offset })),
    );

    server.registerTool(
        'trace_show',
        {
            annotations: readOnlyAnnotations,
            description: 'Return a compact or paginated full summary of a specific request trace.',
            inputSchema: {
                detail: detailSchema,
                limit: positiveLimitSchema,
                offset: offsetSchema,
                requestId: z.string().min(1),
            },
            title: 'Proteum Trace Show',
        },
        async ({ detail, limit, offset, requestId }) =>
            jsonToolResult(await provider.traceShow({ detail, limit, offset, requestId })),
    );

    server.registerTool(
        'perf_top',
        {
            annotations: readOnlyAnnotations,
            description: 'Return compact trace-derived performance rollups for hot routes, paths, or controllers.',
            inputSchema: {
                groupBy: z.enum(['path', 'route', 'controller']).optional(),
                limit: z.number().int().min(1).max(50).optional(),
                since: z.string().optional(),
            },
            title: 'Proteum Perf Top',
        },
        async ({ groupBy, limit, since }) => jsonToolResult(await provider.perfTop({ groupBy, limit, since })),
    );

    server.registerTool(
        'perf_request',
        {
            annotations: readOnlyAnnotations,
            description: 'Return a compact waterfall and attribution summary for one traced request id or path.',
            inputSchema: {
                query: z.string().min(1).describe('Request id or path.'),
            },
            title: 'Proteum Perf Request',
        },
        async ({ query }) => jsonToolResult(await provider.perfRequest({ query })),
    );

    server.registerTool(
        'logs_tail',
        {
            annotations: readOnlyAnnotations,
            description: 'Return capped recent Proteum dev server logs.',
            inputSchema: {
                level: logsLevelSchema,
                limit: z.number().int().min(0).max(100).optional(),
            },
            title: 'Proteum Logs Tail',
        },
        async ({ level, limit }) => jsonToolResult(await provider.logsTail({ level, limit })),
    );

    for (const [name, uri, description] of [
        ['runtime-status', 'proteum://runtime/status', 'Current compact runtime status.'],
        ['instructions-router', 'proteum://instructions/router', 'Current instruction routing contract.'],
        ['manifest-summary', 'proteum://manifest/summary', 'Compact generated manifest summary.'],
        ['trace-latest-summary', 'proteum://trace/latest/summary', 'Latest request trace summary.'],
        ['perf-top', 'proteum://perf/top', 'Current compact perf top rollup.'],
    ] as const) {
        server.registerResource(
            name,
            uri,
            {
                description,
                mimeType: 'application/json',
                title: description,
            },
            async (resourceUri) => jsonResourceResult(resourceUri.href, await provider.readResource(uri)),
        );
    }

    return server;
};
