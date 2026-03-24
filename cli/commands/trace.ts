import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import yaml from 'yaml';
import { UsageError } from 'clipanion';

import cli from '..';
import type {
    TRequestTrace,
    TRequestTraceArmResponse,
    TRequestTraceErrorResponse,
    TRequestTraceListItem,
    TRequestTraceListResponse,
    TRequestTraceResponse,
} from '@common/dev/requestTrace';

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

const getRouterPort = () => {
    const overridePort = typeof cli.args.port === 'string' && cli.args.port ? cli.args.port : '';
    if (overridePort) return overridePort;

    const envFilepath = path.join(cli.args.workdir as string, 'env.yaml');
    if (!fs.existsSync(envFilepath)) {
        throw new UsageError(`Could not find env.yaml in ${cli.args.workdir as string}. Pass --port or --url explicitly.`);
    }

    const envFile = yaml.parse(fs.readFileSync(envFilepath, 'utf8')) as { router?: { port?: number } };
    const port = envFile.router?.port;
    if (!port) {
        throw new UsageError(`Could not determine the router port from ${envFilepath}. Pass --port or --url explicitly.`);
    }

    return String(port);
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
        request.user ? `user=${request.user}` : '',
        request.errorMessage ? `error=${request.errorMessage}` : '',
    ]
        .filter(Boolean)
        .join(' | ');

const renderTrace = (request: TRequestTrace) =>
    [
        `Request ${request.id}`,
        `- ${request.method} ${request.path} status=${request.statusCode ?? 'pending'} capture=${request.capture}`,
        `- started=${request.startedAt} durationMs=${request.durationMs ?? 'pending'} events=${request.events.length} dropped=${request.droppedEvents}`,
        ...(request.user ? [`- user=${request.user}`] : []),
        ...(request.persistedFilepath ? [`- persisted=${request.persistedFilepath}`] : []),
        'Events',
        ...request.events.map(
            (event) =>
                `- [${event.elapsedMs}ms] ${event.type} ${Object.entries(event.details)
                    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                    .join(' ')}`,
        ),
    ].join('\n');

const printJson = (value: object) => {
    console.log(JSON.stringify(value, null, 2));
};

export const run = async () => {
    const action = getAction();
    const requestId = typeof cli.args.id === 'string' ? cli.args.id : '';
    const shouldPrintJson = cli.args.json === true;

    if (action === 'requests') {
        const response = await requestJson<TRequestTraceListResponse>('/__proteum/trace/requests');
        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(['Proteum trace', ...response.requests.map(renderTraceSummary)].join('\n'));
        return;
    }

    if (action === 'arm') {
        const capture = typeof cli.args.capture === 'string' && cli.args.capture ? cli.args.capture : 'deep';
        const response = await requestJson<TRequestTraceArmResponse>('/__proteum/trace/arm', {
            method: 'POST',
            json: { capture },
        });

        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(`Armed next request trace with capture=${response.capture}.`);
        return;
    }

    if (action === 'latest') {
        const response = await requestJson<TRequestTraceResponse>('/__proteum/trace/latest');
        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(renderTrace(response.request));
        return;
    }

    if (!requestId) {
        throw new UsageError(`Trace action "${action}" requires a request id.`);
    }

    const response = await requestJson<TRequestTraceResponse>(`/__proteum/trace/requests/${requestId}`);

    if (action === 'show') {
        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(renderTrace(response.request));
        return;
    }

    const output =
        typeof cli.args.output === 'string' && cli.args.output
            ? cli.args.output
            : path.join(cli.args.workdir as string, 'var', 'traces', 'exports', `${response.request.id}.json`);

    fs.ensureDirSync(path.dirname(output));
    fs.writeJSONSync(output, response.request, { spaces: 2 });

    if (shouldPrintJson) {
        printJson({ output, request: response.request });
        return;
    }

    console.log(`Exported trace ${response.request.id} to ${output}`);
};
