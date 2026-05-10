import type { TDevConsoleLogLevel, TDevConsoleLogsResponse } from './console';
import type { TDatabaseReadQueryResponse } from './database';
import type { TDoctorResponse } from './diagnostics';
import { buildExplainSummaryItems } from './diagnostics';
import { explainOwner, type TDiagnoseResponse, type TExplainOwnerResponse, type TOrientResponse } from './inspection';
import type { TPerfRequestResponse, TPerfTopResponse } from './performance';
import type { TProteumManifest } from './proteumManifest';
import type { TRequestTrace } from './requestTrace';

export type TProteumMcpNextAction = {
    command?: string;
    label: string;
    reason?: string;
    tool?: string;
    toolArgs?: Record<string, unknown>;
};

export type TProteumMcpOmittedDetail = {
    reason: string;
    command?: string;
    tool?: string;
    toolArgs?: Record<string, unknown>;
};

export type TProteumMcpPayload<TData extends object = Record<string, unknown>> = {
    ok: true;
    format: 'proteum-mcp-v1';
    summary: string;
    data: TData;
    nextActions?: TProteumMcpNextAction[];
    omitted?: TProteumMcpOmittedDetail[];
};

type TNodeFs = {
    existsSync: (filepath: string) => boolean;
    readFileSync: (filepath: string, encoding: 'utf8') => string;
    statSync: (filepath: string) => { isDirectory: () => boolean };
};

type TNodePath = {
    dirname: (filepath: string) => string;
    isAbsolute: (filepath: string) => boolean;
    join: (...segments: string[]) => string;
    relative: (from: string, to: string) => string;
    resolve: (...segments: string[]) => string;
};

const maxInstructionPreviewLength = 360;
const maxTextLength = 220;
const nodeRequire = (() => {
    try {
        return eval('require') as NodeRequire;
    } catch (_error) {
        return undefined;
    }
})();
const fs = nodeRequire ? (nodeRequire('fs') as TNodeFs) : undefined;
const path = nodeRequire ? (nodeRequire('path') as TNodePath) : undefined;

const hasNodeFs = () => fs !== undefined;
const hasNodePath = () => path !== undefined;
const fileExists = (filepath: string) => fs !== undefined && fs.existsSync(filepath);
const directoryExists = (filepath: string) => {
    if (fs === undefined || !fs.existsSync(filepath)) return false;
    try {
        return fs.statSync(filepath).isDirectory();
    } catch (_error) {
        return false;
    }
};

export const truncateForMcp = (value: string, max = maxTextLength) =>
    value.length <= max ? value : `${value.slice(0, max)}...`;

export const compactList = <TValue>(values: TValue[], limit: number) => values.slice(0, Math.max(0, limit));

export type TTriggeredInstructionRead = {
    file: string;
    reason: string;
};

const matchesInstructionTrigger = (query: string, pattern: RegExp) => pattern.test(query);

const resolveRootContractFallbackFile = (rootAgentsFile?: string) => {
    if (fs === undefined || path === undefined || !rootAgentsFile || !fileExists(rootAgentsFile)) return undefined;

    const content = fs.readFileSync(rootAgentsFile, 'utf8');
    const match = content.match(/Root contract fallback:\s+(.+?)\s*$/m);
    const candidate = match?.[1]?.trim();
    if (!candidate) return undefined;

    const filepath = path.isAbsolute(candidate) ? candidate : path.resolve(path.dirname(rootAgentsFile), candidate);
    return fileExists(filepath) ? filepath : undefined;
};

export const resolveTriggeredInstructionReads = ({
    codingStyle,
    diagnostics,
    documentation,
    optimizations,
    query,
    rootAgentsFile,
}: {
    codingStyle?: string;
    diagnostics?: string;
    documentation?: string;
    optimizations?: string;
    query: string;
    rootAgentsFile?: string;
}) => {
    const normalizedQuery = query.toLowerCase();
    const reads = new Map<string, TTriggeredInstructionRead>();
    const addRead = (file: string | undefined, reason: string) => {
        if (!file || !fileExists(file) || reads.has(file)) return;
        reads.set(file, { file, reason });
    };
    const rootContract = resolveRootContractFallbackFile(rootAgentsFile);
    const looksLikeGitLifecycle = matchesInstructionTrigger(
        normalizedQuery,
        /\b(commit|stage|push)\b|\band commit\b|\bpr\b|pull[- ]requests?|git add|git commit/,
    );
    const looksLikeFinishLifecycle = matchesInstructionTrigger(
        normalizedQuery,
        /\b(finish|finishing|done|complete|completion|final|validate|validation|verify|verification)\b/,
    );
    const looksLikeRuntimeVisible = matchesInstructionTrigger(
        normalizedQuery,
        /\b(runtime|request-time|request time|router|ssr|browser-visible|browser visible|controller|diagnose|trace|perf|repro|reproduction|failing|error|bug)\b/,
    );
    const looksLikeImplementationEdit = matchesInstructionTrigger(
        normalizedQuery,
        /\b(implement|change|edit|update|modify|fix|add|remove|refactor|increase|decrease|code)\b/,
    );
    const looksLikeProductOrDocs = matchesInstructionTrigger(
        normalizedQuery,
        /\b(feature|product|business|acceptance|docs|documentation|ux|copy|onboarding|pricing|commercial|semantics)\b/,
    );
    const looksLikeOptimization = matchesInstructionTrigger(
        normalizedQuery,
        /\b(optimize|optimization|performance|package|dependency|build|bundle)\b/,
    );

    if (looksLikeGitLifecycle) {
        addRead(rootContract, 'Git lifecycle trigger; read the canonical root contract before any git write.');
    }
    if (looksLikeFinishLifecycle) {
        addRead(rootContract, 'Finish or verification trigger; read the canonical root lifecycle contract.');
    }
    if (looksLikeRuntimeVisible) {
        addRead(rootContract, 'Runtime-visible behavior trigger; read the canonical root verification contract.');
        addRead(diagnostics, 'Runtime, request, trace, perf, reproduction, or error trigger.');
    }
    if (looksLikeImplementationEdit) {
        addRead(codingStyle, 'Implementation edit trigger; read coding style before editing.');
    }
    if (looksLikeProductOrDocs) {
        addRead(documentation, 'Feature, product, business-rule, UX, copy, or docs trigger.');
    }
    if (looksLikeOptimization) {
        addRead(optimizations, 'Package, build, runtime, performance, or optimization trigger.');
    }

    return [...reads.values()];
};

export const createMcpPayload = <TData extends object>({
    data,
    nextActions,
    omitted,
    summary,
}: Omit<TProteumMcpPayload<TData>, 'format' | 'ok'>): TProteumMcpPayload<TData> => ({
    ok: true,
    format: 'proteum-mcp-v1',
    summary,
    data,
    ...(nextActions && nextActions.length > 0 ? { nextActions } : {}),
    ...(omitted && omitted.length > 0 ? { omitted } : {}),
});

export const stringifyMcpPayload = (value: object) => JSON.stringify(value);

export const summarizeManifest = (manifest: TProteumManifest | undefined) => {
    if (!manifest) return undefined;

    const errors = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warnings = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;

    return {
        appRoot: manifest.app.root,
        coreRoot: manifest.app.coreRoot,
        identifier: manifest.app.identity.identifier,
        name: manifest.app.identity.name,
        routerPort: manifest.env.resolved.routerPort,
        env: {
            name: manifest.env.resolved.name,
            profile: manifest.env.resolved.profile,
            internalUrl: manifest.env.resolved.routerInternalUrl,
        },
        diagnostics: { errors, warnings },
        counts: {
            commands: manifest.commands.length,
            connectedProjects: manifest.connectedProjects.length,
            controllers: manifest.controllers.length,
            layouts: manifest.layouts.length,
            routes: manifest.routes.client.length + manifest.routes.server.length,
            clientRoutes: manifest.routes.client.length,
            serverRoutes: manifest.routes.server.length,
            services: manifest.services.app.length + manifest.services.routerPlugins.length,
        },
    };
};

const compactOwnerMatch = (match: TExplainOwnerResponse['matches'][number]) => ({
    kind: match.kind,
    label: match.label,
    score: match.score,
    scope: match.scopeLabel,
    origin: match.originHint,
    source: match.source,
});

const compactDiagnostic = (diagnostic: TDoctorResponse['diagnostics'][number]) => ({
    level: diagnostic.level,
    code: diagnostic.code,
    message: truncateForMcp(diagnostic.message),
    filepath: diagnostic.filepath,
    sourceLocation: diagnostic.sourceLocation,
    fixHint: diagnostic.fixHint ? truncateForMcp(diagnostic.fixHint) : undefined,
});

export const compactDoctorResponse = ({
    contracts,
    doctor,
}: {
    contracts?: TDoctorResponse;
    doctor: TDoctorResponse;
}) =>
    createMcpPayload({
        summary: contracts
            ? `Doctor: ${doctor.summary.errors} errors/${doctor.summary.warnings} warnings; contracts: ${contracts.summary.errors} errors/${contracts.summary.warnings} warnings`
            : `Doctor: ${doctor.summary.errors} errors/${doctor.summary.warnings} warnings`,
        data: {
            doctor: {
                summary: doctor.summary,
                top: compactList(doctor.diagnostics, 8).map(compactDiagnostic),
                total: doctor.diagnostics.length,
            },
            contracts: contracts
                ? {
                      summary: contracts.summary,
                      top: compactList(contracts.diagnostics, 8).map(compactDiagnostic),
                      total: contracts.diagnostics.length,
                  }
                : undefined,
        },
        omitted:
            doctor.diagnostics.length > 8 || (contracts && contracts.diagnostics.length > 8)
                ? [
                      {
                          reason: 'Diagnostics are capped in MCP output. Use the CLI full-detail command when every diagnostic is required.',
                          command: 'proteum doctor --full',
                      },
                  ]
                : undefined,
    });

export const compactOrientationResponse = (response: TOrientResponse) => {
    const topOwner = response.owner.matches[0];
    const summary = topOwner
        ? `${response.query} -> ${topOwner.kind} ${topOwner.label} (${topOwner.scopeLabel})`
        : `${response.query} -> no manifest owner matched`;
    const topPath =
        topOwner && (topOwner.kind === 'route' || topOwner.kind === 'controller') && topOwner.label.startsWith('/')
            ? topOwner.label
            : response.query.startsWith('/')
              ? response.query
              : undefined;
    const triggered = resolveTriggeredInstructionReads({
        codingStyle: response.guidance.codingStyle,
        diagnostics: response.guidance.diagnostics,
        documentation: response.guidance.documentation,
        optimizations: response.guidance.optimizations,
        query: response.normalizedQuery || response.query,
        rootAgentsFile:
            path !== undefined && response.app.repoRoot !== response.app.appRoot
                ? path.join(response.app.repoRoot, 'AGENTS.md')
                : response.guidance.agents,
    });

    return createMcpPayload({
        summary,
        data: {
            query: response.query,
            app: response.app,
            owner: {
                top: topOwner ? compactOwnerMatch(topOwner) : undefined,
                matches: compactList(response.owner.matches, 5).map(compactOwnerMatch),
                totalReturned: response.owner.matches.length,
            },
            instructions: {
                mustRead: [
                    ...new Set([
                        response.guidance.agents,
                        ...response.guidance.areaAgents,
                        ...triggered.map((entry) => entry.file),
                    ]),
                ],
                triggered,
                readWhen: [
                    {
                        file: response.guidance.documentation,
                        when: 'Non-trivial coding tasks that need the smallest `/docs` pack and post-change docs updates.',
                    },
                    {
                        file: response.guidance.diagnostics,
                        when: 'Raw errors, failing requests, traces, perf regressions, or reproduction work.',
                    },
                    {
                        file: response.guidance.codingStyle,
                        when: 'Before editing implementation files.',
                    },
                    {
                        file: response.guidance.optimizations,
                        when: 'Client-side implementation, packages, build, runtime, or performance work.',
                    },
                ],
            },
            connected: {
                imports: compactList(response.connected.imports, 5),
                producers: compactList(response.connected.producers, 4),
                totalImports: response.connected.imports.length,
                totalProducers: response.connected.producers.length,
            },
            warnings: response.warnings,
        },
        nextActions: [
            ...(topOwner
                ? [
                      {
                          label: 'Explain Summary',
                          tool: 'explain_summary',
                          toolArgs: { query: response.query },
                          reason: 'Use MCP owner summary before broad manifest or source searches.',
                      },
                  ]
                : []),
            ...(topPath
                ? [
                      {
                          label: 'Diagnose Route',
                          tool: 'diagnose',
                          toolArgs: { path: topPath, query: response.query },
                          reason: 'Use the compact runtime diagnosis before CLI diagnose, raw traces, or browser work.',
                      },
                      {
                          label: 'Perf Request',
                          tool: 'perf_request',
                          toolArgs: { query: topPath },
                          reason: 'Use the compact request waterfall before raw perf detail.',
                      },
                  ]
                : []),
            ...response.nextSteps.map((step) => ({
                command: step.command,
                label: step.label,
                reason: step.reason,
            })),
        ],
    });
};

export const compactExplainSummary = ({
    manifest,
    owner,
    query,
}: {
    manifest: TProteumManifest;
    owner?: TExplainOwnerResponse;
    query?: string;
}) => {
    if (owner) {
        const topOwner = owner.matches[0];
        const topPath =
            topOwner && (topOwner.kind === 'route' || topOwner.kind === 'controller') && topOwner.label.startsWith('/')
                ? topOwner.label
                : query && query.startsWith('/')
                  ? query
                  : undefined;
        return createMcpPayload({
            summary: topOwner
                ? `${query || owner.query} -> ${topOwner.kind} ${topOwner.label} (${topOwner.scopeLabel})`
                : `${query || owner.query} -> no owner matched`,
            data: {
                query: query || owner.query,
                normalizedQuery: owner.normalizedQuery,
                owner: {
                    top: topOwner ? compactOwnerMatch(topOwner) : undefined,
                    matches: compactList(owner.matches, 8).map(compactOwnerMatch),
                    totalReturned: owner.matches.length,
                },
                manifest: summarizeManifest(manifest),
            },
            nextActions: topPath
                ? [
                      {
                          label: 'Diagnose Route',
                          tool: 'diagnose',
                          toolArgs: { path: topPath, query: query || owner.query },
                          reason: 'Use compact runtime diagnosis before CLI diagnose or raw trace detail.',
                      },
                      {
                          label: 'Perf Request',
                          tool: 'perf_request',
                          toolArgs: { query: topPath },
                          reason: 'Use compact request waterfall before raw perf detail.',
                      },
                  ]
                : undefined,
        });
    }

    const items = buildExplainSummaryItems(manifest).map((item) => truncateForMcp(item, 300));
    return createMcpPayload({
        summary: `Manifest ${manifest.app.identity.identifier}: ${manifest.controllers.length} controllers, ${manifest.routes.client.length + manifest.routes.server.length} routes`,
        data: {
            manifest: summarizeManifest(manifest),
            summaryItems: items,
        },
    });
};

const compactRequest = (request: TDiagnoseResponse['request']) =>
    request
        ? {
              id: request.id,
              method: request.method,
              path: request.path,
              statusCode: request.statusCode,
              durationMs: request.durationMs,
              capture: request.capture,
              user: request.user,
              errorMessage: request.errorMessage ? truncateForMcp(request.errorMessage) : undefined,
              counts: {
                  calls: request.calls.length,
                  events: request.events.length,
                  sqlQueries: request.sqlQueries.length,
                  droppedEvents: request.droppedEvents,
              },
          }
        : undefined;

export const compactDiagnoseResponse = (response: TDiagnoseResponse) => {
    const request = compactRequest(response.request);
    const doctorSummary = `${response.doctor.summary.errors} doctor errors/${response.doctor.summary.warnings} warnings`;
    const contractsSummary = `${response.contracts.summary.errors} contract errors/${response.contracts.summary.warnings} warnings`;
    const traceSummary = request
        ? `${request.method} ${request.path} status=${request.statusCode ?? 'pending'} durationMs=${request.durationMs ?? 'pending'}`
        : 'no matching request trace';

    return createMcpPayload({
        summary: `${response.query || 'request'}: ${traceSummary}; ${doctorSummary}; ${contractsSummary}`,
        data: {
            query: response.query,
            request,
            owner: {
                top: response.owner.matches[0] ? compactOwnerMatch(response.owner.matches[0]) : undefined,
                matches: compactList(response.owner.matches, 5).map(compactOwnerMatch),
                totalReturned: response.owner.matches.length,
            },
            suspects: compactList(response.suspects, 8),
            chain: compactList(response.chain || [], 10),
            diagnostics: {
                doctor: {
                    summary: response.doctor.summary,
                    top: compactList(response.doctor.diagnostics, 8).map(compactDiagnostic),
                    total: response.doctor.diagnostics.length,
                },
                contracts: {
                    summary: response.contracts.summary,
                    top: compactList(response.contracts.diagnostics, 8).map(compactDiagnostic),
                    total: response.contracts.diagnostics.length,
                },
            },
            logs: compactList(response.serverLogs.logs, 12).map((entry) => ({
                level: entry.level,
                time: entry.time,
                text: truncateForMcp(entry.text),
            })),
            instructions: response.orientation
                ? {
                      mustRead: [...new Set([response.orientation.guidance.agents, ...response.orientation.guidance.areaAgents])],
                      documentation: response.orientation.guidance.documentation,
                      diagnostics: response.orientation.guidance.diagnostics,
                      codingStyle: response.orientation.guidance.codingStyle,
                      optimizations: response.orientation.guidance.optimizations,
                  }
                : undefined,
        },
        nextActions: response.orientation?.nextSteps.map((step) => ({
            command: step.command,
            label: step.label,
            reason: step.reason,
        })),
        omitted: response.request
            ? [
                  {
                      reason: 'Full request events, payload summaries, and SQL text are omitted from MCP diagnose output.',
                      tool: 'trace_show',
                      toolArgs: { requestId: response.request.id, detail: 'full', limit: 50 },
                  },
              ]
            : undefined,
    });
};

const compactTraceCall = (call: TRequestTrace['calls'][number]) => ({
    id: call.id,
    origin: call.origin,
    label: call.label,
    method: call.method,
    path: call.path,
    statusCode: call.statusCode,
    durationMs: call.durationMs,
    errorMessage: call.errorMessage ? truncateForMcp(call.errorMessage) : undefined,
});

const compactTraceSql = (query: TRequestTrace['sqlQueries'][number], includeQuery = false) => ({
    id: query.id,
    caller: query.callerLabel || `${query.callerMethod} ${query.callerPath}`,
    kind: query.kind,
    operation: query.operation,
    model: query.model,
    durationMs: query.durationMs,
    fingerprint: query.fingerprint,
    query: includeQuery ? truncateForMcp(query.query, 180) : undefined,
});

const compactTraceEvent = (event: TRequestTrace['events'][number], includeDetails = false) => ({
    index: event.index,
    elapsedMs: event.elapsedMs,
    type: event.type,
    detailKeys: Object.keys(event.details),
    details: includeDetails ? event.details : undefined,
});

export const compactTraceResponse = ({
    detail = 'compact',
    limit = 50,
    offset = 0,
    request,
}: {
    detail?: 'compact' | 'full';
    limit?: number;
    offset?: number;
    request: TRequestTrace;
}) => {
    const failedCalls = request.calls.filter((call) => call.errorMessage || (call.statusCode !== undefined && call.statusCode >= 400));
    const errorEvents = request.events.filter((event) => event.type === 'error');
    const hotCalls = [...request.calls].sort((left, right) => (right.durationMs || 0) - (left.durationMs || 0));
    const hotSql = [...request.sqlQueries].sort((left, right) => right.durationMs - left.durationMs);
    const pageOffset = Math.max(0, offset);
    const pageLimit = Math.max(1, Math.min(100, limit));
    const full = detail === 'full';

    return createMcpPayload({
        summary: `${request.id}: ${request.method} ${request.path} status=${request.statusCode ?? 'pending'} durationMs=${request.durationMs ?? 'pending'} events=${request.events.length} calls=${request.calls.length} sql=${request.sqlQueries.length}`,
        data: {
            request: {
                id: request.id,
                method: request.method,
                path: request.path,
                statusCode: request.statusCode,
                durationMs: request.durationMs,
                capture: request.capture,
                user: request.user,
                errorMessage: request.errorMessage ? truncateForMcp(request.errorMessage) : undefined,
                droppedEvents: request.droppedEvents,
                persistedFilepath: request.persistedFilepath,
            },
            counts: {
                calls: request.calls.length,
                events: request.events.length,
                sqlQueries: request.sqlQueries.length,
            },
            failedCalls: compactList(failedCalls, 6).map(compactTraceCall),
            errorEvents: compactList(errorEvents, 6).map((event) => compactTraceEvent(event, full)),
            hotCalls: compactList(hotCalls, 6).map(compactTraceCall),
            hotSql: compactList(hotSql, 6).map((query) => compactTraceSql(query, full)),
            page: full
                ? {
                      offset: pageOffset,
                      limit: pageLimit,
                      events: request.events.slice(pageOffset, pageOffset + pageLimit).map((event) => compactTraceEvent(event, true)),
                      calls: request.calls.slice(pageOffset, pageOffset + pageLimit).map(compactTraceCall),
                      sqlQueries: request.sqlQueries
                          .slice(pageOffset, pageOffset + pageLimit)
                          .map((query) => compactTraceSql(query, true)),
                      hasMore:
                          request.events.length > pageOffset + pageLimit ||
                          request.calls.length > pageOffset + pageLimit ||
                          request.sqlQueries.length > pageOffset + pageLimit,
                  }
                : undefined,
        },
        nextActions: [
            {
                label: 'Diagnose Request',
                tool: 'diagnose',
                toolArgs: { requestId: request.id, query: request.path },
                reason: 'Combine this trace with owner lookup, diagnostics, suspects, and server logs.',
            },
            {
                label: 'Perf Request',
                tool: 'perf_request',
                toolArgs: { query: request.id },
                reason: 'Inspect request timing, SQL, render, and memory rollups without full events.',
            },
        ],
        omitted: full
            ? undefined
            : [
                  {
                      reason: 'Full events, payload summaries, raw SQL, and call bodies are omitted by default.',
                      tool: 'trace_show',
                      toolArgs: { requestId: request.id, detail: 'full', limit: 50 },
                  },
              ],
    });
};

const formatDuration = (value?: number) => (value === undefined ? 'n/a' : `${Math.round(value)} ms`);

const compactTopLikeRow = (row: TPerfTopResponse['rows'][number]) => ({
    label: row.label,
    requestCount: row.requestCount,
    avgDurationMs: row.avgDurationMs,
    p95DurationMs: row.p95DurationMs,
    maxDurationMs: row.maxDurationMs,
    avgCpuMs: row.avgCpuMs,
    avgSqlDurationMs: row.avgSqlDurationMs,
    avgRenderDurationMs: row.avgRenderDurationMs,
    avgHeapDeltaBytes: row.avgHeapDeltaBytes,
    slowestRequestId: row.slowestRequestId,
});

export const compactPerfTopResponse = (response: TPerfTopResponse) =>
    createMcpPayload({
        summary: `Perf top ${response.groupBy}: ${response.summary.requestCount} requests, ${response.summary.errorCount} errors, p95=${formatDuration(response.summary.p95DurationMs)}`,
        data: {
            groupBy: response.groupBy,
            window: response.window,
            summary: response.summary,
            rows: compactList(response.rows, 10).map(compactTopLikeRow),
            totalRows: response.rows.length,
        },
        omitted:
            response.rows.length > 10
                ? [{ reason: 'Perf rows are capped. Increase the tool limit or use `proteum perf top --full` for raw detail.' }]
                : undefined,
    });

const compactPerfSql = (query: TPerfRequestResponse['request']['hottestSqlQueries'][number]) => ({
    callerLabel: query.callerLabel,
    operation: query.operation,
    model: query.model,
    fingerprint: query.fingerprint,
    durationMs: query.durationMs,
    query: truncateForMcp(query.query, 160),
});

export const compactPerfRequestResponse = (response: TPerfRequestResponse) =>
    createMcpPayload({
        summary: `${response.request.requestId}: ${response.request.method} ${response.request.path} total=${formatDuration(response.request.totalDurationMs)} cpu=${formatDuration(response.request.cpuTotalMs)} sql=${formatDuration(response.request.sqlDurationMs)}`,
        data: {
            request: {
                requestId: response.request.requestId,
                method: response.request.method,
                path: response.request.path,
                statusCode: response.request.statusCode,
                routeLabel: response.request.routeLabel,
                controllerLabel: response.request.controllerLabel,
                totalDurationMs: response.request.totalDurationMs,
                cpuTotalMs: response.request.cpuTotalMs,
                sqlDurationMs: response.request.sqlDurationMs,
                callDurationMs: response.request.callDurationMs,
                renderDurationMs: response.request.renderDurationMs,
                selfDurationMs: response.request.selfDurationMs,
                heapDeltaBytes: response.request.heapDeltaBytes,
            },
            stages: compactList(response.request.stages, 10),
            hotCalls: compactList(response.request.hottestCalls, 8),
            chain: compactList(response.request.chain || [], 10),
            hotSql: compactList(response.request.hottestSqlQueries, 8).map(compactPerfSql),
        },
        nextActions: [
            {
                label: 'Diagnose Request',
                tool: 'diagnose',
                toolArgs: { query: response.request.path, requestId: response.request.requestId },
                reason: 'Combine this request with owner, diagnostics, suspects, and logs.',
            },
            {
                label: 'Trace Events',
                tool: 'trace_show',
                toolArgs: { requestId: response.request.requestId, detail: 'full', limit: 50 },
                reason: 'Open raw event detail only if the compact waterfall is insufficient.',
            },
        ],
    });

export const compactLogsResponse = ({
    level,
    limit,
    response,
}: {
    level: TDevConsoleLogLevel;
    limit: number;
    response: TDevConsoleLogsResponse;
}) =>
    createMcpPayload({
        summary: `${response.logs.length} dev log lines at level >= ${level}`,
        data: {
            level,
            limit,
            logs: response.logs.map((entry) => ({
                level: entry.level,
                time: entry.time,
                text: truncateForMcp(entry.text),
            })),
        },
        omitted:
            response.logs.length >= limit
                ? [{ reason: 'Log output reached the requested cap. Increase limit only when the latest compact lines are insufficient.' }]
                : undefined,
    });

export const compactDatabaseReadQueryResponse = (response: TDatabaseReadQueryResponse) =>
    createMcpPayload({
        summary: `${response.kind.toUpperCase()} returned ${response.rows.length}/${response.rowCount} rows in ${response.elapsedMs} ms${response.limited ? ` (limited to ${response.limit})` : ''}.`,
        data: {
            kind: response.kind,
            elapsedMs: response.elapsedMs,
            rowCount: response.rowCount,
            returnedRowCount: response.rows.length,
            limit: response.limit,
            limited: response.limited,
            columns: response.columns,
            rows: response.rows,
        },
        omitted: response.limited
            ? [
                  {
                      reason: `Rows are capped at ${response.limit}. Raise the limit up to 500 or make the read query narrower if more detail is needed.`,
                      tool: 'db_query',
                      toolArgs: { sql: response.sql, limit: Math.min(response.limit * 2, 500) },
                  },
              ]
            : undefined,
    });

const readPreview = (filepath: string) => {
    if (fs === undefined) return undefined;
    try {
        return truncateForMcp(fs.readFileSync(filepath, 'utf8').replace(/\s+/g, ' ').trim(), maxInstructionPreviewLength);
    } catch (_error) {
        return undefined;
    }
};

const findNearestRootWith = (startDir: string, relativeFilepath: string) => {
    if (path === undefined) return undefined;
    let current = path.resolve(startDir);

    while (true) {
        if (fileExists(path.join(current, relativeFilepath))) return current;
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
};

const findLikelyRepoRoot = (appRoot: string) => {
    if (path === undefined) return appRoot;
    let current = path.resolve(appRoot);

    while (true) {
        if (directoryExists(path.join(current, '.git'))) return current;
        const parent = path.dirname(current);
        if (parent === current) return appRoot;
        current = parent;
    }
};

const resolveDocumentFile = ({
    appRoot,
    repoRoot,
    relativeFilepath,
}: {
    appRoot: string;
    repoRoot: string;
    relativeFilepath: string;
}) => {
    if (path === undefined) return undefined;

    const appFilepath = path.join(appRoot, relativeFilepath);
    if (fileExists(appFilepath)) return appFilepath;

    const repoFilepath = path.join(repoRoot, relativeFilepath);
    if (fileExists(repoFilepath)) return repoFilepath;

    const nearestRoot = findNearestRootWith(appRoot, relativeFilepath);
    return nearestRoot ? path.join(nearestRoot, relativeFilepath) : undefined;
};

const fullInstructionReadPolicy = {
    default: 'Use selected previews as the instruction source for read-only discovery and diagnostics.',
    requiredWhen: [
        'editing files governed by the selected scope',
        'performing git writes such as stage, commit, push, or PR work',
        'changing schema, auth, runtime, generated contracts, or framework integration behavior',
        'the compact preview is insufficient for the current decision',
    ],
};

const inferInstructionReadMode = (reason: string) =>
    /git lifecycle|implementation edit|finish or verification|schema|migration/i.test(reason)
        ? 'full-before-action'
        : 'preview-first';

const createSelectedInstruction = (file: string, reason: string) => ({
    file,
    fullRead: inferInstructionReadMode(reason),
    preview: readPreview(file),
    reason,
});

export const resolveInstructionRouting = ({
    appRoot,
    query = '',
}: {
    appRoot: string;
    query?: string;
}) => {
    const normalizedQuery = query.trim();
    const repoRoot = findLikelyRepoRoot(appRoot);
    const selected = new Map<string, ReturnType<typeof createSelectedInstruction>>();
    const readWhen: Array<{ file?: string; when: string }> = [];
    const addInstruction = (relativeFilepath: string, reason: string, preferAppRoot = true) => {
        if (path === undefined) return;
        const roots = preferAppRoot ? [appRoot, repoRoot] : [repoRoot, appRoot];
        for (const root of [...new Set(roots)]) {
            const filepath = path.join(root, relativeFilepath);
            if (!fileExists(filepath)) continue;
            selected.set(filepath, createSelectedInstruction(filepath, reason));
            return;
        }
    };
    const addReadWhen = (relativeFilepath: string, when: string) => {
        const filepath = resolveDocumentFile({ appRoot, repoRoot, relativeFilepath });
        readWhen.push({ file: filepath, when });
    };
    const lowerQuery = normalizedQuery.toLowerCase();
    const looksLikeRoutePath = /(^|\s)\/[a-z0-9_./:-]*/i.test(lowerQuery);
    const looksLikePage = looksLikeRoutePath || lowerQuery.includes('client/pages') || lowerQuery.includes('.tsx');
    const looksLikeClient = looksLikePage || lowerQuery.includes('client/') || lowerQuery.includes('component') || lowerQuery.includes('island');
    const looksLikeServerRoute =
        lowerQuery.includes('server/routes') ||
        lowerQuery.includes('route') ||
        lowerQuery.includes('sitemap') ||
        lowerQuery.includes('rss') ||
        /^\/api(\/|$)/.test(lowerQuery) ||
        /\s\/api(\/|$)/.test(lowerQuery);
    const looksLikeService =
        lowerQuery.includes('server/services') ||
        lowerQuery.includes('.controller') ||
        lowerQuery.includes('controller') ||
        lowerQuery.includes('service');
    const looksLikeE2e = lowerQuery.includes('tests/e2e') || lowerQuery.includes('playwright') || lowerQuery.includes('journey');

    addInstruction('AGENTS.md', 'Start with the root/app routing contract.');
    if (repoRoot !== appRoot) addInstruction('AGENTS.md', 'Also apply the monorepo root routing contract.', false);
    if (looksLikeClient) addInstruction('client/AGENTS.md', 'Client code or browser-visible behavior is in scope.');
    if (looksLikePage) addInstruction('client/pages/AGENTS.md', 'Page routing, SSR data, or page render behavior may be in scope.');
    if (looksLikeServerRoute) addInstruction('server/routes/AGENTS.md', 'Server route or crawlable endpoint behavior may be in scope.');
    if (looksLikeService) addInstruction('server/services/AGENTS.md', 'Service/controller contracts or backend runtime behavior may be in scope.');
    if (looksLikeE2e) {
        addInstruction('tests/e2e/AGENTS.md', 'End-to-end behavior or Playwright workflow is in scope.');
        addInstruction('tests/e2e/REAL_WORLD_JOURNEY_TESTS.md', 'Real-world journey coverage may be in scope.');
    }

    const appAgentsFile = resolveDocumentFile({ appRoot, repoRoot, relativeFilepath: 'AGENTS.md' });
    const repoAgentsFile = path !== undefined && repoRoot !== appRoot ? path.join(repoRoot, 'AGENTS.md') : undefined;
    for (const triggered of resolveTriggeredInstructionReads({
        codingStyle: resolveDocumentFile({ appRoot, repoRoot, relativeFilepath: 'CODING_STYLE.md' }),
        diagnostics: resolveDocumentFile({ appRoot, repoRoot, relativeFilepath: 'diagnostics.md' }),
        documentation: resolveDocumentFile({ appRoot, repoRoot, relativeFilepath: 'DOCUMENTATION.md' }),
        optimizations: resolveDocumentFile({ appRoot, repoRoot, relativeFilepath: 'optimizations.md' }),
        query: normalizedQuery,
        rootAgentsFile: repoAgentsFile && fileExists(repoAgentsFile) ? repoAgentsFile : appAgentsFile,
    })) {
        selected.set(triggered.file, createSelectedInstruction(triggered.file, triggered.reason));
    }

    addReadWhen(
        'DOCUMENTATION.md',
        'Read before non-trivial coding tasks to choose the smallest `/docs` pack and update docs after changes.',
    );
    addReadWhen('diagnostics.md', 'Read for raw errors, failing requests, traces, perf regressions, or reproduction work.');
    addReadWhen('CODING_STYLE.md', 'Read before editing implementation files.');
    addReadWhen('optimizations.md', 'Read for client-side implementation, packages, build, runtime, or performance work.');

    const selectedFiles = [...selected.values()];
    return createMcpPayload({
        summary: `${selectedFiles.length} instruction files selected for ${normalizedQuery || 'current app'}`,
        data: {
            query: normalizedQuery,
            appRoot,
            repoRoot,
            selected: selectedFiles,
            readWhen,
            fullReadPolicy: fullInstructionReadPolicy,
            missingRuntime:
                selectedFiles.length === 0
                    ? 'No tracked instruction files were found. Run `proteum configure agents` or start `proteum dev` to refresh managed instructions.'
                    : undefined,
        },
    });
};

const chooseWorkflowOwnerQuery = ({
    file,
    query,
    route,
}: {
    file?: string;
    query?: string;
    route?: string;
}) => [route, file, query].map((value) => value?.trim()).find((value): value is string => Boolean(value));

const chooseWorkflowInstructionQuery = ({
    file,
    query,
    route,
    task,
}: {
    file?: string;
    query?: string;
    route?: string;
    task?: string;
}) =>
    [task, query, route, file]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .join(' ');

const isReachableHealth = (health: object | undefined) => {
    if (!health || !('reachable' in health)) return true;

    return (health as { reachable?: unknown }).reachable === true;
};

const createRuntimeDownNextAction = () => ({
    label: 'Start Dev',
    command: 'proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>',
    reason: 'Runtime is not reachable; start or repair one tracked dev session before diagnose, trace, or perf reads.',
});

export const compactWorkflowStartResponse = ({
    contracts,
    doctor,
    file,
    health,
    manifest,
    owner,
    query,
    route,
    runtime,
    task,
}: {
    contracts: TDoctorResponse;
    doctor: TDoctorResponse;
    file?: string;
    health?: object;
    manifest: TProteumManifest;
    owner?: TExplainOwnerResponse;
    query?: string;
    route?: string;
    runtime?: object;
    task?: string;
}) => {
    const ownerQuery = chooseWorkflowOwnerQuery({ file, query, route });
    const instructionQuery = chooseWorkflowInstructionQuery({ file, query, route, task });
    const instructions = resolveInstructionRouting({
        appRoot: manifest.app.root,
        query: instructionQuery,
    });
    const topOwner = owner?.matches[0];
    const topPath =
        topOwner && (topOwner.kind === 'route' || topOwner.kind === 'controller') && topOwner.label.startsWith('/')
            ? topOwner.label
            : route && route.startsWith('/')
              ? route
              : ownerQuery && ownerQuery.startsWith('/')
                ? ownerQuery
                : undefined;
    const runtimeReachable = isReachableHealth(health);

    return createMcpPayload({
        summary: `${manifest.app.identity.identifier}: workflow start${ownerQuery ? ` for ${ownerQuery}` : ''}; ${instructions.data.selected.length} instruction file${instructions.data.selected.length === 1 ? '' : 's'}`,
        data: {
            workflow: {
                task: task?.trim() || undefined,
                query: ownerQuery,
                route: route?.trim() || undefined,
                file: file?.trim() || undefined,
            },
            runtime: {
                appRoot: manifest.app.root,
                manifest: summarizeManifest(manifest),
                runtime,
                health,
            },
            instructions: {
                selected: compactList(instructions.data.selected, 8),
                readWhen: compactList(instructions.data.readWhen, 6),
                fullReadPolicy: fullInstructionReadPolicy,
                totalSelected: instructions.data.selected.length,
            },
            owner: owner
                ? {
                      query: owner.query,
                      normalizedQuery: owner.normalizedQuery,
                      top: topOwner ? compactOwnerMatch(topOwner) : undefined,
                      matches: compactList(owner.matches, 5).map(compactOwnerMatch),
                      totalReturned: owner.matches.length,
                  }
                : undefined,
            diagnostics: {
                doctor: doctor.summary,
                contracts: contracts.summary,
            },
            duplicateAvoidance: [
                'If owner.top resolves a route or file, do not run broad source searches for the same owner.',
                'If this runtime block is present, do not run CLI runtime status for the same app.',
                'If diagnose succeeds for this path or request, do not rerun CLI diagnose for the same read.',
                'Open full traces, logs, or instruction files only when compact output says the omitted detail is needed.',
            ],
        },
        nextActions: [
            ...(!runtimeReachable ? [createRuntimeDownNextAction()] : []),
            ...(topPath && runtimeReachable
                ? [
                      {
                          label: 'Diagnose Route',
                          tool: 'diagnose',
                          toolArgs: { path: topPath, query: ownerQuery || topPath },
                          reason: 'Use compact runtime diagnosis before CLI diagnose, raw traces, browser work, or broad source search.',
                      },
                      {
                          label: 'Perf Request',
                          tool: 'perf_request',
                          toolArgs: { query: topPath },
                          reason: 'Use the compact request waterfall before raw perf detail.',
                      },
                  ]
                : []),
            ...(!ownerQuery && instructionQuery
                ? [
                      {
                          label: 'Orient Query',
                          tool: 'orient',
                          toolArgs: { query: instructionQuery },
                          reason: 'Use MCP orientation only if the workflow bootstrap did not include a concrete owner query.',
                      },
                  ]
                : []),
        ],
        omitted: [
            {
                reason: 'Full instruction files are omitted. Use selected previews for read-only work; read full files only when the fullReadPolicy requires it.',
                tool: 'instructions_resolve',
                toolArgs: { query: instructionQuery },
            },
        ],
    });
};

export const compactRouteCandidatesResponse = ({
    limit = 8,
    manifest,
    query,
}: {
    limit?: number;
    manifest: TProteumManifest;
    query: string;
}) => {
    const owner = explainOwner(manifest, query);
    const routeMatches = owner.matches.filter((match) => match.kind === 'route');

    return createMcpPayload({
        summary:
            routeMatches.length === 0
                ? `${query} -> no route candidates`
                : `${query} -> ${routeMatches.length} route candidate${routeMatches.length === 1 ? '' : 's'}`,
        data: {
            query,
            normalizedQuery: owner.normalizedQuery,
            candidates: compactList(routeMatches, limit).map(compactOwnerMatch),
            returned: Math.min(routeMatches.length, limit),
            totalMatches: routeMatches.length,
            manifest: summarizeManifest(manifest),
        },
        nextActions:
            routeMatches.length > 0
                ? [
                      {
                          label: 'Explain Top Route',
                          tool: 'explain_summary',
                          toolArgs: { query: routeMatches[0].label },
                          reason: 'Inspect the top route owner without dumping raw route arrays.',
                      },
                  ]
                : undefined,
        omitted:
            routeMatches.length > limit
                ? [
                      {
                          reason: `Route candidates are capped at ${limit}. Refine the query before requesting raw route arrays.`,
                          tool: 'route_candidates',
                          toolArgs: { query, limit: Math.min(50, limit * 2) },
                      },
                  ]
                : undefined,
    });
};

export const buildRuntimeStatusPayload = ({
    appRoot,
    health,
    manifest,
    runtime,
    sessions,
}: {
    appRoot: string;
    health?: object;
    manifest?: TProteumManifest;
    runtime?: object;
    sessions?: object[];
}) =>
    createMcpPayload({
        summary: runtime
            ? `Runtime available for ${manifest?.app.identity.identifier || appRoot}`
            : manifest
              ? `Manifest available for ${manifest.app.identity.identifier}; no live runtime selected`
              : `No Proteum manifest found for ${appRoot}`,
        data: {
            appRoot,
            manifest: summarizeManifest(manifest),
            runtime,
            sessions,
            health,
        },
        nextActions: runtime && isReachableHealth(health)
            ? [
                  {
                      label: 'Diagnose Root',
                      tool: 'diagnose',
                      toolArgs: { query: '/', path: '/' },
                      reason: 'Use the selected runtime for the smallest request-level diagnostic pass.',
                  },
              ]
            : [
                  createRuntimeDownNextAction(),
              ],
    });
