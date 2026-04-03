import type {
    TRequestTrace,
    TRequestTracePerformance,
    TTraceCall,
    TTraceEvent,
    TTraceMemorySnapshot,
    TTraceSqlQuery,
    TTraceSummaryValue,
} from './requestTrace';
import { buildRequestChain, explainOwner, type TDiagnoseChainItem } from './inspection';
import type { TProteumManifest } from './proteumManifest';

export const perfGroupByValues = ['path', 'route', 'controller'] as const;
export const perfWindowPresets = ['1h', '6h', '24h', 'today', 'yesterday'] as const;
export const perfStageIds = ['auth', 'routing', 'controller', 'page-data', 'render', 'response'] as const;

export type TPerfGroupBy = (typeof perfGroupByValues)[number];
export type TPerfWindowPreset = (typeof perfWindowPresets)[number];
export type TPerfStageId = (typeof perfStageIds)[number];

export type TPerfStage = {
    durationMs: number;
    endOffsetMs: number;
    id: TPerfStageId;
    label: string;
    startOffsetMs: number;
};

export type TRequestPerfCall = {
    durationMs?: number;
    errorMessage?: string;
    id: string;
    label: string;
    method: string;
    origin: TTraceCall['origin'];
    path: string;
    statusCode?: number;
};

export type TRequestPerfSql = {
    callerLabel: string;
    durationMs: number;
    fingerprint?: string;
    id: string;
    kind: TTraceSqlQuery['kind'];
    connectedNamespace?: string;
    model?: string;
    operation: string;
    query: string;
    serviceLabel?: string;
    target?: string;
};

export type TRequestPerformance = {
    avgCallDurationMs?: number;
    avgSqlDurationMs?: number;
    callCount: number;
    callDurationMs: number;
    capture: TRequestTrace['capture'];
    controllerLabel: string;
    chain?: TDiagnoseChainItem[];
    cpuSystemMs?: number;
    cpuTotalMs?: number;
    cpuUserMs?: number;
    documentBytes?: number;
    errorMessage?: string;
    externalAfterBytes?: number;
    externalBeforeBytes?: number;
    externalDeltaBytes?: number;
    finishedAt?: string;
    heapAfterBytes?: number;
    heapBeforeBytes?: number;
    heapDeltaBytes?: number;
    hottestCalls: TRequestPerfCall[];
    hottestSqlQueries: TRequestPerfSql[];
    htmlBytes?: number;
    method: string;
    path: string;
    renderDurationMs?: number;
    requestId: string;
    responseDurationMs?: number;
    routeLabel: string;
    rssAfterBytes?: number;
    rssBeforeBytes?: number;
    rssDeltaBytes?: number;
    selfDurationMs?: number;
    sqlCount: number;
    sqlDurationMs: number;
    ssrPayloadBytes?: number;
    stages: TPerfStage[];
    startedAt: string;
    statusCode?: number;
    totalDurationMs?: number;
    user?: string;
};

export type TPerfWindow = {
    availableRequestCount: number;
    finishedAt: string;
    label: string;
    requestCount: number;
    startedAt: string;
};

export type TPerfTopRow = {
    avgCallDurationMs: number;
    avgCpuMs: number;
    avgDurationMs: number;
    avgHeapDeltaBytes: number;
    avgRenderDurationMs: number;
    avgRssDeltaBytes: number;
    avgSelfDurationMs: number;
    avgSqlDurationMs: number;
    avgSsrPayloadBytes: number;
    errorCount: number;
    groupBy: TPerfGroupBy;
    key: string;
    label: string;
    latestRequestId?: string;
    maxDurationMs: number;
    maxHeapDeltaBytes: number;
    maxRssDeltaBytes: number;
    maxSsrPayloadBytes: number;
    p95DurationMs: number;
    requestCount: number;
    slowestRequestId?: string;
    totalCallDurationMs: number;
    totalCpuMs: number;
    totalDurationMs: number;
    totalRenderDurationMs: number;
    totalSqlDurationMs: number;
};

export type TPerfTopSummary = Omit<TPerfTopRow, 'groupBy' | 'key' | 'label' | 'latestRequestId' | 'slowestRequestId'>;

export type TPerfTopResponse = {
    groupBy: TPerfGroupBy;
    limit: number;
    rows: TPerfTopRow[];
    summary: TPerfTopSummary;
    window: TPerfWindow;
};

export type TPerfMetricDelta = {
    baseline: number;
    delta: number;
    deltaPercent?: number;
    target: number;
};

export type TPerfCompareChange = 'changed' | 'improved' | 'new' | 'regressed' | 'removed';

export type TPerfCompareRow = {
    avgCpuMs: TPerfMetricDelta;
    avgDurationMs: TPerfMetricDelta;
    avgHeapDeltaBytes: TPerfMetricDelta;
    avgRenderDurationMs: TPerfMetricDelta;
    avgSqlDurationMs: TPerfMetricDelta;
    change: TPerfCompareChange;
    groupBy: TPerfGroupBy;
    key: string;
    label: string;
    p95DurationMs: TPerfMetricDelta;
    requestCount: TPerfMetricDelta;
    score: number;
};

export type TPerfCompareResponse = {
    baseline: TPerfWindow;
    groupBy: TPerfGroupBy;
    limit: number;
    rows: TPerfCompareRow[];
    target: TPerfWindow;
};

export type TPerfMemoryTrend = 'mixed' | 'rising' | 'stable';

export type TPerfMemoryRow = {
    avgHeapDeltaBytes: number;
    avgRssDeltaBytes: number;
    groupBy: TPerfGroupBy;
    key: string;
    label: string;
    maxHeapDeltaBytes: number;
    maxRssDeltaBytes: number;
    positiveHeapDriftCount: number;
    positiveHeapDriftRatio: number;
    positiveRssDriftCount: number;
    positiveRssDriftRatio: number;
    requestCount: number;
    trend: TPerfMemoryTrend;
};

export type TPerfMemoryResponse = {
    groupBy: TPerfGroupBy;
    limit: number;
    rows: TPerfMemoryRow[];
    window: TPerfWindow;
};

export type TPerfRequestResponse = {
    request: TRequestPerformance;
};

const authEventTypes = [
    'auth.decode',
    'auth.route',
    'auth.check.start',
    'auth.check.rule',
    'auth.check.result',
    'auth.session',
] as const;

const readNumber = (value: TTraceSummaryValue | undefined) => (typeof value === 'number' ? value : undefined);
const readString = (value: TTraceSummaryValue | undefined) => (typeof value === 'string' ? value : undefined);
const readDateMs = (value?: string) => {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
};

const average = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

const percentile = (values: number[], percentileValue: number) => {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
    return sorted[rank];
};

const startOfUtcDay = (timestampMs: number) => {
    const date = new Date(timestampMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const toIso = (timestampMs: number) => new Date(timestampMs).toISOString();

const resolvePerfWindow = (rawWindow: string | undefined, requests: TRequestTrace[], nowMs = Date.now()): TPerfWindow => {
    const normalized = (rawWindow || 'today').trim().toLowerCase();
    let startedAtMs: number;
    let finishedAtMs = nowMs;

    if (normalized === 'today') {
        startedAtMs = startOfUtcDay(nowMs);
    } else if (normalized === 'yesterday') {
        finishedAtMs = startOfUtcDay(nowMs);
        startedAtMs = finishedAtMs - 24 * 60 * 60 * 1000;
    } else {
        const durationMatch = normalized.match(/^(\d+)(m|h|d)$/);
        if (durationMatch) {
            const amount = Number.parseInt(durationMatch[1], 10);
            const unit = durationMatch[2];
            const factor = unit === 'm' ? 60 * 1000 : unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
            startedAtMs = nowMs - amount * factor;
        } else {
            const parsed = Date.parse(rawWindow || '');
            if (Number.isNaN(parsed)) {
                throw new Error(
                    `Unsupported perf window "${rawWindow}". Expected one of ${perfWindowPresets.join(', ')} or an ISO timestamp.`,
                );
            }

            startedAtMs = parsed;
        }
    }

    const requestCount = requests.filter((request) => {
        const requestStartMs = readDateMs(request.startedAt);
        return requestStartMs !== undefined && requestStartMs >= startedAtMs && requestStartMs <= finishedAtMs;
    }).length;

    return {
        availableRequestCount: requests.length,
        finishedAt: toIso(finishedAtMs),
        label: rawWindow || 'today',
        requestCount,
        startedAt: toIso(startedAtMs),
    };
};

const selectRequestsInWindow = (requests: TRequestTrace[], rawWindow: string | undefined, nowMs = Date.now()) => {
    const finishedRequests = requests.filter((request) => request.finishedAt && request.durationMs !== undefined);
    const window = resolvePerfWindow(rawWindow, finishedRequests, nowMs);
    const windowStartMs = readDateMs(window.startedAt) || 0;
    const windowEndMs = readDateMs(window.finishedAt) || nowMs;
    const filteredRequests = finishedRequests.filter((request) => {
        const requestStartMs = readDateMs(request.startedAt);
        return requestStartMs !== undefined && requestStartMs >= windowStartMs && requestStartMs <= windowEndMs;
    });

    return {
        requests: filteredRequests,
        window: { ...window, availableRequestCount: finishedRequests.length, requestCount: filteredRequests.length },
    };
};

const findFirstEvent = (trace: TRequestTrace, eventTypes: readonly string[]) => trace.events.find((event) => eventTypes.includes(event.type));

const findLastEvent = (trace: TRequestTrace, eventTypes: readonly string[]) => {
    for (let index = trace.events.length - 1; index >= 0; index -= 1) {
        const event = trace.events[index];
        if (eventTypes.includes(event.type)) return event;
    }

    return undefined;
};

const buildStage = (input: { id: TPerfStageId; label: string; startOffsetMs?: number; endOffsetMs?: number }) => {
    if (input.startOffsetMs === undefined || input.endOffsetMs === undefined) return undefined;
    if (input.endOffsetMs <= input.startOffsetMs) return undefined;

    return {
        durationMs: Math.max(0, input.endOffsetMs - input.startOffsetMs),
        endOffsetMs: input.endOffsetMs,
        id: input.id,
        label: input.label,
        startOffsetMs: input.startOffsetMs,
    } satisfies TPerfStage;
};

const readStageOffset = (event: TTraceEvent | undefined) => event?.elapsedMs;

const formatCallLabel = (call: TTraceCall) => {
    if (call.connectedProjectNamespace && call.connectedControllerAccessor) {
        return `${call.connectedProjectNamespace}.${call.connectedControllerAccessor}`;
    }

    const reference = `${call.method} ${call.path}`.trim();
    if (call.serviceLabel && call.label && reference) return `${call.serviceLabel} -> ${call.label} (${reference})`;
    if (call.serviceLabel && reference) return `${call.serviceLabel} -> ${reference}`;
    if (call.label && reference) return `${call.label} (${reference})`;
    return call.label || reference || call.origin;
};

const formatSqlCallerLabel = (query: TTraceSqlQuery) => {
    const reference = `${query.callerMethod} ${query.callerPath}`.trim();
    if (query.serviceLabel && query.callerLabel && reference) return `${query.serviceLabel} -> ${query.callerLabel} (${reference})`;
    if (query.serviceLabel && reference) return `${query.serviceLabel} -> ${reference}`;
    if (query.callerLabel && reference) return `${query.callerLabel} (${reference})`;
    return query.callerLabel || reference || query.operation;
};

const readRequestPerformanceMetric = (performance: TRequestTracePerformance | undefined, selector: (snapshot: TTraceMemorySnapshot) => number) => {
    if (!performance) return { after: undefined, before: undefined, delta: undefined };

    const before = selector(performance.memory.before);
    const after = selector(performance.memory.after);

    return {
        after,
        before,
        delta: after - before,
    };
};

const findRouteLabel = (trace: TRequestTrace) => {
    const routeMatch = findFirstEvent(trace, ['resolve.route-match']);
    const controllerRoute = findFirstEvent(trace, ['resolve.controller-route']);
    return (
        readString(routeMatch?.details.routeId) ||
        readString(routeMatch?.details.routePath) ||
        readString(controllerRoute?.details.path) ||
        trace.path
    );
};

const findControllerLabel = (trace: TRequestTrace) => {
    const controllerStart = findFirstEvent(trace, ['controller.start']);
    return readString(controllerStart?.details.target) || readString(controllerStart?.details.filepath) || findRouteLabel(trace);
};

const buildStages = (trace: TRequestTrace) => {
    const requestFinish = findLastEvent(trace, ['request.finish']);
    const controllerResult = findFirstEvent(trace, ['controller.result']);
    const pageData = findFirstEvent(trace, ['page.data']);
    const renderStart = findFirstEvent(trace, ['render.start']);
    const renderEnd = findFirstEvent(trace, ['render.end']);
    const responseSend = findFirstEvent(trace, ['response.send']);
    const resolveStart = findFirstEvent(trace, ['resolve.start']);
    const routeResolved = findFirstEvent(trace, ['resolve.controller-route', 'resolve.route-match', 'resolve.not-found']);

    return [
        buildStage({
            endOffsetMs: readStageOffset(findLastEvent(trace, authEventTypes)),
            id: 'auth',
            label: 'Auth',
            startOffsetMs: readStageOffset(findFirstEvent(trace, authEventTypes)),
        }),
        buildStage({
            endOffsetMs: readStageOffset(routeResolved),
            id: 'routing',
            label: 'Routing',
            startOffsetMs: readStageOffset(resolveStart),
        }),
        buildStage({
            endOffsetMs: readStageOffset(controllerResult),
            id: 'controller',
            label: 'Controller',
            startOffsetMs: readStageOffset(findFirstEvent(trace, ['controller.start'])),
        }),
        buildStage({
            endOffsetMs: readStageOffset(pageData),
            id: 'page-data',
            label: 'Page Data',
            startOffsetMs: readStageOffset(controllerResult),
        }),
        buildStage({
            endOffsetMs: readStageOffset(renderEnd),
            id: 'render',
            label: 'Render',
            startOffsetMs: readStageOffset(renderStart),
        }),
        buildStage({
            endOffsetMs: readStageOffset(requestFinish),
            id: 'response',
            label: 'Response',
            startOffsetMs: readStageOffset(responseSend),
        }),
    ].filter((stage): stage is TPerfStage => stage !== undefined);
};

const buildMetricDelta = (baseline: number, target: number): TPerfMetricDelta => ({
    baseline,
    delta: target - baseline,
    deltaPercent: baseline === 0 ? (target === 0 ? 0 : undefined) : ((target - baseline) / baseline) * 100,
    target,
});

const deriveCompareChange = (row: Omit<TPerfCompareRow, 'change' | 'score'>): TPerfCompareChange => {
    if (row.requestCount.baseline === 0 && row.requestCount.target > 0) return 'new';
    if (row.requestCount.baseline > 0 && row.requestCount.target === 0) return 'removed';

    const regressionSignals = [
        row.avgDurationMs.delta,
        row.p95DurationMs.delta,
        row.avgCpuMs.delta,
        row.avgHeapDeltaBytes.delta,
        row.avgSqlDurationMs.delta,
    ];
    const improvementSignals = regressionSignals.filter((value) => value < 0).length;
    const regressionCount = regressionSignals.filter((value) => value > 0).length;

    if (regressionCount > improvementSignals) return 'regressed';
    if (improvementSignals > regressionCount) return 'improved';
    return 'changed';
};

const summarizeProfiles = (profiles: TRequestPerformance[]): TPerfTopSummary => {
    const durations = profiles.map((profile) => profile.totalDurationMs || 0);
    const cpu = profiles.map((profile) => profile.cpuTotalMs || 0);
    const heapDeltas = profiles.map((profile) => profile.heapDeltaBytes || 0);
    const rssDeltas = profiles.map((profile) => profile.rssDeltaBytes || 0);
    const renderDurations = profiles.map((profile) => profile.renderDurationMs || 0);
    const sqlDurations = profiles.map((profile) => profile.sqlDurationMs);
    const callDurations = profiles.map((profile) => profile.callDurationMs);
    const selfDurations = profiles.map((profile) => profile.selfDurationMs || 0);
    const ssrPayloads = profiles.map((profile) => profile.ssrPayloadBytes || 0);

    return {
        avgCallDurationMs: average(callDurations),
        avgCpuMs: average(cpu),
        avgDurationMs: average(durations),
        avgHeapDeltaBytes: average(heapDeltas),
        avgRenderDurationMs: average(renderDurations),
        avgRssDeltaBytes: average(rssDeltas),
        avgSelfDurationMs: average(selfDurations),
        avgSqlDurationMs: average(sqlDurations),
        avgSsrPayloadBytes: average(ssrPayloads),
        errorCount: profiles.filter((profile) => profile.errorMessage || (profile.statusCode !== undefined && profile.statusCode >= 400)).length,
        maxDurationMs: durations.reduce((value, durationMs) => Math.max(value, durationMs), 0),
        maxHeapDeltaBytes: heapDeltas.reduce((value, delta) => Math.max(value, delta), 0),
        maxRssDeltaBytes: rssDeltas.reduce((value, delta) => Math.max(value, delta), 0),
        maxSsrPayloadBytes: ssrPayloads.reduce((value, bytes) => Math.max(value, bytes), 0),
        p95DurationMs: percentile(durations, 0.95),
        requestCount: profiles.length,
        totalCallDurationMs: callDurations.reduce((count, durationMs) => count + durationMs, 0),
        totalCpuMs: cpu.reduce((count, durationMs) => count + durationMs, 0),
        totalDurationMs: durations.reduce((count, durationMs) => count + durationMs, 0),
        totalRenderDurationMs: renderDurations.reduce((count, durationMs) => count + durationMs, 0),
        totalSqlDurationMs: sqlDurations.reduce((count, durationMs) => count + durationMs, 0),
    };
};

export const buildRequestPerformance = (trace: TRequestTrace, manifest?: TProteumManifest): TRequestPerformance => {
    const performance = trace.performance;
    const cpuUserMs = performance ? performance.cpu.userMicros / 1000 : undefined;
    const cpuSystemMs = performance ? performance.cpu.systemMicros / 1000 : undefined;
    const cpuTotalMs = cpuUserMs !== undefined && cpuSystemMs !== undefined ? cpuUserMs + cpuSystemMs : undefined;
    const heapMetrics = readRequestPerformanceMetric(performance, (snapshot) => snapshot.heapUsed);
    const rssMetrics = readRequestPerformanceMetric(performance, (snapshot) => snapshot.rss);
    const externalMetrics = readRequestPerformanceMetric(performance, (snapshot) => snapshot.external);
    const renderEnd = findFirstEvent(trace, ['render.end']);
    const renderStart = findFirstEvent(trace, ['render.start']);
    const ssrPayload = findFirstEvent(trace, ['ssr.payload']);
    const stages = buildStages(trace);
    const renderDurationMs =
        renderStart && renderEnd && renderEnd.elapsedMs >= renderStart.elapsedMs
            ? renderEnd.elapsedMs - renderStart.elapsedMs
            : undefined;
    const responseStage = stages.find((stage) => stage.id === 'response');
    const sqlDurationMs = trace.sqlQueries.reduce((count, query) => count + query.durationMs, 0);
    const callDurations = trace.calls.map((call) => call.durationMs || 0);
    const callDurationMs = callDurations.reduce((count, durationMs) => count + durationMs, 0);
    const totalDurationMs = trace.durationMs;
    const selfDurationMs =
        totalDurationMs !== undefined ? Math.max(0, totalDurationMs - sqlDurationMs - callDurationMs - (renderDurationMs || 0)) : undefined;

    return {
        avgCallDurationMs: trace.calls.length > 0 ? callDurationMs / trace.calls.length : undefined,
        avgSqlDurationMs: trace.sqlQueries.length > 0 ? sqlDurationMs / trace.sqlQueries.length : undefined,
        callCount: trace.calls.length,
        callDurationMs,
        capture: trace.capture,
        controllerLabel: findControllerLabel(trace),
        chain: manifest ? buildRequestChain({ manifest, owner: explainOwner(manifest, trace.path), request: trace }) : undefined,
        cpuSystemMs,
        cpuTotalMs,
        cpuUserMs,
        documentBytes: readNumber(renderEnd?.details.documentLength),
        errorMessage: trace.errorMessage,
        externalAfterBytes: externalMetrics.after,
        externalBeforeBytes: externalMetrics.before,
        externalDeltaBytes: externalMetrics.delta,
        finishedAt: trace.finishedAt,
        heapAfterBytes: heapMetrics.after,
        heapBeforeBytes: heapMetrics.before,
        heapDeltaBytes: heapMetrics.delta,
        hottestCalls: [...trace.calls]
            .sort((left, right) => (right.durationMs || 0) - (left.durationMs || 0))
            .slice(0, 5)
            .map((call) => ({
                durationMs: call.durationMs,
                errorMessage: call.errorMessage,
                id: call.id,
                label: formatCallLabel(call),
                method: call.method,
                origin: call.origin,
                path: call.path,
                statusCode: call.statusCode,
            })),
        hottestSqlQueries: [...trace.sqlQueries]
            .sort((left, right) => right.durationMs - left.durationMs)
            .slice(0, 5)
            .map((query) => ({
                callerLabel: formatSqlCallerLabel(query),
                durationMs: query.durationMs,
                fingerprint: query.fingerprint,
                id: query.id,
                kind: query.kind,
                connectedNamespace: query.connectedNamespace,
                model: query.model,
                operation: query.operation,
                query: query.query,
                serviceLabel: query.serviceLabel,
                target: query.target,
            })),
        htmlBytes: readNumber(renderEnd?.details.htmlLength),
        method: trace.method,
        path: trace.path,
        renderDurationMs,
        requestId: trace.id,
        responseDurationMs: responseStage?.durationMs,
        routeLabel: findRouteLabel(trace),
        rssAfterBytes: rssMetrics.after,
        rssBeforeBytes: rssMetrics.before,
        rssDeltaBytes: rssMetrics.delta,
        selfDurationMs,
        sqlCount: trace.sqlQueries.length,
        sqlDurationMs,
        ssrPayloadBytes: readNumber(ssrPayload?.details.serializedBytes),
        stages,
        startedAt: trace.startedAt,
        statusCode: trace.statusCode,
        totalDurationMs,
        user: trace.user,
    };
};

const readGroupValue = (groupBy: TPerfGroupBy, request: TRequestPerformance) => {
    if (groupBy === 'controller') return request.controllerLabel;
    if (groupBy === 'route') return request.routeLabel;
    return request.path;
};

export const buildPerfTopResponse = ({
    groupBy = 'path',
    limit = 12,
    requests,
    since = 'today',
}: {
    groupBy?: TPerfGroupBy;
    limit?: number;
    requests: TRequestTrace[];
    since?: string;
}): TPerfTopResponse => {
    const selectedGroupBy = perfGroupByValues.includes(groupBy) ? groupBy : 'path';
    const { requests: filteredRequests, window } = selectRequestsInWindow(requests, since);
    const profiles = filteredRequests.map((trace) => buildRequestPerformance(trace));
    const groups = new Map<string, TRequestPerformance[]>();

    for (const profile of profiles) {
        const key = readGroupValue(selectedGroupBy, profile) || profile.path || 'request';
        const existing = groups.get(key);
        if (existing) existing.push(profile);
        else groups.set(key, [profile]);
    }

    const rows = [...groups.entries()]
        .map(([key, groupProfiles]) => {
            const durations = groupProfiles.map((profile) => profile.totalDurationMs || 0);
            const cpu = groupProfiles.map((profile) => profile.cpuTotalMs || 0);
            const heapDeltas = groupProfiles.map((profile) => profile.heapDeltaBytes || 0);
            const rssDeltas = groupProfiles.map((profile) => profile.rssDeltaBytes || 0);
            const renderDurations = groupProfiles.map((profile) => profile.renderDurationMs || 0);
            const sqlDurations = groupProfiles.map((profile) => profile.sqlDurationMs);
            const callDurations = groupProfiles.map((profile) => profile.callDurationMs);
            const selfDurations = groupProfiles.map((profile) => profile.selfDurationMs || 0);
            const ssrPayloads = groupProfiles.map((profile) => profile.ssrPayloadBytes || 0);
            const latestProfile = [...groupProfiles].sort(
                (left, right) => (readDateMs(right.startedAt) || 0) - (readDateMs(left.startedAt) || 0),
            )[0];
            const slowestProfile = [...groupProfiles].sort((left, right) => (right.totalDurationMs || 0) - (left.totalDurationMs || 0))[0];

            return {
                avgCallDurationMs: average(callDurations),
                avgCpuMs: average(cpu),
                avgDurationMs: average(durations),
                avgHeapDeltaBytes: average(heapDeltas),
                avgRenderDurationMs: average(renderDurations),
                avgRssDeltaBytes: average(rssDeltas),
                avgSelfDurationMs: average(selfDurations),
                avgSqlDurationMs: average(sqlDurations),
                avgSsrPayloadBytes: average(ssrPayloads),
                errorCount: groupProfiles.filter(
                    (profile) => profile.errorMessage || (profile.statusCode !== undefined && profile.statusCode >= 400),
                ).length,
                groupBy: selectedGroupBy,
                key,
                label: key,
                latestRequestId: latestProfile?.requestId,
                maxDurationMs: durations.reduce((value, durationMs) => Math.max(value, durationMs), 0),
                maxHeapDeltaBytes: heapDeltas.reduce((value, durationMs) => Math.max(value, durationMs), 0),
                maxRssDeltaBytes: rssDeltas.reduce((value, durationMs) => Math.max(value, durationMs), 0),
                maxSsrPayloadBytes: ssrPayloads.reduce((value, durationMs) => Math.max(value, durationMs), 0),
                p95DurationMs: percentile(durations, 0.95),
                requestCount: groupProfiles.length,
                slowestRequestId: slowestProfile?.requestId,
                totalCallDurationMs: callDurations.reduce((count, durationMs) => count + durationMs, 0),
                totalCpuMs: cpu.reduce((count, durationMs) => count + durationMs, 0),
                totalDurationMs: durations.reduce((count, durationMs) => count + durationMs, 0),
                totalRenderDurationMs: renderDurations.reduce((count, durationMs) => count + durationMs, 0),
                totalSqlDurationMs: sqlDurations.reduce((count, durationMs) => count + durationMs, 0),
            } satisfies TPerfTopRow;
        })
        .sort(
            (left, right) =>
                right.totalDurationMs - left.totalDurationMs ||
                right.p95DurationMs - left.p95DurationMs ||
                right.totalCpuMs - left.totalCpuMs ||
                left.label.localeCompare(right.label),
        )
        .slice(0, Math.max(1, limit));

    return {
        groupBy: selectedGroupBy,
        limit: Math.max(1, limit),
        rows,
        summary: summarizeProfiles(profiles),
        window,
    };
};

export const buildPerfCompareResponse = ({
    baseline = 'yesterday',
    groupBy = 'path',
    limit = 12,
    requests,
    target = 'today',
}: {
    baseline?: string;
    groupBy?: TPerfGroupBy;
    limit?: number;
    requests: TRequestTrace[];
    target?: string;
}): TPerfCompareResponse => {
    const selectedGroupBy = perfGroupByValues.includes(groupBy) ? groupBy : 'path';
    const baselineTop = buildPerfTopResponse({ groupBy: selectedGroupBy, limit: Number.MAX_SAFE_INTEGER, requests, since: baseline });
    const targetTop = buildPerfTopResponse({ groupBy: selectedGroupBy, limit: Number.MAX_SAFE_INTEGER, requests, since: target });
    const keys = [...new Set([...baselineTop.rows.map((row) => row.key), ...targetTop.rows.map((row) => row.key)])];
    const baselineByKey = new Map(baselineTop.rows.map((row) => [row.key, row]));
    const targetByKey = new Map(targetTop.rows.map((row) => [row.key, row]));

    const rows = keys
        .map((key) => {
            const baselineRow = baselineByKey.get(key);
            const targetRow = targetByKey.get(key);
            const row = {
                avgCpuMs: buildMetricDelta(baselineRow?.avgCpuMs || 0, targetRow?.avgCpuMs || 0),
                avgDurationMs: buildMetricDelta(baselineRow?.avgDurationMs || 0, targetRow?.avgDurationMs || 0),
                avgHeapDeltaBytes: buildMetricDelta(baselineRow?.avgHeapDeltaBytes || 0, targetRow?.avgHeapDeltaBytes || 0),
                avgRenderDurationMs: buildMetricDelta(
                    baselineRow?.avgRenderDurationMs || 0,
                    targetRow?.avgRenderDurationMs || 0,
                ),
                avgSqlDurationMs: buildMetricDelta(baselineRow?.avgSqlDurationMs || 0, targetRow?.avgSqlDurationMs || 0),
                groupBy: selectedGroupBy,
                key,
                label: targetRow?.label || baselineRow?.label || key,
                p95DurationMs: buildMetricDelta(baselineRow?.p95DurationMs || 0, targetRow?.p95DurationMs || 0),
                requestCount: buildMetricDelta(baselineRow?.requestCount || 0, targetRow?.requestCount || 0),
            };

            const deltaSignals = [
                row.p95DurationMs.deltaPercent,
                row.avgDurationMs.deltaPercent,
                row.avgCpuMs.deltaPercent,
                row.avgHeapDeltaBytes.deltaPercent,
            ]
                .filter((value): value is number => value !== undefined)
                .map((value) => Math.abs(value));

            return {
                ...row,
                change: deriveCompareChange(row),
                score: deltaSignals.length > 0 ? Math.max(...deltaSignals) : Math.abs(row.avgDurationMs.delta),
            } satisfies TPerfCompareRow;
        })
        .filter((row) => row.requestCount.baseline > 0 || row.requestCount.target > 0)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, Math.max(1, limit));

    return {
        baseline: baselineTop.window,
        groupBy: selectedGroupBy,
        limit: Math.max(1, limit),
        rows,
        target: targetTop.window,
    };
};

export const buildPerfMemoryResponse = ({
    groupBy = 'path',
    limit = 12,
    requests,
    since = 'today',
}: {
    groupBy?: TPerfGroupBy;
    limit?: number;
    requests: TRequestTrace[];
    since?: string;
}): TPerfMemoryResponse => {
    const selectedGroupBy = perfGroupByValues.includes(groupBy) ? groupBy : 'path';
    const { requests: filteredRequests, window } = selectRequestsInWindow(requests, since);
    const profiles = filteredRequests.map((trace) => buildRequestPerformance(trace));
    const groups = new Map<string, TRequestPerformance[]>();

    for (const profile of profiles) {
        const key = readGroupValue(selectedGroupBy, profile) || profile.path || 'request';
        const existing = groups.get(key);
        if (existing) existing.push(profile);
        else groups.set(key, [profile]);
    }

    const rows = [...groups.entries()]
        .map(([key, groupProfiles]) => {
            const heapDeltas = groupProfiles.map((profile) => profile.heapDeltaBytes || 0);
            const rssDeltas = groupProfiles.map((profile) => profile.rssDeltaBytes || 0);
            const positiveHeapDriftCount = heapDeltas.filter((value) => value > 0).length;
            const positiveRssDriftCount = rssDeltas.filter((value) => value > 0).length;
            const positiveHeapDriftRatio = groupProfiles.length > 0 ? positiveHeapDriftCount / groupProfiles.length : 0;
            const positiveRssDriftRatio = groupProfiles.length > 0 ? positiveRssDriftCount / groupProfiles.length : 0;

            let trend: TPerfMemoryTrend = 'stable';
            if (positiveHeapDriftRatio >= 0.7 || positiveRssDriftRatio >= 0.7) trend = 'rising';
            else if (positiveHeapDriftRatio >= 0.35 || positiveRssDriftRatio >= 0.35) trend = 'mixed';

            return {
                avgHeapDeltaBytes: average(heapDeltas),
                avgRssDeltaBytes: average(rssDeltas),
                groupBy: selectedGroupBy,
                key,
                label: key,
                maxHeapDeltaBytes: heapDeltas.reduce((value, delta) => Math.max(value, delta), 0),
                maxRssDeltaBytes: rssDeltas.reduce((value, delta) => Math.max(value, delta), 0),
                positiveHeapDriftCount,
                positiveHeapDriftRatio,
                positiveRssDriftCount,
                positiveRssDriftRatio,
                requestCount: groupProfiles.length,
                trend,
            } satisfies TPerfMemoryRow;
        })
        .sort(
            (left, right) =>
                right.avgHeapDeltaBytes - left.avgHeapDeltaBytes ||
                right.maxHeapDeltaBytes - left.maxHeapDeltaBytes ||
                left.label.localeCompare(right.label),
        )
        .slice(0, Math.max(1, limit));

    return {
        groupBy: selectedGroupBy,
        limit: Math.max(1, limit),
        rows,
        window,
    };
};

export const resolvePerfRequest = (requests: TRequestTrace[], requestOrPath: string, manifest?: TProteumManifest) => {
    const normalized = requestOrPath.trim();
    if (!normalized) throw new Error('Perf request id or path is required.');

    const request =
        requests.find((candidate) => candidate.id === normalized) ||
        [...requests].reverse().find((candidate) => candidate.path === normalized);

    if (!request) {
        throw new Error(`Could not find a traced request for "${requestOrPath}".`);
    }

    return buildRequestPerformance(request, manifest);
};
