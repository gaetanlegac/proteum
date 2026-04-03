export const traceCaptureModes = ['summary', 'resolve', 'deep'] as const;

export type TTraceCaptureMode = (typeof traceCaptureModes)[number];
type TTracePrimitive = string | number | boolean;

export const traceCallOrigins = ['ssr-fetcher', 'api-batch-fetcher', 'client-async'] as const;

export type TTraceCallOrigin = (typeof traceCallOrigins)[number];
export const traceSqlQueryKinds = ['orm', 'raw'] as const;

export type TTraceSqlQueryKind = (typeof traceSqlQueryKinds)[number];
export type TTraceSqlQueryCallerOrigin = TTraceCallOrigin | 'request';

export const traceEventTypes = [
    'request.start',
    'request.user',
    'auth.decode',
    'auth.route',
    'auth.check.start',
    'auth.check.rule',
    'auth.check.result',
    'auth.session',
    'resolve.start',
    'resolve.controller-route',
    'resolve.routes-evaluated',
    'resolve.route-skip',
    'resolve.route-match',
    'resolve.not-found',
    'controller.start',
    'controller.result',
    'setup.options',
    'context.create',
    'page.data',
    'ssr.payload',
    'render.start',
    'render.end',
    'response.send',
    'request.finish',
    'cache.hit',
    'cache.write',
    'error',
] as const;

export type TTraceEventType = (typeof traceEventTypes)[number];

export type TTraceSummaryValue =
    | TTracePrimitive
    | null
    | { kind: 'undefined' }
    | { kind: 'redacted'; reason: string }
    | { kind: 'bigint'; value: string }
    | { kind: 'symbol'; value: string }
    | { kind: 'function'; name: string }
    | { kind: 'date'; value: string }
    | { kind: 'error'; name: string; message: string; stack?: string }
    | { kind: 'buffer'; byteLength: number }
    | { kind: 'array'; length: number; items: TTraceSummaryValue[]; truncated: boolean }
    | {
          kind: 'object';
          constructorName: string;
          keys: string[];
          entries: { [key: string]: TTraceSummaryValue };
          truncated: boolean;
      }
    | { kind: 'map'; size: number }
    | { kind: 'set'; size: number };

export type TTraceEvent = {
    index: number;
    at: string;
    elapsedMs: number;
    type: TTraceEventType;
    details: { [key: string]: TTraceSummaryValue };
};

export type TTraceCall = {
    id: string;
    parentId?: string;
    origin: TTraceCallOrigin;
    label: string;
    method: string;
    path: string;
    fetcherId?: string;
    connectedProjectNamespace?: string;
    connectedControllerAccessor?: string;
    ownerLabel?: string;
    ownerFilepath?: string;
    serviceLabel?: string;
    cacheKey?: string;
    cachePhase?: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    statusCode?: number;
    errorMessage?: string;
    requestDataKeys: string[];
    requestData?: TTraceSummaryValue;
    requestDataJson?: unknown;
    resultKeys: string[];
    result?: TTraceSummaryValue;
    resultJson?: unknown;
};

export type TTraceSqlQuery = {
    id: string;
    callerCallId?: string;
    callerFetcherId?: string;
    callerLabel?: string;
    callerMethod: string;
    callerOrigin: TTraceSqlQueryCallerOrigin;
    callerPath: string;
    durationMs: number;
    finishedAt: string;
    kind: TTraceSqlQueryKind;
    model?: string;
    operation: string;
    fingerprint?: string;
    ownerLabel?: string;
    ownerFilepath?: string;
    serviceLabel?: string;
    connectedNamespace?: string;
    paramsJson?: unknown;
    paramsText?: string;
    query: string;
    startedAt: string;
    target?: string;
};

export type TTraceMemorySnapshot = {
    arrayBuffers: number;
    external: number;
    heapTotal: number;
    heapUsed: number;
    rss: number;
};

export type TRequestTracePerformance = {
    cpu: {
        systemMicros: number;
        userMicros: number;
    };
    memory: {
        after: TTraceMemorySnapshot;
        before: TTraceMemorySnapshot;
    };
};

export type TRequestTrace = {
    id: string;
    method: string;
    path: string;
    url: string;
    capture: TTraceCaptureMode;
    profilerSessionId?: string;
    profilerOrigin?: string;
    profilerParentRequestId?: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    statusCode?: number;
    user?: string;
    droppedEvents: number;
    persistedFilepath?: string;
    errorMessage?: string;
    requestDataJson?: unknown;
    resultJson?: unknown;
    performance?: TRequestTracePerformance;
    calls: TTraceCall[];
    sqlQueries: TTraceSqlQuery[];
    events: TTraceEvent[];
};

export type TRequestTraceListItem = Omit<TRequestTrace, 'events' | 'calls' | 'sqlQueries'> & {
    eventCount: number;
    callCount: number;
    sqlQueryCount: number;
};

export type TRequestTraceListResponse = { requests: TRequestTraceListItem[] };
export type TRequestTraceResponse = { request: TRequestTrace };
export type TRequestTraceArmResponse = { armed: true; capture: TTraceCaptureMode };
export type TRequestTraceErrorResponse = { error: string };
