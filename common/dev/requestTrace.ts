export const traceCaptureModes = ['summary', 'resolve', 'deep'] as const;

export type TTraceCaptureMode = (typeof traceCaptureModes)[number];
type TTracePrimitive = string | number | boolean;

export const traceCallOrigins = ['ssr-fetcher', 'api-batch-fetcher', 'client-async'] as const;

export type TTraceCallOrigin = (typeof traceCallOrigins)[number];

export const traceEventTypes = [
    'request.start',
    'request.user',
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
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    statusCode?: number;
    errorMessage?: string;
    requestDataKeys: string[];
    requestData?: TTraceSummaryValue;
    resultKeys: string[];
    result?: TTraceSummaryValue;
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
    calls: TTraceCall[];
    events: TTraceEvent[];
};

export type TRequestTraceListItem = Omit<TRequestTrace, 'events' | 'calls'> & { eventCount: number; callCount: number };

export type TRequestTraceListResponse = { requests: TRequestTraceListItem[] };
export type TRequestTraceResponse = { request: TRequestTrace };
export type TRequestTraceArmResponse = { armed: true; capture: TTraceCaptureMode };
export type TRequestTraceErrorResponse = { error: string };
