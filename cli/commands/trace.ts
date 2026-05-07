import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import { compactList, printAgentResponse, printJson, quoteCommandArgument, truncateForAgent } from '../utils/agentOutput';
import type {
    TRequestTrace,
    TRequestTraceArmResponse,
    TRequestTraceErrorResponse,
    TRequestTraceListItem,
    TRequestTraceListResponse,
    TRequestTraceResponse,
} from '../../common/dev/requestTrace';

type TTraceAction = 'latest' | 'show' | 'requests' | 'arm' | 'export';

const allowedActions = new Set<TTraceAction>(['latest', 'show', 'requests', 'arm', 'export']);

class TraceResponseError extends UsageError {}

const getAction = () => {
    const action = typeof cli.args.action === 'string' && cli.args.action ? cli.args.action : 'latest';
    if (!allowedActions.has(action as TTraceAction)) {
        throw new UsageError(`Unsupported trace action "${action}". Expected one of: ${[...allowedActions].join(', ')}.`);
    }

    return action as TTraceAction;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

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
    if (explicitUrl) return [normalizeBaseUrl(explicitUrl)];

    const port = getRouterPort();
    return [...new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`])];
};

const getTraceErrorMessage = (body: TRequestTraceErrorResponse | object | string | undefined, statusCode: number) => {
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
    }

    return `Trace request failed with status ${statusCode}.`;
};

const hasStructuredTraceError = (body: TRequestTraceErrorResponse | object | string | undefined): body is TRequestTraceErrorResponse =>
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string';

const requestJson = async <TResponse>(pathname: string, options?: { method?: 'GET' | 'POST'; json?: object }) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
        try {
            const response = await got(`${baseUrl}${pathname}`, {
                method: options?.method || 'GET',
                json: options?.json,
                responseType: 'json',
                throwHttpErrors: false,
                retry: { limit: 0 },
            });

            if (response.statusCode >= 400) {
                if (response.statusCode === 404 && !hasStructuredTraceError(response.body as TRequestTraceErrorResponse | object | string | undefined)) {
                    attempts.push(`${baseUrl}${pathname}: returned 404`);
                    continue;
                }

                throw new TraceResponseError(
                    getTraceErrorMessage(response.body as TRequestTraceErrorResponse | object | string | undefined, response.statusCode),
                );
            }

            return response.body as TResponse;
        } catch (error) {
            if (error instanceof TraceResponseError) throw error;

            const message = error instanceof Error ? error.message : String(error);
            attempts.push(`${baseUrl}${pathname}: ${message}`);
        }
    }

    throw new UsageError(
        [
            'Could not reach the Proteum trace server.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Make sure the app is running with `proteum dev`, or pass `--url http://host:port` if it is bound elsewhere.',
        ].join('\n'),
    );
};

const renderTraceSummary = (request: TRequestTraceListItem) =>
    [
        `${request.id} ${request.method} ${request.path}`,
        `status=${request.statusCode ?? 'pending'}`,
        `capture=${request.capture}`,
        `events=${request.eventCount}`,
        `calls=${request.callCount}`,
        `sql=${request.sqlQueryCount}`,
        request.user ? `user=${request.user}` : '',
        request.errorMessage ? `error=${request.errorMessage}` : '',
    ]
        .filter(Boolean)
        .join(' | ');

const renderTrace = (request: TRequestTrace) =>
    [
        `Request ${request.id}`,
        `- ${request.method} ${request.path} status=${request.statusCode ?? 'pending'} capture=${request.capture}`,
        `- started=${request.startedAt} durationMs=${request.durationMs ?? 'pending'} events=${request.events.length} calls=${request.calls.length} sql=${request.sqlQueries.length} dropped=${request.droppedEvents}`,
        ...(request.user ? [`- user=${request.user}`] : []),
        ...(request.persistedFilepath ? [`- persisted=${request.persistedFilepath}`] : []),
        'Calls',
        ...(request.calls.length === 0
            ? ['- none']
            : request.calls.map(
                  (call) =>
                      `- ${call.origin} ${call.label} ${call.method} ${call.path} status=${call.statusCode ?? 'pending'} durationMs=${call.durationMs ?? 'pending'} req=${call.requestDataKeys.join(',')} res=${call.resultKeys.join(',')}`,
              )),
        'SQL',
        ...(request.sqlQueries.length === 0
            ? ['- none']
            : request.sqlQueries.map(
                  (query) =>
                      `- [${query.durationMs}ms] ${query.kind} ${query.operation} ${query.callerMethod} ${query.callerPath} ${query.query}${query.paramsText ? ` params=${query.paramsText}` : ''}`,
              )),
        'Events',
        ...request.events.map(
            (event) =>
                `- [${event.elapsedMs}ms] ${event.type} ${Object.entries(event.details)
                    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                    .join(' ')}`,
        ),
    ].join('\n');

const compactCall = (call: TRequestTrace['calls'][number]) => ({
    id: call.id,
    origin: call.origin,
    label: call.label,
    method: call.method,
    path: call.path,
    statusCode: call.statusCode,
    durationMs: call.durationMs,
    errorMessage: call.errorMessage ? truncateForAgent(call.errorMessage) : undefined,
});

const compactSql = (query: TRequestTrace['sqlQueries'][number]) => ({
    id: query.id,
    caller: query.callerLabel || `${query.callerMethod} ${query.callerPath}`,
    kind: query.kind,
    operation: query.operation,
    model: query.model,
    durationMs: query.durationMs,
    fingerprint: query.fingerprint,
});

const compactEvent = (event: TRequestTrace['events'][number]) => ({
    index: event.index,
    elapsedMs: event.elapsedMs,
    type: event.type,
    detailKeys: Object.keys(event.details),
});

const buildTraceFullDetailCommand = (request: TRequestTrace) =>
    [
        'proteum trace show',
        quoteCommandArgument(request.id),
        typeof cli.args.port === 'string' && cli.args.port ? `--port ${cli.args.port}` : '',
        typeof cli.args.url === 'string' && cli.args.url ? `--url ${quoteCommandArgument(cli.args.url)}` : '',
        '--events',
    ]
        .filter(Boolean)
        .join(' ');

const printCompactTrace = (request: TRequestTrace) => {
    const failedCalls = request.calls.filter((call) => call.errorMessage || (call.statusCode !== undefined && call.statusCode >= 400));
    const errorEvents = request.events.filter((event) => event.type === 'error');
    const hotCalls = [...request.calls].sort((left, right) => (right.durationMs || 0) - (left.durationMs || 0));
    const hotSql = [...request.sqlQueries].sort((left, right) => right.durationMs - left.durationMs);

    printAgentResponse({
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
                errorMessage: request.errorMessage,
                droppedEvents: request.droppedEvents,
                persistedFilepath: request.persistedFilepath,
            },
            counts: {
                calls: request.calls.length,
                events: request.events.length,
                sqlQueries: request.sqlQueries.length,
            },
            failedCalls: compactList(failedCalls, 5).map(compactCall),
            errorEvents: compactList(errorEvents, 5).map(compactEvent),
            hotCalls: compactList(hotCalls, 5).map(compactCall),
            hotSql: compactList(hotSql, 5).map(compactSql),
        },
        nextActions: [
            {
                label: 'Diagnose Request',
                command: `proteum diagnose ${quoteCommandArgument(request.path)}`,
                reason: 'Collapse this trace with owner lookup, diagnostics, suspects, and server logs.',
            },
            {
                label: 'Perf Request',
                command: `proteum perf request ${quoteCommandArgument(request.id)}`,
                reason: 'Inspect request timing, SQL, render, and memory rollups without full events.',
            },
        ],
        fullDetailCommand: buildTraceFullDetailCommand(request),
        omitted: [
            {
                reason: 'Full event details, payload summaries, raw SQL, and call bodies are omitted by default.',
                command: buildTraceFullDetailCommand(request),
            },
        ],
    });
};

export const run = async () => {
    const action = getAction();
    const requestId = typeof cli.args.id === 'string' ? cli.args.id : '';
    const shouldPrintFull = cli.args.full === true || cli.args.events === true;
    const shouldPrintHuman = cli.args.human === true;

    if (action === 'requests') {
        const response = await requestJson<TRequestTraceListResponse>('/__proteum/trace/requests');
        if (shouldPrintFull) printJson(response);
        else if (shouldPrintHuman) console.log(['Proteum trace', ...response.requests.map(renderTraceSummary)].join('\n'));
        else
            printAgentResponse({
                summary: `${response.requests.length} request traces`,
                data: { requests: compactList(response.requests, 20), totalReturned: response.requests.length },
                fullDetailCommand: 'proteum trace requests --full',
            });
        return;
    }

    if (action === 'arm') {
        const capture = typeof cli.args.capture === 'string' && cli.args.capture ? cli.args.capture : 'deep';
        const response = await requestJson<TRequestTraceArmResponse>('/__proteum/trace/arm', {
            method: 'POST',
            json: { capture },
        });

        if (shouldPrintHuman) console.log(`Armed next request trace with capture=${response.capture}.`);
        else printAgentResponse({ summary: `Armed next request trace with capture=${response.capture}.`, data: response });
        return;
    }

    if (action === 'latest') {
        const response = await requestJson<TRequestTraceResponse>('/__proteum/trace/latest');
        if (shouldPrintFull) {
            printJson(response);
            return;
        }

        if (shouldPrintHuman) console.log(renderTrace(response.request));
        else printCompactTrace(response.request);
        return;
    }

    if (!requestId) {
        throw new UsageError(`Trace action "${action}" requires a request id.`);
    }

    const response = await requestJson<TRequestTraceResponse>(`/__proteum/trace/requests/${requestId}`);

    if (action === 'show') {
        if (shouldPrintFull) {
            printJson(response);
            return;
        }

        if (shouldPrintHuman) console.log(renderTrace(response.request));
        else printCompactTrace(response.request);
        return;
    }

    const output =
        typeof cli.args.output === 'string' && cli.args.output
            ? cli.args.output
            : path.join(cli.args.workdir as string, 'var', 'traces', 'exports', `${response.request.id}.json`);

    fs.ensureDirSync(path.dirname(output));
    fs.writeJSONSync(output, response.request, { spaces: 2 });

    if (shouldPrintFull) {
        printJson({ output, request: response.request });
        return;
    }

    if (shouldPrintHuman) console.log(`Exported trace ${response.request.id} to ${output}`);
    else
        printAgentResponse({
            summary: `Exported trace ${response.request.id}.`,
            data: { output, requestId: response.request.id },
        });
};
