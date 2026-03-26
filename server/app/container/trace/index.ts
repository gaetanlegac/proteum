import fs from 'fs-extra';
import path from 'path';

import type ApplicationContainer from '..';
import {
    traceCaptureModes,
    type TTraceCaptureMode,
    type TTraceCall,
    type TTraceCallOrigin,
    type TTraceEvent,
    type TTraceEventType,
    type TTraceSqlQuery,
    type TTraceSqlQueryCallerOrigin,
    type TTraceSqlQueryKind,
    type TTraceSummaryValue,
    type TRequestTrace,
    type TRequestTraceListItem,
} from '@common/dev/requestTrace';

export type Config = {
    enable: boolean;
    requestsLimit: number;
    eventsLimit: number;
    capture: TTraceCaptureMode;
    persistOnError: boolean;
};

type TTraceInspectable = object | PrimitiveValue | bigint | symbol | null | undefined | (() => void);
type TTraceDetails = { [key: string]: TTraceInspectable };

const capturePriority: Record<TTraceCaptureMode, number> = { summary: 0, resolve: 1, deep: 2 };
const sensitiveKeyPattern =
    /(^|\.)(authorization|cookie|set-cookie|password|pass|pwd|secret|token|refreshToken|accessToken|apiKey|apiSecret|secretAccessKey|accessKeyId|privateKey|session|jwt|rawBody)$/i;
const maxStringLength = 240;

const isTraceCaptureMode = (value: string): value is TTraceCaptureMode =>
    traceCaptureModes.includes(value as TTraceCaptureMode);

const isSensitiveKeyPath = (keyPath: string[]) => sensitiveKeyPattern.test(keyPath.join('.'));

const summarizeString = (value: string) =>
    value.length <= maxStringLength ? value : `${value.slice(0, maxStringLength)}…`;

const serializeJsonValue = (value: unknown, keyPath: string[], seen: WeakSet<object>): unknown => {
    if (isSensitiveKeyPath(keyPath)) return `[redacted: Sensitive key ${keyPath[keyPath.length - 1] || 'value'}]`;
    if (value === undefined || value === null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;

    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
    if (value instanceof Map) return Array.from(value.entries()).map(([entryKey, entryValue], index) =>
        serializeJsonValue([entryKey, entryValue], [...keyPath, `[${index}]`], seen),
    );
    if (value instanceof Set) {
        return Array.from(value.values()).map((entryValue, index) => serializeJsonValue(entryValue, [...keyPath, `[${index}]`], seen));
    }

    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return `[Circular ${value.constructor?.name || 'Object'}]`;

    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item, index) => serializeJsonValue(item, [...keyPath, `[${index}]`], seen));
    }

    const serialized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
        const nextValue = serializeJsonValue(entryValue, [...keyPath, entryKey], seen);
        if (nextValue !== undefined) serialized[entryKey] = nextValue;
    }

    return serialized;
};

const serializeCaptureValue = (value: TTraceInspectable, key: string) => serializeJsonValue(value, [key], new WeakSet<object>());

const summarizeError = (error: Error): TTraceSummaryValue => ({
    kind: 'error',
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'),
});

const summarizeValue = (
    value: TTraceInspectable,
    depth: number,
    seen: WeakSet<object>,
    keyPath: string[],
): TTraceSummaryValue => {
    if (isSensitiveKeyPath(keyPath)) return { kind: 'redacted', reason: `Sensitive key ${keyPath[keyPath.length - 1] || 'value'}` };
    if (value === undefined) return { kind: 'undefined' };
    if (value === null) return null;

    if (typeof value === 'string') return summarizeString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return { kind: 'bigint', value: value.toString() };
    if (typeof value === 'symbol') return { kind: 'symbol', value: value.toString() };
    if (typeof value === 'function') return { kind: 'function', name: value.name || 'anonymous' };

    if (value instanceof Date) return { kind: 'date', value: value.toISOString() };
    if (value instanceof Error) return summarizeError(value);
    if (Buffer.isBuffer(value)) return { kind: 'buffer', byteLength: value.byteLength };
    if (value instanceof Map) return { kind: 'map', size: value.size };
    if (value instanceof Set) return { kind: 'set', size: value.size };

    if (seen.has(value)) {
        return {
            kind: 'object',
            constructorName: value.constructor?.name || 'Object',
            keys: [],
            entries: {},
            truncated: true,
        };
    }

    seen.add(value);

    if (Array.isArray(value)) {
        if (depth <= 0) return { kind: 'array', length: value.length, items: [], truncated: value.length > 0 };

        const items = value
            .slice(0, 10)
            .map((item, index) => summarizeValue(item as TTraceInspectable, depth - 1, seen, [...keyPath, `[${index}]`]));
        return { kind: 'array', length: value.length, items, truncated: value.length > items.length };
    }

    const constructorName = value.constructor?.name || 'Object';
    const keys = Object.keys(value);
    if (depth <= 0) {
        return { kind: 'object', constructorName, keys, entries: {}, truncated: keys.length > 0 };
    }

    const entries: { [key: string]: TTraceSummaryValue } = {};
    for (const key of keys.slice(0, 20)) {
        const record = value as Record<string, TTraceInspectable>;
        entries[key] = summarizeValue(record[key], depth - 1, seen, [...keyPath, key]);
    }

    return { kind: 'object', constructorName, keys, entries, truncated: keys.length > Object.keys(entries).length };
};

const summarizeDetails = (details: TTraceDetails, capture: TTraceCaptureMode) => {
    const depth = capture === 'deep' ? 3 : 1;
    const summarized: { [key: string]: TTraceSummaryValue } = {};

    for (const key of Object.keys(details)) {
        summarized[key] = summarizeValue(details[key], depth, new WeakSet<object>(), [key]);
    }

    return summarized;
};

const summarizeCaptureValue = (value: TTraceInspectable, capture: TTraceCaptureMode, key: string) =>
    summarizeValue(value, capture === 'deep' ? 3 : 1, new WeakSet<object>(), [key]);

const nowIso = () => new Date().toISOString();

export default class Trace {
    private requests = new Map<string, TRequestTrace>();
    private order: string[] = [];
    private armedCapture?: TTraceCaptureMode;

    public constructor(
        private container: typeof ApplicationContainer,
        private config: Config,
    ) {}

    public isEnabled() {
        return __DEV__ && this.config.enable && this.container.Environment.profile === 'dev';
    }

    public armNextRequest(capture: string) {
        if (!isTraceCaptureMode(capture)) {
            throw new Error(`Unsupported trace capture mode "${capture}". Expected one of: ${traceCaptureModes.join(', ')}.`);
        }

        this.armedCapture = capture;
        return capture;
    }

    public startRequest(input: {
        id: string;
        method: string;
        path: string;
        url: string;
        headers: object;
        data: object;
        profilerSessionId?: string;
        profilerOrigin?: string;
        profilerParentRequestId?: string;
    }) {
        if (!this.isEnabled()) return;

        const capture = this.armedCapture ?? this.config.capture;
        this.armedCapture = undefined;

        const trace: TRequestTrace = {
            id: input.id,
            method: input.method,
            path: input.path,
            url: input.url,
            capture,
            profilerSessionId: input.profilerSessionId,
            profilerOrigin: input.profilerOrigin,
            profilerParentRequestId: input.profilerParentRequestId,
            startedAt: nowIso(),
            droppedEvents: 0,
            requestDataJson: serializeCaptureValue(input.data, 'requestData'),
            calls: [],
            sqlQueries: [],
            events: [],
        };

        this.requests.set(trace.id, trace);
        this.order.push(trace.id);
        this.trimRequestBuffer();

        this.record(trace.id, 'request.start', { method: input.method, path: input.path, url: input.url, headers: input.headers, data: input.data });
    }

    public setRequestUser(requestId: string, user?: string) {
        const trace = this.requests.get(requestId);
        if (!trace) return;

        trace.user = user;
        if (user) this.record(requestId, 'request.user', { user });
    }

    public getCapture(requestId: string) {
        return this.requests.get(requestId)?.capture;
    }

    public shouldCapture(requestId: string, minimumCapture: TTraceCaptureMode) {
        const capture = this.getCapture(requestId);
        if (!capture) return false;

        return capturePriority[capture] >= capturePriority[minimumCapture];
    }

    public record(requestId: string, type: TTraceEventType, details: TTraceDetails, minimumCapture: TTraceCaptureMode = 'summary') {
        const trace = this.requests.get(requestId);
        if (!trace || !this.shouldCapture(requestId, minimumCapture)) return;

        if (trace.events.length >= this.config.eventsLimit) {
            trace.droppedEvents++;
            return;
        }

        const event: TTraceEvent = {
            index: trace.events.length,
            at: nowIso(),
            elapsedMs: Math.max(0, Date.now() - Date.parse(trace.startedAt)),
            type,
            details: summarizeDetails(details, trace.capture),
        };

        trace.events.push(event);
    }

    public finishRequest(requestId: string, output: { statusCode: number; user?: string; errorMessage?: string }) {
        const trace = this.requests.get(requestId);
        if (!trace) return;

        if (output.user) trace.user = output.user;
        trace.statusCode = output.statusCode;
        trace.errorMessage = output.errorMessage;

        this.record(
            requestId,
            'request.finish',
            { statusCode: output.statusCode, user: output.user || '', errorMessage: output.errorMessage || '' },
            'summary',
        );

        trace.finishedAt = nowIso();
        trace.durationMs = Math.max(0, Date.parse(trace.finishedAt) - Date.parse(trace.startedAt));

        if (this.config.persistOnError && trace.statusCode >= 500) {
            trace.persistedFilepath = this.exportRequest(requestId);
        }
    }

    public startCall(
        requestId: string,
        input: {
            origin: TTraceCallOrigin;
            label: string;
            method?: string;
            path?: string;
            fetcherId?: string;
            parentId?: string;
            requestDataKeys?: string[];
            requestData?: TTraceInspectable;
        },
    ) {
        const trace = this.requests.get(requestId);
        if (!trace) return undefined;

        const call: TTraceCall = {
            id: `${requestId}:call:${trace.calls.length}`,
            parentId: input.parentId,
            origin: input.origin,
            label: input.label,
            method: input.method || '',
            path: input.path || '',
            fetcherId: input.fetcherId,
            startedAt: nowIso(),
            requestDataKeys: input.requestDataKeys || [],
            requestData: input.requestData !== undefined ? summarizeCaptureValue(input.requestData, trace.capture, 'requestData') : undefined,
            requestDataJson: input.requestData !== undefined ? serializeCaptureValue(input.requestData, 'requestData') : undefined,
            resultKeys: [],
        };

        trace.calls.push(call);
        return call.id;
    }

    public finishCall(
        requestId: string,
        callId: string | undefined,
        output: {
            statusCode?: number;
            errorMessage?: string;
            resultKeys?: string[];
            result?: TTraceInspectable;
        } = {},
    ) {
        if (!callId) return;

        const trace = this.requests.get(requestId);
        const call = trace?.calls.find((candidate) => candidate.id === callId);
        if (!trace || !call) return;

        call.finishedAt = nowIso();
        call.durationMs = Math.max(0, Date.parse(call.finishedAt) - Date.parse(call.startedAt));
        call.statusCode = output.statusCode;
        call.errorMessage = output.errorMessage;
        call.resultKeys = output.resultKeys || [];
        call.result = output.result !== undefined ? summarizeCaptureValue(output.result, trace.capture, 'result') : undefined;
        call.resultJson = output.result !== undefined ? serializeCaptureValue(output.result, 'result') : undefined;
    }

    public setRequestResult(requestId: string, result: TTraceInspectable) {
        const trace = this.requests.get(requestId);
        if (!trace) return;

        trace.resultJson = serializeCaptureValue(result, 'result');
    }

    public recordSqlQuery(
        requestId: string,
        input: {
            callerCallId?: string;
            callerFetcherId?: string;
            callerLabel?: string;
            callerMethod?: string;
            callerOrigin?: TTraceSqlQueryCallerOrigin;
            callerPath?: string;
            durationMs?: number;
            finishedAt?: string;
            kind: TTraceSqlQueryKind;
            model?: string;
            operation: string;
            paramsJson?: unknown;
            paramsText?: string;
            query: string;
            target?: string;
        },
    ) {
        const trace = this.requests.get(requestId);
        if (!trace) return;

        const durationMs = Math.max(0, input.durationMs || 0);
        const finishedAt = input.finishedAt || nowIso();
        const finishedAtMs = Date.parse(finishedAt);
        const startedAt =
            Number.isFinite(finishedAtMs) && durationMs > 0 ? new Date(finishedAtMs - durationMs).toISOString() : finishedAt;

        const sqlQuery: TTraceSqlQuery = {
            id: `${requestId}:sql:${trace.sqlQueries.length}`,
            callerCallId: input.callerCallId,
            callerFetcherId: input.callerFetcherId,
            callerLabel: input.callerLabel,
            callerMethod: input.callerMethod || '',
            callerOrigin: input.callerOrigin || 'request',
            callerPath: input.callerPath || '',
            durationMs,
            finishedAt,
            kind: input.kind,
            model: input.model,
            operation: input.operation,
            paramsJson: input.paramsJson,
            paramsText: input.paramsText,
            query: input.query.trim(),
            startedAt,
            target: input.target,
        };

        trace.sqlQueries.push(sqlQuery);
    }

    public listRequests(limit = 20): TRequestTraceListItem[] {
        return [...this.order]
            .reverse()
            .slice(0, limit)
            .map((requestId) => this.requests.get(requestId))
            .filter((trace): trace is TRequestTrace => trace !== undefined)
            .map((trace) => ({
                id: trace.id,
                method: trace.method,
                path: trace.path,
                url: trace.url,
                capture: trace.capture,
                startedAt: trace.startedAt,
                finishedAt: trace.finishedAt,
                durationMs: trace.durationMs,
                statusCode: trace.statusCode,
                user: trace.user,
                droppedEvents: trace.droppedEvents,
                persistedFilepath: trace.persistedFilepath,
                errorMessage: trace.errorMessage,
                profilerSessionId: trace.profilerSessionId,
                profilerOrigin: trace.profilerOrigin,
                profilerParentRequestId: trace.profilerParentRequestId,
                eventCount: trace.events.length,
                callCount: trace.calls.length,
                sqlQueryCount: trace.sqlQueries.length,
            }));
    }

    public getLatestRequest() {
        const latestRequestId = this.order[this.order.length - 1];
        return latestRequestId ? this.requests.get(latestRequestId) : undefined;
    }

    public getRequest(requestId: string) {
        return this.requests.get(requestId);
    }

    public exportRequest(requestId: string, filepath?: string) {
        const trace = this.requests.get(requestId);
        if (!trace) throw new Error(`Trace ${requestId} was not found.`);

        const outputFilepath =
            filepath ||
            path.join(this.container.path.var, 'traces', trace.startedAt.slice(0, 10), `${trace.id}.json`);

        fs.ensureDirSync(path.dirname(outputFilepath));
        fs.writeJSONSync(outputFilepath, trace, { spaces: 2 });

        trace.persistedFilepath = outputFilepath;

        return outputFilepath;
    }

    private trimRequestBuffer() {
        const overflow = this.order.length - this.config.requestsLimit;
        if (overflow <= 0) return;

        for (const requestId of this.order.splice(0, overflow)) {
            this.requests.delete(requestId);
        }
    }
}
