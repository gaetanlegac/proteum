import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import type {
    TPerfCompareResponse,
    TPerfMemoryResponse,
    TPerfRequestResponse,
    TPerfTopResponse,
} from '../../common/dev/performance';

type TPerfAction = 'compare' | 'memory' | 'request' | 'top';

const allowedActions = new Set<TPerfAction>(['compare', 'memory', 'request', 'top']);
const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const truncate = (value: string, max = 160) => (value.length <= max ? value : `${value.slice(0, max)}...`);
const formatDuration = (value?: number) => (value === undefined ? 'n/a' : `${Math.round(value)} ms`);
const formatBytes = (value?: number) => (value === undefined ? 'n/a' : `${(value / 1024).toFixed(value >= 1024 ? 1 : 2)} KB`);
const formatSignedBytes = (value?: number) =>
    value === undefined ? 'n/a' : `${value >= 0 ? '+' : '-'}${formatBytes(Math.abs(value))}`;
const formatPercent = (value?: number) => (value === undefined ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`);

const getAction = () => {
    const action = typeof cli.args.action === 'string' && cli.args.action ? cli.args.action : 'top';
    if (!allowedActions.has(action as TPerfAction)) {
        throw new UsageError(`Unsupported perf action "${action}". Expected one of: ${[...allowedActions].join(', ')}.`);
    }

    return action as TPerfAction;
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
    if (explicitUrl) return [normalizeBaseUrl(explicitUrl)];

    const port = getRouterPort();
    return [...new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`])];
};

const requestJson = async <TResponse>(pathname: string) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
        try {
            const response = await got(`${baseUrl}${pathname}`, {
                responseType: 'json',
                retry: { limit: 0 },
                throwHttpErrors: false,
            });

            if (response.statusCode >= 400) {
                const body = response.body as { error?: string } | undefined;
                throw new UsageError(body?.error || `Perf request failed with status ${response.statusCode}.`);
            }

            return response.body as TResponse;
        } catch (error) {
            if (error instanceof UsageError) throw error;

            const message = error instanceof Error ? error.message : String(error);
            attempts.push(`${baseUrl}${pathname}: ${message}`);
        }
    }

    throw new UsageError(
        [
            'Could not reach the Proteum perf server.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Make sure the app is running with `proteum dev`, or pass `--url http://host:port` if it is bound elsewhere.',
        ].join('\n'),
    );
};

const printJson = (value: object) => {
    console.log(JSON.stringify(value, null, 2));
};

const renderWindow = (label: string, value: { startedAt: string; finishedAt: string; requestCount: number; availableRequestCount: number }) =>
    `${label}=${value.requestCount}/${value.availableRequestCount} traces ${value.startedAt}..${value.finishedAt}`;

const renderTop = (response: TPerfTopResponse) =>
    [
        `Proteum perf top groupBy=${response.groupBy} ${renderWindow('window', response.window)}`,
        `- requests=${response.summary.requestCount} errors=${response.summary.errorCount} avg=${formatDuration(response.summary.avgDurationMs)} p95=${formatDuration(response.summary.p95DurationMs)} cpu=${formatDuration(response.summary.avgCpuMs)} sql=${formatDuration(response.summary.avgSqlDurationMs)}`,
        ...(response.rows.length === 0
            ? ['- no traced requests matched this window']
            : response.rows.map(
                  (row) =>
                      `- ${row.label} | requests=${row.requestCount} avg=${formatDuration(row.avgDurationMs)} p95=${formatDuration(row.p95DurationMs)} max=${formatDuration(row.maxDurationMs)} cpu=${formatDuration(row.avgCpuMs)} sql=${formatDuration(row.avgSqlDurationMs)} render=${formatDuration(row.avgRenderDurationMs)} heap=${formatSignedBytes(row.avgHeapDeltaBytes)} slowest=${row.slowestRequestId || 'n/a'}`,
              )),
    ].join('\n');

const renderCompare = (response: TPerfCompareResponse) =>
    [
        `Proteum perf compare groupBy=${response.groupBy}`,
        `- baseline ${renderWindow('window', response.baseline)}`,
        `- target ${renderWindow('window', response.target)}`,
        ...(response.rows.length === 0
            ? ['- no traced requests matched either window']
            : response.rows.map(
                  (row) =>
                      `- [${row.change}] ${row.label} | p95 ${formatPercent(row.p95DurationMs.deltaPercent)} (${formatDuration(row.p95DurationMs.baseline)} -> ${formatDuration(row.p95DurationMs.target)}) | avg ${formatPercent(row.avgDurationMs.deltaPercent)} | cpu ${formatPercent(row.avgCpuMs.deltaPercent)} | heap ${formatSignedBytes(row.avgHeapDeltaBytes.delta)} | sql ${formatPercent(row.avgSqlDurationMs.deltaPercent)}`,
              )),
    ].join('\n');

const renderMemory = (response: TPerfMemoryResponse) =>
    [
        `Proteum perf memory groupBy=${response.groupBy} ${renderWindow('window', response.window)}`,
        ...(response.rows.length === 0
            ? ['- no traced requests matched this window']
            : response.rows.map(
                  (row) =>
                      `- [${row.trend}] ${row.label} | requests=${row.requestCount} heap avg=${formatSignedBytes(row.avgHeapDeltaBytes)} max=${formatSignedBytes(row.maxHeapDeltaBytes)} rss avg=${formatSignedBytes(row.avgRssDeltaBytes)} drift=${formatPercent(row.positiveHeapDriftRatio * 100)}`,
              )),
    ].join('\n');

const renderRequest = (response: TPerfRequestResponse) =>
    [
        `Proteum perf request ${response.request.requestId}`,
        `- ${response.request.method} ${response.request.path} status=${response.request.statusCode ?? 'pending'} route=${response.request.routeLabel} controller=${response.request.controllerLabel}`,
        `- total=${formatDuration(response.request.totalDurationMs)} cpu=${formatDuration(response.request.cpuTotalMs)} sql=${formatDuration(response.request.sqlDurationMs)} calls=${formatDuration(response.request.callDurationMs)} render=${formatDuration(response.request.renderDurationMs)} self=${formatDuration(response.request.selfDurationMs)}`,
        `- heap=${formatSignedBytes(response.request.heapDeltaBytes)} rss=${formatSignedBytes(response.request.rssDeltaBytes)} ssr=${formatBytes(response.request.ssrPayloadBytes)} html=${formatBytes(response.request.htmlBytes)} document=${formatBytes(response.request.documentBytes)}`,
        'Stages',
        ...(response.request.stages.length === 0
            ? ['- none']
            : response.request.stages.map(
                  (stage) => `- ${stage.label} | start=+${Math.round(stage.startOffsetMs)}ms end=+${Math.round(stage.endOffsetMs)}ms duration=${formatDuration(stage.durationMs)}`,
              )),
        'Hot Calls',
        ...(response.request.hottestCalls.length === 0
            ? ['- none']
            : response.request.hottestCalls.map(
                  (call) =>
                      `- ${call.label} | duration=${formatDuration(call.durationMs)} status=${call.statusCode ?? 'pending'} origin=${call.origin}${call.errorMessage ? ` error=${truncate(call.errorMessage, 96)}` : ''}`,
              )),
        'Chain',
        ...(!response.request.chain || response.request.chain.length === 0
            ? ['- none']
            : response.request.chain.map(
                  (item) =>
                      `- [${item.kind}] ${item.label}${item.source?.filepath ? ` | ${item.source.filepath}${item.source.line ? `:${item.source.line}` : ''}${item.source.column ? `:${item.source.column}` : ''}` : ''}${item.details.length > 0 ? ` | ${item.details.join(', ')}` : ''}`,
              )),
        'Hot SQL',
        ...(response.request.hottestSqlQueries.length === 0
            ? ['- none']
            : response.request.hottestSqlQueries.map(
                  (query) =>
                      `- ${query.callerLabel} | ${query.operation}${query.model ? ` ${query.model}` : ''}${query.fingerprint ? ` | fp=${query.fingerprint}` : ''} | duration=${formatDuration(query.durationMs)} | ${truncate(query.query, 104)}`,
              )),
    ].join('\n');

export const run = async () => {
    const action = getAction();
    const shouldPrintJson = cli.args.json === true;
    const groupBy = typeof cli.args.groupBy === 'string' && cli.args.groupBy ? cli.args.groupBy : 'path';
    const limit =
        typeof cli.args.limit === 'string' && cli.args.limit ? Math.max(1, Number.parseInt(cli.args.limit, 10) || 12) : 12;

    if (action === 'top') {
        const since = typeof cli.args.since === 'string' && cli.args.since ? cli.args.since : 'today';
        const response = await requestJson<TPerfTopResponse>(
            `/__proteum/perf/top?${new URLSearchParams({ groupBy, limit: String(limit), since }).toString()}`,
        );
        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(renderTop(response));
        return;
    }

    if (action === 'compare') {
        const baseline = typeof cli.args.baseline === 'string' && cli.args.baseline ? cli.args.baseline : 'yesterday';
        const targetWindow = typeof cli.args.targetWindow === 'string' && cli.args.targetWindow ? cli.args.targetWindow : 'today';
        const response = await requestJson<TPerfCompareResponse>(
            `/__proteum/perf/compare?${new URLSearchParams({
                baseline,
                groupBy,
                limit: String(limit),
                target: targetWindow,
            }).toString()}`,
        );
        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(renderCompare(response));
        return;
    }

    if (action === 'memory') {
        const since = typeof cli.args.since === 'string' && cli.args.since ? cli.args.since : 'today';
        const response = await requestJson<TPerfMemoryResponse>(
            `/__proteum/perf/memory?${new URLSearchParams({ groupBy, limit: String(limit), since }).toString()}`,
        );
        if (shouldPrintJson) {
            printJson(response);
            return;
        }

        console.log(renderMemory(response));
        return;
    }

    const requestTarget = typeof cli.args.target === 'string' ? cli.args.target.trim() : '';
    if (!requestTarget) throw new UsageError('`proteum perf request` requires a traced request id or path.');

    const response = await requestJson<TPerfRequestResponse>(
        `/__proteum/perf/request?${new URLSearchParams({ query: requestTarget }).toString()}`,
    );
    if (shouldPrintJson) {
        printJson(response);
        return;
    }

    console.log(renderRequest(response));
};
