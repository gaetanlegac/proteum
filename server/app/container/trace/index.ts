import fs from 'fs-extra';
import path from 'path';

import type ApplicationContainer from '..';
import {
    traceCaptureModes,
    type TTraceCaptureMode,
    type TTraceEvent,
    type TTraceEventType,
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

    const primitiveType = typeof value;
    if (primitiveType === 'string') return summarizeString(value);
    if (primitiveType === 'number' || primitiveType === 'boolean') return value;
    if (primitiveType === 'bigint') return { kind: 'bigint', value: value.toString() };
    if (primitiveType === 'symbol') return { kind: 'symbol', value: value.toString() };
    if (primitiveType === 'function') return { kind: 'function', name: value.name || 'anonymous' };

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
        return this.config.enable && this.container.Environment.profile === 'dev';
    }

    public armNextRequest(capture: string) {
        if (!isTraceCaptureMode(capture)) {
            throw new Error(`Unsupported trace capture mode "${capture}". Expected one of: ${traceCaptureModes.join(', ')}.`);
        }

        this.armedCapture = capture;
        return capture;
    }

    public startRequest(input: { id: string; method: string; path: string; url: string; headers: object; data: object }) {
        if (!this.isEnabled()) return;

        const capture = this.armedCapture ?? this.config.capture;
        this.armedCapture = undefined;

        const trace: TRequestTrace = {
            id: input.id,
            method: input.method,
            path: input.path,
            url: input.url,
            capture,
            startedAt: nowIso(),
            droppedEvents: 0,
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
                eventCount: trace.events.length,
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
