import { buildContractsDoctorResponse } from '@common/dev/contractsDoctor';
import { buildDoctorResponse } from '@common/dev/diagnostics';
import { buildOrientationResponse, explainOwner } from '@common/dev/inspection';
import {
    buildRuntimeStatusPayload,
    compactDiagnoseResponse,
    compactDoctorResponse,
    compactExplainSummary,
    compactLogsResponse,
    compactOrientationResponse,
    compactPerfRequestResponse,
    compactPerfTopResponse,
    compactTraceResponse,
    resolveInstructionRouting,
} from '@common/dev/mcpPayloads';
import type { TProteumMcpProvider } from '@common/dev/mcpServer';
import type { TDevConsoleLogLevel } from '@common/dev/console';
import type { TPerfGroupBy } from '@common/dev/performance';

import type { Application } from './index';

export const createRuntimeProteumMcpProvider = ({
    app,
    publicUrl,
    routerPort,
}: {
    app: Application;
    publicUrl: string;
    routerPort: number;
}): TProteumMcpProvider => {
    const diagnostics = () => app.getDevDiagnostics();
    const readManifest = () => diagnostics().readManifest();
    const assertTraceEnabled = () => {
        if (!app.container.Trace.isDevTraceEnabled()) {
            throw new Error('Proteum dev trace is not enabled for this runtime.');
        }
    };

    const provider: TProteumMcpProvider = {
        async runtimeStatus(_input: Record<string, never> = {}) {
            const manifest = readManifest();
            const doctor = buildDoctorResponse(manifest);
            const contracts = buildContractsDoctorResponse(manifest);

            return buildRuntimeStatusPayload({
                appRoot: app.container.path.root,
                health: {
                    reachable: true,
                    doctor: doctor.summary,
                    contracts: contracts.summary,
                },
                manifest,
                runtime: {
                    publicUrl,
                    routerPort,
                    source: 'proteum-dev-runtime',
                    mcpUrl: `${publicUrl}/__proteum/mcp`,
                    traceEnabled: app.container.Trace.isDevTraceEnabled(),
                    profilerEnabled: app.container.Trace.isProfilingEnabled(),
                    connectedProjects: Object.entries(app.connectedProjects || {}).map(([namespace, project]) => ({
                        namespace,
                        urlInternal: (project as { urlInternal?: string }).urlInternal,
                    })),
                },
            });
        },
        async orient({ query }) {
            return compactOrientationResponse(buildOrientationResponse(readManifest(), query));
        },
        async instructionsResolve({ query }) {
            return resolveInstructionRouting({ appRoot: app.container.path.root, query });
        },
        async explainSummary({ query }) {
            const manifest = readManifest();
            const normalizedQuery = query?.trim();

            return compactExplainSummary({
                manifest,
                owner: normalizedQuery ? explainOwner(manifest, normalizedQuery) : undefined,
                query: normalizedQuery,
            });
        },
        async doctor({ contracts = true }) {
            const manifest = readManifest();

            return compactDoctorResponse({
                contracts: contracts ? buildContractsDoctorResponse(manifest) : undefined,
                doctor: buildDoctorResponse(manifest),
            });
        },
        async diagnose({
            logsLevel = 'warn',
            logsLimit = 40,
            path,
            query,
            requestId,
        }: {
            logsLevel?: TDevConsoleLogLevel;
            logsLimit?: number;
            path?: string;
            query?: string;
            requestId?: string;
        }) {
            return compactDiagnoseResponse(
                diagnostics().diagnose({
                    logsLevel,
                    logsLimit,
                    path,
                    query,
                    requestId,
                }),
            );
        },
        async traceLatest({ detail, limit, offset }) {
            assertTraceEnabled();
            const request = app.container.Trace.getLatestRequest();
            if (!request) throw new Error('No request trace is available yet.');

            return compactTraceResponse({ detail, limit, offset, request });
        },
        async traceShow({ detail, limit, offset, requestId }) {
            assertTraceEnabled();
            const request = app.container.Trace.getRequest(requestId);
            if (!request) throw new Error(`Trace ${requestId} was not found.`);

            return compactTraceResponse({ detail, limit, offset, request });
        },
        async perfTop({ groupBy = 'path', limit = 12, since = 'today' }) {
            return compactPerfTopResponse(
                diagnostics().perfTop({
                    groupBy: groupBy as TPerfGroupBy,
                    limit,
                    since,
                }),
            );
        },
        async perfRequest({ query }) {
            return compactPerfRequestResponse(diagnostics().perfRequest(query));
        },
        async logsTail({ level = 'warn', limit = 40 }) {
            return compactLogsResponse({
                level,
                limit,
                response: diagnostics().readLogs(limit, level),
            });
        },
        async readResource(uri) {
            if (uri === 'proteum://runtime/status') return await provider.runtimeStatus({});
            if (uri === 'proteum://instructions/router') return await provider.instructionsResolve({});
            if (uri === 'proteum://manifest/summary') return await provider.explainSummary({});
            if (uri === 'proteum://trace/latest/summary') return await provider.traceLatest({});
            if (uri === 'proteum://perf/top') return await provider.perfTop({});

            throw new Error(`Unknown Proteum MCP resource: ${uri}`);
        },
    };

    return provider;
};
