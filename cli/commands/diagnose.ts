import fs from 'fs-extra';
import got, { type Method } from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import { renderDoctorResponseHuman } from '../../common/dev/diagnostics';
import type { TDevConsoleLogsResponse } from '../../common/dev/console';
import type { TDiagnoseResponse, TExplainOwnerMatch } from '../../common/dev/inspection';
import type { TProteumManifest } from '../../common/dev/proteumManifest';
import type { TRequestTraceErrorResponse, TRequestTraceArmResponse } from '../../common/dev/requestTrace';
import type { TDevSessionErrorResponse, TDevSessionStartResponse } from '../../common/dev/session';
import { summarizeTraceForDiagnose } from '@common/dev/inspection';
import { readProteumManifest } from '../compiler/common/proteumManifest';

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const truncate = (value: string, max = 160) => (value.length <= max ? value : `${value.slice(0, max)}...`);
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

const getRouterPortFromManifest = () => {
    const manifestFilepath = path.join(cli.args.workdir as string, '.proteum', 'manifest.json');
    if (!fs.existsSync(manifestFilepath)) return undefined;

    const manifest = fs.readJsonSync(manifestFilepath, { throws: false }) as
        | { env?: { resolved?: { routerPort?: number } } }
        | undefined;
    const port = manifest?.env?.resolved?.routerPort;

    if (typeof port !== 'number' || port <= 0) return undefined;

    return String(port);
};

const getRouterPort = () => {
    const overridePort = typeof cli.args.port === 'string' && cli.args.port ? cli.args.port : '';
    if (overridePort) return overridePort;

    const envPort = process.env.PORT?.trim();
    if (envPort) return envPort;

    const manifestPort = getRouterPortFromManifest();
    if (manifestPort) return manifestPort;

    throw new UsageError(
        `Could not determine the router port from PORT or .proteum/manifest.json in ${cli.args.workdir as string}. Pass --port or --url explicitly.`,
    );
};

const getRouterBaseUrls = () => {
    const explicitUrl = typeof cli.args.url === 'string' && cli.args.url ? cli.args.url.trim() : '';
    if (explicitUrl) return buildBaseUrlCandidates(explicitUrl);

    const port = getRouterPort();
    return dedupe([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
};

const getJsonErrorMessage = (body: TRequestTraceErrorResponse | TDevSessionErrorResponse | object | string | undefined, statusCode: number) => {
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
    }

    return `Request failed with status ${statusCode}.`;
};

const requestJson = async <TResponse>(pathname: string, options?: { json?: object; method?: 'GET' | 'POST' }) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
        try {
            const response = await got(`${baseUrl}${pathname}`, {
                json: options?.json,
                method: options?.method || 'GET',
                responseType: 'json',
                retry: { limit: 0 },
                throwHttpErrors: false,
            });

            if (response.statusCode >= 400) {
                throw new UsageError(getJsonErrorMessage(response.body as TRequestTraceErrorResponse | object | string | undefined, response.statusCode));
            }

            return { baseUrl, body: response.body as TResponse };
        } catch (error) {
            if (error instanceof UsageError) throw error;
            attempts.push(`${baseUrl}${pathname}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw new UsageError(
        [
            'Could not reach the Proteum dev diagnostics server.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Make sure the app is running with `proteum dev`, or pass `--url http://host:port` if it is bound elsewhere.',
        ].join('\n'),
    );
};

const requestSession = async (email: string, role: string) =>
    requestJson<TDevSessionStartResponse>('/__proteum/session/start', {
        json: role ? { email, role } : { email },
        method: 'POST',
    });

const hitRequest = async ({
    baseUrl,
    cookieHeader,
    dataJson,
    method,
    requestPath,
}: {
    baseUrl: string;
    cookieHeader?: string;
    dataJson?: unknown;
    method: Method;
    requestPath: string;
}) => {
    const targetUrl = requestPath.startsWith('http://') || requestPath.startsWith('https://') ? requestPath : `${baseUrl}${requestPath}`;
    const headers = {
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(dataJson !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    const response = await got(targetUrl, {
        body: dataJson !== undefined ? JSON.stringify(dataJson) : undefined,
        followRedirect: false,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        method,
        retry: { limit: 0 },
        throwHttpErrors: false,
    });

    return { statusCode: response.statusCode, url: targetUrl };
};

const formatSource = (match: TExplainOwnerMatch) =>
    `${match.source.filepath}${match.source.line ? `:${match.source.line}` : ''}${match.source.column ? `:${match.source.column}` : ''}`;

const renderLogs = (logs: TDevConsoleLogsResponse) =>
    logs.logs.length === 0
        ? ['Server logs', '- none'].join('\n')
        : ['Server logs', ...logs.logs.map((entry) => `- [${entry.level}] ${entry.time} ${truncate(entry.text)}`)].join('\n');

const renderOwners = (matches: TExplainOwnerMatch[]) =>
    matches.length === 0
        ? ['Owner matches', '- none'].join('\n')
        : [
              'Owner matches',
              ...matches.map((match) => `- [${match.kind}] ${match.label} score=${match.score} source=${formatSource(match)}`),
          ].join('\n');

const renderSuspects = (response: TDiagnoseResponse) =>
    response.suspects.length === 0
        ? ['Suspects', '- none'].join('\n')
        : [
              'Suspects',
              ...response.suspects.map(
                  (suspect) =>
                      `- score=${suspect.score} ${suspect.filepath}${suspect.line ? `:${suspect.line}` : ''} ${suspect.label} reasons=${suspect.reasons.join(', ')}`,
              ),
          ].join('\n');

const renderHuman = (manifest: ReturnType<typeof readProteumManifest>, response: TDiagnoseResponse) =>
    [
        'Proteum diagnose',
        `- query=${response.query}`,
        `- trace=${summarizeTraceForDiagnose(response.request)}`,
        `- manifest=${manifest.app.identity.identifier}`,
        '',
        renderSuspects(response),
        '',
        renderOwners(response.owner.matches.slice(0, 6)),
        '',
        renderDoctorResponseHuman({
            emptyMessage: 'No manifest diagnostics were found.',
            manifest,
            response: response.doctor,
            title: 'Doctor',
        }),
        '',
        renderDoctorResponseHuman({
            emptyMessage: 'No contract diagnostics were found.',
            manifest,
            response: response.contracts,
            title: 'Contracts',
        }),
        '',
        renderLogs(response.serverLogs),
    ].join('\n');

const resolveManifest = async () => {
    try {
        return readProteumManifest(cli.paths.appRoot);
    } catch (error) {
        const explicitUrl = typeof cli.args.url === 'string' && cli.args.url.trim();
        if (!explicitUrl) throw error;

        const explain = await requestJson<TProteumManifest>('/__proteum/explain');
        return explain.body;
    }
};

export const run = async () => {
    const target = typeof cli.args.target === 'string' ? cli.args.target.trim() : '';
    const hit = typeof cli.args.hit === 'string' ? cli.args.hit.trim() : '';
    const sessionEmail = typeof cli.args.sessionEmail === 'string' ? cli.args.sessionEmail.trim() : '';
    const sessionRole = typeof cli.args.sessionRole === 'string' ? cli.args.sessionRole.trim() : '';
    const capture = typeof cli.args.capture === 'string' && cli.args.capture ? cli.args.capture.trim() : 'deep';
    const method = typeof cli.args.method === 'string' && cli.args.method ? cli.args.method.trim().toUpperCase() : 'GET';
    const logsLevel = typeof cli.args.logsLevel === 'string' && cli.args.logsLevel ? cli.args.logsLevel.trim() : 'warn';
    const logsLimit = typeof cli.args.logsLimit === 'string' && cli.args.logsLimit ? cli.args.logsLimit.trim() : '40';
    const shouldPrintJson = cli.args.json === true;
    const hitPath = hit || (target.startsWith('/') ? target : '');
    const query = target || hitPath;
    let parsedDataJson: unknown;
    if (typeof cli.args.dataJson === 'string' && cli.args.dataJson.trim()) {
        try {
            parsedDataJson = JSON.parse(cli.args.dataJson);
        } catch (error) {
            throw new UsageError(`Invalid --data-json payload: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const diagnoseRequest: Record<string, string> = {};
    if (query) diagnoseRequest.query = query;
    if (hitPath) diagnoseRequest.path = hitPath;
    if (logsLevel) diagnoseRequest.logsLevel = logsLevel;
    if (logsLimit) diagnoseRequest.logsLimit = logsLimit;

    let baseUrl: string | undefined;

    if (hitPath) {
        const armed = await requestJson<TRequestTraceArmResponse>('/__proteum/trace/arm', {
            json: { capture },
            method: 'POST',
        });
        baseUrl = armed.baseUrl;

        let cookieHeader: string | undefined;
        if (sessionEmail) {
            const session = await requestSession(sessionEmail, sessionRole);
            baseUrl = session.baseUrl;
            cookieHeader = `${session.body.session.cookieName}=${session.body.session.token}`;
        }

        const hitResponse = await hitRequest({
            baseUrl,
            cookieHeader,
            dataJson: parsedDataJson,
            method: method as Method,
            requestPath: hitPath,
        });

        diagnoseRequest.path = hitPath;
        if (!diagnoseRequest.query) diagnoseRequest.query = hitPath;
        if (hitResponse.statusCode >= 300 && hitResponse.statusCode < 400 && !target) diagnoseRequest.query = hitPath;
    }

    const diagnose = await requestJson<TDiagnoseResponse>(
        `/__proteum/diagnose?${new URLSearchParams(diagnoseRequest).toString()}`,
    );
    if (shouldPrintJson) {
        console.log(JSON.stringify(diagnose.body, null, 2));
        return;
    }

    const manifest = await resolveManifest();
    console.log(renderHuman(manifest, diagnose.body));
};
