import fs from 'fs-extra';
import got from 'got';
import path from 'path';

import { buildContractsDoctorResponse } from '../../common/dev/contractsDoctor';
import { buildDoctorResponse, type TDoctorResponse } from '../../common/dev/diagnostics';
import { buildOrientationResponse, explainOwner } from '../../common/dev/inspection';
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
} from '../../common/dev/mcpPayloads';
import type { TProteumMcpProvider } from '../../common/dev/mcpServer';
import type { TDevConsoleLogLevel, TDevConsoleLogsResponse } from '../../common/dev/console';
import type { TDiagnoseResponse } from '../../common/dev/inspection';
import type { TPerfRequestResponse, TPerfTopResponse } from '../../common/dev/performance';
import type { TProteumManifest } from '../../common/dev/proteumManifest';
import type { TRequestTraceResponse } from '../../common/dev/requestTrace';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { listDevSessionInspections, type TDevSessionInspection } from '../runtime/devSessions';

type TCliProteumMcpProviderArgs = {
    appRoot: string;
    sessionFilePath?: string;
    url?: string;
};

type TRequestOptions = {
    method?: 'GET' | 'POST';
    searchParams?: Record<string, string>;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const dedupe = <TValue>(values: TValue[]) => [...new Set(values)];

const buildBaseUrlCandidates = (value: string) => {
    const normalized = normalizeBaseUrl(value);

    try {
        const parsed = new URL(normalized);
        const port = parsed.port;
        const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
        const search = parsed.search;
        const hash = parsed.hash;
        const buildUrl = (hostname: string) => `${parsed.protocol}//${hostname}${port ? `:${port}` : ''}${pathname}${search}${hash}`;

        if (parsed.hostname === '127.0.0.1') return dedupe([normalized, buildUrl('localhost'), buildUrl('[::1]')]);
        if (parsed.hostname === 'localhost') return dedupe([normalized, buildUrl('127.0.0.1'), buildUrl('[::1]')]);
        if (parsed.hostname === '[::1]' || parsed.hostname === '::1') return dedupe([normalized, buildUrl('localhost'), buildUrl('127.0.0.1')]);
    } catch (_error) {}

    return [normalized];
};

const compactSession = (inspection: TDevSessionInspection) => ({
    sessionFilePath: inspection.sessionFilePath,
    live: inspection.live,
    stale: inspection.stale,
    invalid: inspection.invalid,
    parseError: inspection.parseError,
    pid: inspection.record?.pid,
    routerPort: inspection.record?.routerPort,
    publicUrl: inspection.record?.publicUrl,
    state: inspection.record?.state,
    startedAt: inspection.record?.startedAt,
    updatedAt: inspection.record?.updatedAt,
});

const getSessionUrl = (inspection: TDevSessionInspection) => {
    if (!inspection.record) return '';
    if (inspection.record.publicUrl) return inspection.record.publicUrl.replace(/\/+$/, '');
    return `http://localhost:${inspection.record.routerPort}`;
};

export class CliProteumMcpProvider implements TProteumMcpProvider {
    private sessionsPromise?: Promise<TDevSessionInspection[]>;

    public constructor(private args: TCliProteumMcpProviderArgs) {}

    private readManifestIfAvailable() {
        const manifestFilepath = path.join(this.args.appRoot, '.proteum', 'manifest.json');
        if (!fs.existsSync(manifestFilepath)) return undefined;

        try {
            return readProteumManifest(this.args.appRoot);
        } catch (_error) {
            return undefined;
        }
    }

    private readLocalManifest() {
        const manifest = this.readManifestIfAvailable();
        if (!manifest) {
            throw new Error(
                `Proteum manifest was not found in ${this.args.appRoot}. Run \`proteum refresh\`, \`proteum dev\`, or pass --url for a running dev server.`,
            );
        }

        return manifest;
    }

    private async readSessions() {
        this.sessionsPromise ??= listDevSessionInspections({
            appRoot: this.args.appRoot,
            sessionFilePath: this.args.sessionFilePath,
        });
        return await this.sessionsPromise;
    }

    private async selectSession() {
        const sessions = await this.readSessions();
        const liveSessions = sessions.filter((inspection) => inspection.live && inspection.record);

        return (
            liveSessions.find((inspection) => inspection.record?.state === 'ready') ||
            liveSessions[0] ||
            sessions.find((inspection) => inspection.record)
        );
    }

    private async getBaseUrlCandidates() {
        if (this.args.url?.trim()) return buildBaseUrlCandidates(this.args.url.trim());

        const selectedSession = await this.selectSession();
        const selectedBaseUrl = selectedSession ? getSessionUrl(selectedSession) : '';
        if (selectedBaseUrl) return buildBaseUrlCandidates(selectedBaseUrl);

        const manifest = this.readManifestIfAvailable();
        const routerPort = manifest?.env.resolved.routerPort;
        if (typeof routerPort === 'number' && routerPort > 0) {
            return dedupe([`http://localhost:${routerPort}`, `http://127.0.0.1:${routerPort}`, `http://[::1]:${routerPort}`]);
        }

        return [];
    }

    private async requestJson<TResponse>(pathname: string, options: TRequestOptions = {}) {
        const attempts: string[] = [];
        const baseUrls = await this.getBaseUrlCandidates();

        for (const baseUrl of baseUrls) {
            const url = `${baseUrl}${pathname}${options.searchParams ? `?${new URLSearchParams(options.searchParams).toString()}` : ''}`;

            try {
                const response = await got(url, {
                    method: options.method || 'GET',
                    responseType: 'json',
                    retry: { limit: 0 },
                    throwHttpErrors: false,
                    timeout: { request: 2_500 },
                });

                if (response.statusCode >= 400) {
                    const body = response.body as { error?: string } | undefined;
                    throw new Error(body?.error || `Proteum dev endpoint returned HTTP ${response.statusCode}.`);
                }

                return { baseUrl, body: response.body as TResponse };
            } catch (error) {
                attempts.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        throw new Error(
            [
                'Could not reach a Proteum dev MCP data source.',
                ...attempts.map((attempt) => `- ${attempt}`),
                'Start `proteum dev`, pass --url, or use tools that can read the local manifest from disk.',
            ].join('\n'),
        );
    }

    private async readManifestPreferRuntime() {
        if (this.args.url?.trim()) {
            return (await this.requestJson<TProteumManifest>('/__proteum/explain')).body;
        }

        const localManifest = this.readManifestIfAvailable();
        if (localManifest) return localManifest;

        return (await this.requestJson<TProteumManifest>('/__proteum/explain')).body;
    }

    private async probeRuntimeHealth() {
        try {
            const response = await this.requestJson<TDoctorResponse>('/__proteum/doctor');
            return {
                reachable: true,
                baseUrl: response.baseUrl,
                doctor: response.body.summary,
            };
        } catch (error) {
            return {
                reachable: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    public async runtimeStatus(_input: Record<string, never> = {}) {
        const manifest = this.readManifestIfAvailable();
        const sessions = await this.readSessions();
        const selectedSession = await this.selectSession();
        const health = await this.probeRuntimeHealth();
        const runtime =
            health.reachable && 'baseUrl' in health
                ? {
                      publicUrl: health.baseUrl,
                      routerPort: selectedSession?.record?.routerPort || manifest?.env.resolved.routerPort,
                      source: this.args.url?.trim() ? 'explicit-url' : selectedSession?.record ? 'tracked-session' : 'manifest-port',
                      session: selectedSession ? compactSession(selectedSession) : undefined,
                      mcpUrl: `${health.baseUrl}/__proteum/mcp`,
                  }
                : selectedSession
                  ? {
                        routerPort: selectedSession.record?.routerPort,
                        publicUrl: selectedSession.record?.publicUrl,
                        source: 'tracked-session',
                        session: compactSession(selectedSession),
                    }
                  : undefined;

        return buildRuntimeStatusPayload({
            appRoot: this.args.appRoot,
            health,
            manifest,
            runtime,
            sessions: sessions.map(compactSession),
        });
    }

    public async orient({ query }: { query: string }) {
        return compactOrientationResponse(buildOrientationResponse(await this.readManifestPreferRuntime(), query));
    }

    public async instructionsResolve({ query }: { query?: string }) {
        return resolveInstructionRouting({ appRoot: this.args.appRoot, query });
    }

    public async explainSummary({ query }: { query?: string }) {
        const manifest = await this.readManifestPreferRuntime();
        const normalizedQuery = query?.trim();

        return compactExplainSummary({
            manifest,
            owner: normalizedQuery ? explainOwner(manifest, normalizedQuery) : undefined,
            query: normalizedQuery,
        });
    }

    public async doctor({ contracts = true }: { contracts?: boolean }) {
        if (this.args.url?.trim()) {
            const doctor = (await this.requestJson<TDoctorResponse>('/__proteum/doctor')).body;
            const contractDoctor = contracts
                ? (await this.requestJson<TDoctorResponse>('/__proteum/doctor/contracts')).body
                : undefined;
            return compactDoctorResponse({ contracts: contractDoctor, doctor });
        }

        const manifest = this.readManifestIfAvailable();
        if (manifest) {
            return compactDoctorResponse({
                contracts: contracts ? buildContractsDoctorResponse(manifest) : undefined,
                doctor: buildDoctorResponse(manifest),
            });
        }

        const doctor = (await this.requestJson<TDoctorResponse>('/__proteum/doctor')).body;
        const contractDoctor = contracts
            ? (await this.requestJson<TDoctorResponse>('/__proteum/doctor/contracts')).body
            : undefined;
        return compactDoctorResponse({ contracts: contractDoctor, doctor });
    }

    public async diagnose(input: {
        logsLevel?: TDevConsoleLogLevel;
        logsLimit?: number;
        path?: string;
        query?: string;
        requestId?: string;
    }) {
        const searchParams: Record<string, string> = {};
        if (input.logsLevel) searchParams.logsLevel = input.logsLevel;
        if (typeof input.logsLimit === 'number') searchParams.logsLimit = String(input.logsLimit);
        if (input.path) searchParams.path = input.path;
        if (input.query) searchParams.query = input.query;
        if (input.requestId) searchParams.requestId = input.requestId;

        return compactDiagnoseResponse((await this.requestJson<TDiagnoseResponse>('/__proteum/diagnose', { searchParams })).body);
    }

    public async traceLatest(input: { detail?: 'compact' | 'full'; limit?: number; offset?: number }) {
        const response = (await this.requestJson<TRequestTraceResponse>('/__proteum/trace/latest')).body;
        return compactTraceResponse({
            detail: input.detail,
            limit: input.limit,
            offset: input.offset,
            request: response.request,
        });
    }

    public async traceShow(input: { detail?: 'compact' | 'full'; limit?: number; offset?: number; requestId: string }) {
        const response = (await this.requestJson<TRequestTraceResponse>(`/__proteum/trace/requests/${encodeURIComponent(input.requestId)}`))
            .body;
        return compactTraceResponse({
            detail: input.detail,
            limit: input.limit,
            offset: input.offset,
            request: response.request,
        });
    }

    public async perfTop(input: { groupBy?: 'path' | 'route' | 'controller'; limit?: number; since?: string }) {
        return compactPerfTopResponse(
            (
                await this.requestJson<TPerfTopResponse>('/__proteum/perf/top', {
                    searchParams: {
                        groupBy: input.groupBy || 'path',
                        limit: String(input.limit || 12),
                        since: input.since || 'today',
                    },
                })
            ).body,
        );
    }

    public async perfRequest({ query }: { query: string }) {
        return compactPerfRequestResponse(
            (
                await this.requestJson<TPerfRequestResponse>('/__proteum/perf/request', {
                    searchParams: { query },
                })
            ).body,
        );
    }

    public async logsTail({ level = 'warn', limit = 40 }: { level?: TDevConsoleLogLevel; limit?: number }) {
        return compactLogsResponse({
            level,
            limit,
            response: (
                await this.requestJson<TDevConsoleLogsResponse>('/__proteum/logs', {
                    searchParams: { level, limit: String(limit) },
                })
            ).body,
        });
    }

    public async readResource(uri: string) {
        if (uri === 'proteum://runtime/status') return await this.runtimeStatus({});
        if (uri === 'proteum://instructions/router') return await this.instructionsResolve({});
        if (uri === 'proteum://manifest/summary') return await this.explainSummary({});
        if (uri === 'proteum://trace/latest/summary') return await this.traceLatest({});
        if (uri === 'proteum://perf/top') return await this.perfTop({});

        throw new Error(`Unknown Proteum MCP resource: ${uri}`);
    }
}
