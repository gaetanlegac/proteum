import React from 'react';

import {
    buildDoctorBlocks,
    buildExplainBlocks,
    buildExplainSummaryItems,
    explainSectionNames,
    formatManifestLocation,
    type THumanTextBlock,
} from '@common/dev/diagnostics';
import type { TDevCommandDefinition, TDevCommandExecution } from '@common/dev/commands';
import type {
    TProfilerCronTask,
    TProfilerNavigationSession,
    TProfilerPanel,
    TProfilerSessionTrace,
} from '@common/dev/profiler';
import type { TRequestTrace, TTraceCall, TTraceEventType, TTraceSummaryValue } from '@common/dev/requestTrace';

import { profilerRuntime } from './runtime';

const profilerStyles = `
.proteum-profiler {
    --profiler-bg: #000000;
    --profiler-bg-strong: #000000;
    --profiler-surface-hover: rgba(22, 33, 48, 0.32);
    --profiler-line: rgba(155, 188, 214, 0.16);
    --profiler-line-strong: rgba(155, 188, 214, 0.28);
    --profiler-text: #e5f2ff;
    --profiler-muted: rgba(213, 228, 242, 0.64);
    --profiler-brand: #8fd9ff;
    --profiler-ok: #7af4b4;
    --profiler-warn: #ffd369;
    --profiler-error: #ff9797;
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 2147483000;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    color: var(--profiler-text);
    letter-spacing: 0.01em;
}

.proteum-profiler__bar,
.proteum-profiler__panel,
.proteum-profiler__handle {
    position: relative;
    box-sizing: border-box;
}

.proteum-profiler__bar::before,
.proteum-profiler__panel::before,
.proteum-profiler__handle::before {
    display: none;
}

.proteum-profiler__bar {
    display: flex;
    align-items: center;
    gap: 0;
    min-height: 32px;
    padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--profiler-line-strong);
    background: #000000;
    backdrop-filter: none;
    box-shadow: none;
    overflow-x: auto;
    scrollbar-width: none;
}

.proteum-profiler__bar::-webkit-scrollbar,
.proteum-profiler__panelTabs::-webkit-scrollbar {
    display: none;
}

.proteum-profiler__token {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    padding: 0 10px;
    border: none;
    border-inline-start: 1px solid var(--profiler-line);
    background: transparent;
    color: var(--profiler-muted);
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
}

.proteum-profiler__token:first-child {
    padding-inline-start: 0;
    border-inline-start: none;
}

.proteum-profiler__token:hover {
    color: var(--profiler-text);
    background: var(--profiler-surface-hover);
}

.proteum-profiler__token--brand {
    color: var(--profiler-brand);
    font-weight: 700;
}

.proteum-profiler__token--ok {
    color: var(--profiler-ok);
}

.proteum-profiler__token--warn {
    color: var(--profiler-warn);
}

.proteum-profiler__token--error {
    color: var(--profiler-error);
}

.proteum-profiler__spacer {
    flex: 1 1 auto;
    min-width: 16px;
}

.proteum-profiler__handle {
    position: fixed;
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 30px;
    padding: 0 12px;
    border: 1px solid var(--profiler-line-strong);
    border-radius: 0;
    background: #000000;
    backdrop-filter: none;
    color: var(--profiler-brand);
    box-shadow: none;
    cursor: pointer;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__panel {
    position: fixed;
    inset-inline: 0;
    bottom: calc(32px + env(safe-area-inset-bottom, 0px));
    display: grid;
    grid-template-rows: auto 1fr;
    height: 50vh;
    max-height: 50vh;
    margin: 0;
    border: 1px solid var(--profiler-line-strong);
    border-bottom: none;
    border-left: none;
    border-right: none;
    border-radius: 0;
    background: #000000;
    backdrop-filter: none;
    box-shadow: none;
    overflow: hidden;
}

.proteum-profiler__panelHeader {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--profiler-line);
    min-width: 0;
}

.proteum-profiler__panelTabs {
    display: flex;
    align-items: center;
    gap: 14px;
    overflow: auto;
    padding: 0;
    border-bottom: none;
    scrollbar-width: none;
    flex: 1 1 auto;
    min-width: 0;
}

.proteum-profiler__pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    padding: 0;
    border: none;
    border-bottom: 1px solid transparent;
    background: transparent;
    font-size: 11px;
    color: var(--profiler-muted);
    cursor: pointer;
    white-space: nowrap;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.proteum-profiler__pill:hover {
    color: var(--profiler-text);
    border-bottom-color: var(--profiler-line-strong);
}

.proteum-profiler__pill--active {
    color: var(--profiler-brand);
    border-bottom-color: var(--profiler-brand);
}

.proteum-profiler__pill:disabled {
    opacity: 0.44;
    cursor: default;
}

.proteum-profiler__select {
    flex: 0 1 280px;
    min-width: 160px;
    height: 28px;
    padding: 0 28px 0 10px;
    border: 1px solid var(--profiler-line);
    background-color: #000000;
    background-image:
        linear-gradient(45deg, transparent 50%, var(--profiler-muted) 50%),
        linear-gradient(135deg, var(--profiler-muted) 50%, transparent 50%);
    background-position: calc(100% - 14px) 11px, calc(100% - 9px) 11px;
    background-repeat: no-repeat;
    background-size: 5px 5px;
    color: var(--profiler-text);
    font: inherit;
    font-size: 11px;
    outline: none;
    appearance: none;
}

.proteum-profiler__select option {
    background: #000000;
    color: var(--profiler-text);
}

.proteum-profiler__panelBody {
    overflow: auto;
    padding: 0 14px 16px;
}

.proteum-profiler__metrics {
    display: grid;
    gap: 0;
    padding-top: 10px;
}

.proteum-profiler__metricRow {
    display: grid;
    grid-template-columns: minmax(104px, 140px) 1fr;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--profiler-line);
    align-items: start;
}

.proteum-profiler__metricRow:first-child {
    border-top: none;
}

.proteum-profiler__metricLabel {
    color: var(--profiler-muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__metricValue {
    font-size: 12px;
    line-height: 1.45;
    word-break: break-word;
}

.proteum-profiler__section {
    display: grid;
    gap: 8px;
    padding: 12px 0 0;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__sectionHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.proteum-profiler__actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.proteum-profiler__panelHeader .proteum-profiler__actions {
    flex: 0 0 auto;
    margin-left: auto;
}

.proteum-profiler__sectionTitle {
    font-size: 11px;
    font-weight: 700;
    color: var(--profiler-brand);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__list {
    display: grid;
    gap: 0;
}

.proteum-profiler__list > .proteum-profiler__row:first-child {
    border-top: none;
    padding-top: 2px;
}

.proteum-profiler__row {
    display: grid;
    gap: 4px;
    padding: 8px 0;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__row--interactive {
    width: 100%;
    appearance: none;
    background: transparent;
    border-inline: none;
    border-bottom: none;
    border-radius: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
}

.proteum-profiler__row--interactive:hover {
    background: var(--profiler-surface-hover);
}

.proteum-profiler__rowHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    line-height: 1.45;
}

.proteum-profiler__mono {
    font-family: inherit;
    font-size: 11px;
    line-height: 1.5;
}

.proteum-profiler__muted {
    color: var(--profiler-muted);
}

.proteum-profiler__pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    padding-top: 8px;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__detail {
    display: grid;
    gap: 10px;
    padding: 10px 0 14px;
    border-top: 1px dashed var(--profiler-line);
}

.proteum-profiler__detailLine {
    display: grid;
    gap: 4px;
}

.proteum-profiler__detailLabel {
    color: var(--profiler-muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.proteum-profiler__tag {
    display: inline-flex;
    align-items: center;
    min-height: 0;
    padding: 0;
    font-size: 11px;
    color: var(--profiler-muted);
}

.proteum-profiler__tag::before,
.proteum-profiler__tag::after {
    color: var(--profiler-line-strong);
}

.proteum-profiler__tag::before {
    content: '[';
}

.proteum-profiler__tag::after {
    content: ']';
}

.proteum-profiler__empty {
    padding: 12px 0;
    border-top: 1px dashed var(--profiler-line);
    color: var(--profiler-muted);
}

@media (max-width: 900px) {
    .proteum-profiler__panel {
        height: 50vh;
        max-height: 50vh;
        margin: 0;
        border-left: 0;
        border-right: 0;
        border-radius: 0;
    }

    .proteum-profiler__bar {
        padding-inline: 8px;
    }

    .proteum-profiler__panelHeader,
    .proteum-profiler__panelTabs,
    .proteum-profiler__panelBody {
        padding-inline: 10px;
    }

    .proteum-profiler__panelTabs {
        gap: 10px;
    }

    .proteum-profiler__metricRow {
        grid-template-columns: minmax(90px, 110px) 1fr;
    }

    .proteum-profiler__select {
        min-width: 132px;
    }
}
`;

type TSessionSummary = {
    apiAsyncCount: number;
    apiSyncCount: number;
    errorCount: number;
    primaryTrace?: TProfilerSessionTrace;
    renderMs?: number;
    routeLabel: string;
    ssrPayloadBytes?: number;
    statusLabel: string;
    totalMs?: number;
};
type TProfilerState = ReturnType<typeof profilerRuntime.getState>;

const panelLabels: Record<TProfilerPanel, string> = {
    summary: 'Summary',
    timeline: 'Timeline',
    auth: 'Auth',
    routing: 'Routing',
    controller: 'Controller',
    ssr: 'SSR',
    api: 'API',
    explain: 'Explain',
    doctor: 'Doctor',
    commands: 'Commands',
    cron: 'Cron',
    errors: 'Errors',
};

const getSelectedSession = (sessions: TProfilerNavigationSession[], selectedSessionId?: string, currentSessionId?: string) =>
    sessions.find((session) => session.id === selectedSessionId) ||
    sessions.find((session) => session.id === currentSessionId) ||
    sessions[sessions.length - 1];

const getSessionSelectorLabel = (session: TProfilerNavigationSession) => truncate(session.path || session.url || session.label, 56);
const truncate = (value: string, max = 96) => (value.length <= max ? value : `${value.slice(0, max)}...`);
const readNumber = (value: TTraceSummaryValue | undefined) => (typeof value === 'number' ? value : undefined);
const readString = (value: TTraceSummaryValue | undefined) => (typeof value === 'string' ? value : undefined);
const formatDuration = (value?: number) => (value === undefined ? 'pending' : `${Math.round(value)} ms`);
const formatBytes = (value?: number) => (value === undefined ? 'n/a' : `${(value / 1024).toFixed(value >= 1024 ? 1 : 2)} KB`);
const formatTimestamp = (value?: string) => {
    if (!value) return 'never';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
};
const formatCronFrequency = (task: TProfilerCronTask) =>
    task.frequency.kind === 'cron' ? task.frequency.value : `once at ${formatTimestamp(task.frequency.value)}`;
const formatStructuredValue = (value: unknown) => {
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
};

const renderSummaryValue = (value: TTraceSummaryValue | undefined): string => {
    if (value === undefined) return '';
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value.kind === 'undefined') return 'undefined';
    if (value.kind === 'redacted') return `[redacted: ${value.reason}]`;
    if (value.kind === 'error') return `${value.name}: ${value.message}`;
    if (value.kind === 'array') return `Array(${value.length})`;
    if (value.kind === 'object') return `${value.constructorName} { ${Object.keys(value.entries).join(', ')} }`;
    if (value.kind === 'buffer') return `Buffer(${value.byteLength})`;
    if ('value' in value) return String(value.value);
    if ('size' in value) return String(value.size);
    if ('name' in value) return value.name;
    return JSON.stringify(value);
};

const toSummaryJsonValue = (value: TTraceSummaryValue | undefined): unknown => {
    if (value === undefined) return 'undefined';
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value.kind === 'undefined') return 'undefined';
    if (value.kind === 'redacted') return `[redacted: ${value.reason}]`;
    if (value.kind === 'bigint') return `${value.value}n`;
    if (value.kind === 'symbol') return value.value;
    if (value.kind === 'function') return `[Function ${value.name}]`;
    if (value.kind === 'date') return value.value;
    if (value.kind === 'error') return { name: value.name, message: value.message, stack: value.stack };
    if (value.kind === 'buffer') return `[Buffer ${value.byteLength} bytes]`;
    if (value.kind === 'map') return `[Map(${value.size})]`;
    if (value.kind === 'set') return `[Set(${value.size})]`;
    if (value.kind === 'array') {
        const items = value.items.map((item) => toSummaryJsonValue(item));
        if (value.truncated) items.push(`... ${Math.max(0, value.length - value.items.length)} more item(s)`);
        return items;
    }

    const objectValue: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value.entries)) objectValue[key] = toSummaryJsonValue(entry);
    if (value.truncated) objectValue.__truncated = `${Math.max(0, value.keys.length - Object.keys(value.entries).length)} more key(s)`;
    return objectValue;
};

const formatSummaryJson = (value: TTraceSummaryValue | undefined) => {
    if (value === undefined) return 'undefined';
    if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'undefined') return 'undefined';
    return JSON.stringify(toSummaryJsonValue(value), null, 2);
};

const formatTraceEventDetailsJson = (details: Record<string, TTraceSummaryValue>) =>
    JSON.stringify(
        Object.fromEntries(Object.entries(details).map(([key, value]) => [key, toSummaryJsonValue(value)])),
        null,
        2,
    );

const formatSummaryLiteral = (value: TTraceSummaryValue | undefined, depth = 1): string => {
    if (value === undefined) return '';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (depth <= 0) return renderSummaryValue(value);
    if (value.kind === 'undefined') return 'undefined';
    if (value.kind === 'redacted') return `[redacted: ${value.reason}]`;
    if (value.kind === 'bigint') return `${value.value}n`;
    if (value.kind === 'symbol') return value.value;
    if (value.kind === 'function') return `[Function ${value.name}]`;
    if (value.kind === 'date') return JSON.stringify(value.value);
    if (value.kind === 'error') return `${value.name}(${JSON.stringify(value.message)})`;
    if (value.kind === 'buffer') return `Buffer(${value.byteLength})`;
    if (value.kind === 'map') return `Map(${value.size})`;
    if (value.kind === 'set') return `Set(${value.size})`;
    if (value.kind === 'array') {
        const items = value.items.slice(0, 4).map((item) => formatSummaryLiteral(item, depth - 1));
        if (value.truncated || value.length > items.length) items.push('...');
        return `[${items.join(', ')}]`;
    }

    const entries = Object.entries(value.entries)
        .slice(0, 4)
        .map(([key, entry]) => `${key}: ${formatSummaryLiteral(entry, depth - 1)}`);
    if (value.truncated || value.keys.length > entries.length) entries.push('...');
    return `{ ${entries.join(', ')} }`;
};

const getApiReferenceName = (method: string, path: string, fallbackLabel?: string) => {
    if (path.startsWith('/api/')) return path.slice('/api/'.length).split('/').filter(Boolean).join('.');

    const rawName = `${method} ${path}`.trim();
    if (rawName) return rawName;
    return fallbackLabel || 'request';
};

const formatApiReference = (method: string, path: string, requestData?: TTraceSummaryValue, fallbackLabel?: string) => {
    const args = formatSummaryLiteral(requestData, 1);
    return `${getApiReferenceName(method, path, fallbackLabel)}(${truncate(args, 112)})`;
};

const getTraceRequestData = (trace: TRequestTrace | undefined) =>
    trace?.events.find((event) => event.type === 'request.start')?.details.data;

const getTraceResultData = (trace: TRequestTrace | undefined) =>
    [...findTraceEvents(trace, ['controller.result'])]
        .reverse()
        .find((event) => event.details.kind === 'json' && event.details.data !== undefined)?.details.data;

const findTraceEvents = (trace: TRequestTrace | undefined, eventTypes: string[]) =>
    trace?.events.filter((event) => eventTypes.includes(event.type)) || [];

const authEventTypes: TTraceEventType[] = [
    'auth.decode',
    'auth.route',
    'auth.check.start',
    'auth.check.rule',
    'auth.check.result',
    'auth.session',
];

const getSummary = (session: TProfilerNavigationSession): TSessionSummary => {
    const primaryTrace =
        session.traces.find((trace) => trace.kind === 'initial-root' && trace.trace) ||
        session.traces.find((trace) => trace.kind === 'navigation-data' && trace.trace) ||
        session.traces.find((trace) => trace.trace);
    const trace = primaryTrace?.trace;
    const syncCalls = session.traces.flatMap((traceItem) =>
        traceItem.trace?.calls.filter((call) => call.origin === 'ssr-fetcher' || call.origin === 'api-batch-fetcher') || [],
    );
    const asyncCount = session.traces.filter((traceItem) => traceItem.kind === 'async').length;
    const errorCount =
        session.steps.filter((step) => step.status === 'error').length +
        session.traces.filter((traceItem) => traceItem.status === 'error').length +
        syncCalls.filter((call) => call.errorMessage || (call.statusCode !== undefined && call.statusCode >= 400)).length;
    const renderStart = trace?.events.find((event) => event.type === 'render.start');
    const renderEnd = trace?.events.find((event) => event.type === 'render.end');
    const localRender = [...session.steps].reverse().find((step) => step.label === 'Render' && step.durationMs !== undefined);
    const ssrPayload = trace?.events.find((event) => event.type === 'ssr.payload');
    const routeLabel = session.routeLabel || readString(renderStart?.details.routeId) || session.path;

    return {
        apiAsyncCount: asyncCount,
        apiSyncCount: syncCalls.length,
        errorCount,
        primaryTrace,
        renderMs:
            renderStart && renderEnd
                ? Math.max(0, renderEnd.elapsedMs - renderStart.elapsedMs)
                : localRender?.durationMs,
        routeLabel,
        ssrPayloadBytes: readNumber(ssrPayload?.details.serializedBytes),
        statusLabel: session.kind === 'client-navigation' ? 'NAV' : trace ? `${trace.statusCode || 'pending'} ${trace.method}` : 'SSR',
        totalMs: session.kind === 'client-navigation' ? session.durationMs : trace?.durationMs ?? session.durationMs,
    };
};

const StatusToken = ({ label, onClick, tone = 'ok' }: { label: string; onClick: () => void; tone?: 'ok' | 'warn' | 'error' }) => (
    <button className={`proteum-profiler__token proteum-profiler__token--${tone}`} onClick={onClick} type="button">
        {label}
    </button>
);

const SummaryRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="proteum-profiler__metricRow">
        <div className="proteum-profiler__metricLabel">{label}</div>
        <div className="proteum-profiler__metricValue">{value}</div>
    </div>
);

const ApiRequestEntry = ({
    durationMs,
    errorMessage,
    finishedAt,
    label,
    method,
    path,
    requestData,
    result,
    startedAt,
    statusCode,
    statusLabel,
    tags,
}: {
    durationMs?: number;
    errorMessage?: string;
    finishedAt?: string;
    label?: string;
    method: string;
    path: string;
    requestData?: TTraceSummaryValue;
    result?: TTraceSummaryValue;
    startedAt: string;
    statusCode?: number;
    statusLabel?: string;
    tags: string[];
}) => {
    const [isOpen, setOpen] = React.useState(false);
    const statusText = statusCode !== undefined ? String(statusCode) : statusLabel || 'pending';

    return (
        <>
            <button className="proteum-profiler__row proteum-profiler__row--interactive" onClick={() => setOpen((current) => !current)} type="button">
                <div className="proteum-profiler__rowHeader">
                    <strong>{formatApiReference(method, path, requestData, label)}</strong>
                    <span className="proteum-profiler__mono proteum-profiler__muted">
                        {formatDuration(durationMs)} | {statusText}
                    </span>
                </div>
                {method || path ? <div className="proteum-profiler__mono proteum-profiler__muted">{method} {path}</div> : null}
                <div className="proteum-profiler__tags">
                    {tags.map((tag) => (
                        <span className="proteum-profiler__tag" key={`${label || method}:${path}:${tag}`}>
                            {tag}
                        </span>
                    ))}
                    {errorMessage ? <span className="proteum-profiler__tag">{truncate(errorMessage, 72)}</span> : null}
                </div>
            </button>

            {isOpen ? (
                <div className="proteum-profiler__detail">
                    <div className="proteum-profiler__detailLine">
                        <div className="proteum-profiler__detailLabel">Performance</div>
                        <div className="proteum-profiler__mono">
                            duration={formatDuration(durationMs)} | status={statusText} | started={formatTimestamp(startedAt)}
                            {finishedAt ? ` | finished=${formatTimestamp(finishedAt)}` : ''}
                        </div>
                    </div>
                    <div className="proteum-profiler__detailLine">
                        <div className="proteum-profiler__detailLabel">Arguments</div>
                        <pre className="proteum-profiler__mono proteum-profiler__pre">{formatSummaryJson(requestData)}</pre>
                    </div>
                    <div className="proteum-profiler__detailLine">
                        <div className="proteum-profiler__detailLabel">Result</div>
                        <pre className="proteum-profiler__mono proteum-profiler__pre">{formatSummaryJson(result)}</pre>
                    </div>
                    {errorMessage ? (
                        <div className="proteum-profiler__detailLine">
                            <div className="proteum-profiler__detailLabel">Error</div>
                            <div className="proteum-profiler__mono">{errorMessage}</div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </>
    );
};

const TraceRows = ({ trace }: { trace: TRequestTrace }) => (
    <div className="proteum-profiler__section">
        <div className="proteum-profiler__sectionHeader">
            <div className="proteum-profiler__sectionTitle">
                {trace.method} {trace.path}
            </div>
            <div className="proteum-profiler__mono proteum-profiler__muted">{trace.id}</div>
        </div>

        {trace.calls.length > 0 && (
            <div className="proteum-profiler__list">
                {trace.calls.map((call) => (
                    <div className="proteum-profiler__row" key={call.id}>
                        <div className="proteum-profiler__rowHeader">
                            <strong>
                                {call.label} {call.method ? `(${call.method} ${call.path})` : ''}
                            </strong>
                            <span className="proteum-profiler__mono proteum-profiler__muted">
                                {formatDuration(call.durationMs)}
                                {call.statusCode !== undefined ? ` | ${call.statusCode}` : ''}
                            </span>
                        </div>
                        <div className="proteum-profiler__tags">
                            <span className="proteum-profiler__tag">{call.origin}</span>
                            {call.fetcherId ? <span className="proteum-profiler__tag">fetcher:{call.fetcherId}</span> : null}
                            {call.requestDataKeys.map((key) => (
                                <span className="proteum-profiler__tag" key={`${call.id}:req:${key}`}>
                                    req:{key}
                                </span>
                            ))}
                            {call.resultKeys.map((key) => (
                                <span className="proteum-profiler__tag" key={`${call.id}:res:${key}`}>
                                    res:{key}
                                </span>
                            ))}
                            {call.errorMessage ? <span className="proteum-profiler__tag">{truncate(call.errorMessage, 72)}</span> : null}
                        </div>
                    </div>
                ))}
            </div>
        )}

        <div className="proteum-profiler__list">
            {trace.events.map((event) => (
                <TraceEventEntry event={event} key={`${trace.id}:${event.index}`} traceId={trace.id} />
            ))}
        </div>
    </div>
);

const AuthTraceSection = ({
    label,
    trace,
}: {
    label: string;
    trace: TRequestTrace;
}) => {
    const authEvents = findTraceEvents(trace, authEventTypes);

    if (authEvents.length === 0) return null;

    return (
        <div className="proteum-profiler__section">
            <div className="proteum-profiler__sectionHeader">
                <div>
                    <div className="proteum-profiler__sectionTitle">{label}</div>
                    <div className="proteum-profiler__mono proteum-profiler__muted">
                        {trace.method} {trace.path}
                    </div>
                </div>
                <div className="proteum-profiler__actions">
                    <span className="proteum-profiler__tag">capture:{trace.capture}</span>
                    <span className="proteum-profiler__tag">events:{authEvents.length}</span>
                    {trace.statusCode !== undefined ? <span className="proteum-profiler__tag">status:{trace.statusCode}</span> : null}
                </div>
            </div>

            <div className="proteum-profiler__list">
                {authEvents.map((event) => (
                    <TraceEventEntry event={event} key={`${trace.id}:${event.index}`} traceId={trace.id} />
                ))}
            </div>
        </div>
    );
};

const TraceEventEntry = ({
    event,
    traceId,
}: {
    event: TRequestTrace['events'][number];
    traceId: string;
}) => {
    const [isOpen, setOpen] = React.useState(false);

    return (
        <>
            <button
                className="proteum-profiler__row proteum-profiler__row--interactive"
                onClick={() => setOpen((current) => !current)}
                type="button"
            >
                <div className="proteum-profiler__rowHeader">
                    <strong>{event.type}</strong>
                    <span className="proteum-profiler__mono proteum-profiler__muted">{formatDuration(event.elapsedMs)}</span>
                </div>
                <div className="proteum-profiler__tags">
                    {Object.entries(event.details).map(([key, value]) => (
                        <span className="proteum-profiler__tag" key={`${traceId}:${event.index}:${key}`}>
                            {key}:{truncate(renderSummaryValue(value), 72)}
                        </span>
                    ))}
                </div>
            </button>

            {isOpen ? (
                <div className="proteum-profiler__detail">
                    <div className="proteum-profiler__detailLine">
                        <div className="proteum-profiler__detailLabel">Timing</div>
                        <div className="proteum-profiler__mono">
                            elapsed={formatDuration(event.elapsedMs)} | at={formatTimestamp(event.at)}
                        </div>
                    </div>
                    <div className="proteum-profiler__detailLine">
                        <div className="proteum-profiler__detailLabel">Details</div>
                        <pre className="proteum-profiler__mono proteum-profiler__pre">
                            {formatTraceEventDetailsJson(event.details)}
                        </pre>
                    </div>
                </div>
            ) : null}
        </>
    );
};

const SimpleSection = ({ empty, rows, title }: { empty: string; rows: Array<{ key: string; title: string; value: string }>; title: string }) => (
    <div className="proteum-profiler__section">
        <div className="proteum-profiler__sectionTitle">{title}</div>
        {rows.length === 0 ? (
            <div className="proteum-profiler__empty">{empty}</div>
        ) : (
            <div className="proteum-profiler__list">
                {rows.map((row) => (
                    <div className="proteum-profiler__row" key={row.key}>
                        <div className="proteum-profiler__rowHeader">
                            <strong>{row.title}</strong>
                        </div>
                        <div className="proteum-profiler__mono">{row.value}</div>
                    </div>
                ))}
            </div>
        )}
    </div>
);

const TextBlocks = ({ blocks }: { blocks: THumanTextBlock[] }) => (
    <>
        {blocks.map((block) => (
            <div className="proteum-profiler__section" key={block.title}>
                <div className="proteum-profiler__sectionTitle">{block.title}</div>
                {block.items.length === 0 ? (
                    <div className="proteum-profiler__empty">{block.empty || 'none'}</div>
                ) : (
                    <div className="proteum-profiler__list">
                        {block.items.map((item, index) => (
                            <div className="proteum-profiler__row" key={`${block.title}:${index}`}>
                                <div className="proteum-profiler__mono">{item}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        ))}
    </>
);

const renderPanel = (panel: TProfilerPanel, session: TProfilerNavigationSession, summary: TSessionSummary, state: TProfilerState) => {
    const primaryTrace = summary.primaryTrace?.trace;

    if (panel === 'summary') {
        return (
            <div className="proteum-profiler__metrics">
                <SummaryRow label="Session" value={session.label} />
                <SummaryRow label="Status" value={summary.statusLabel} />
                <SummaryRow label="Duration" value={formatDuration(summary.totalMs)} />
                <SummaryRow label="Route" value={summary.routeLabel} />
                <SummaryRow
                    label="SSR"
                    value={
                        summary.ssrPayloadBytes !== undefined
                            ? `${formatDuration(summary.renderMs)} | ${formatBytes(summary.ssrPayloadBytes)}`
                            : formatDuration(summary.renderMs)
                    }
                />
                <SummaryRow label="API" value={`sync ${summary.apiSyncCount} / async ${summary.apiAsyncCount}`} />
                <SummaryRow label="Errors" value={String(summary.errorCount)} />
                <SummaryRow label="Request" value={session.requestId || 'client-only'} />
            </div>
        );
    }

    if (panel === 'timeline') {
        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionTitle">Navigation steps</div>
                <div className="proteum-profiler__list">
                    {session.steps.map((step) => (
                        <div className="proteum-profiler__row" key={step.id}>
                            <div className="proteum-profiler__rowHeader">
                                <strong>{step.label}</strong>
                                <span className="proteum-profiler__mono proteum-profiler__muted">{formatDuration(step.durationMs)}</span>
                            </div>
                            <div className="proteum-profiler__tags">
                                <span className="proteum-profiler__tag">{step.status}</span>
                                {Object.entries(step.details || {}).map(([key, value]) => (
                                    <span className="proteum-profiler__tag" key={`${step.id}:${key}`}>
                                        {key}:{String(value)}
                                    </span>
                                ))}
                                {step.errorMessage ? <span className="proteum-profiler__tag">{truncate(step.errorMessage, 72)}</span> : null}
                            </div>
                        </div>
                    ))}
                </div>

                {session.traces.map((trace) =>
                    trace.trace ? (
                        <TraceRows key={trace.id} trace={trace.trace} />
                    ) : (
                        <div className="proteum-profiler__row" key={trace.id}>
                            <div className="proteum-profiler__rowHeader">
                                <strong>{trace.label}</strong>
                                <span className="proteum-profiler__mono proteum-profiler__muted">{trace.status}</span>
                            </div>
                            <div className="proteum-profiler__mono">{trace.method} {trace.path}</div>
                        </div>
                    ),
                )}
            </div>
        );
    }

    if (panel === 'auth') {
        const authSections = session.traces.flatMap((traceItem) =>
            traceItem.trace && findTraceEvents(traceItem.trace, authEventTypes).length > 0
                ? [{ id: traceItem.id, label: traceItem.label, trace: traceItem.trace }]
                : [],
        );

        return authSections.length === 0 ? (
            <div className="proteum-profiler__empty">No auth activity was captured for this session.</div>
        ) : (
            <div>
                {authSections.map((traceItem) => (
                    <AuthTraceSection key={traceItem.id} label={traceItem.label} trace={traceItem.trace} />
                ))}
            </div>
        );
    }

    if (panel === 'routing') {
        return (
            <SimpleSection
                empty="No routing data captured yet."
                rows={findTraceEvents(primaryTrace, [
                    'resolve.start',
                    'resolve.controller-route',
                    'resolve.route-match',
                    'resolve.routes-evaluated',
                    'resolve.not-found',
                ]).map((event) => ({
                    key: `${event.index}:${event.type}`,
                    title: event.type,
                    value: Object.entries(event.details)
                        .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                        .join(' '),
                }))}
                title="Routing"
            />
        );
    }

    if (panel === 'controller') {
        return (
            <SimpleSection
                empty="No controller data captured yet."
                rows={findTraceEvents(primaryTrace, ['controller.start', 'controller.result', 'setup.options', 'context.create']).map(
                    (event) => ({
                        key: `${event.index}:${event.type}`,
                        title: event.type,
                        value: Object.entries(event.details)
                            .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                            .join(' '),
                    }),
                )}
                title="Controller"
            />
        );
    }

    if (panel === 'ssr') {
        return (
            <SimpleSection
                empty="No SSR data captured for this session."
                rows={findTraceEvents(primaryTrace, ['page.data', 'ssr.payload', 'render.start', 'render.end']).map((event) => ({
                    key: `${event.index}:${event.type}`,
                    title: event.type,
                    value: Object.entries(event.details)
                        .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                        .join(' '),
                }))}
                title="SSR"
            />
        );
    }

    if (panel === 'api') {
        const syncCalls = session.traces.flatMap((trace) =>
            trace.trace?.calls.filter((call) => call.origin !== 'client-async') || [],
        );
        const asyncTraces = session.traces.filter((trace) => trace.kind === 'async');

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionTitle">Synchronous calls</div>
                {syncCalls.length === 0 ? (
                    <div className="proteum-profiler__empty">No synchronous SSR or batched API calls captured.</div>
                ) : (
                    <div className="proteum-profiler__list">
                        {syncCalls.map((call: TTraceCall) => (
                            <ApiRequestEntry
                                durationMs={call.durationMs}
                                errorMessage={call.errorMessage}
                                finishedAt={call.finishedAt}
                                key={call.id}
                                label={call.label}
                                method={call.method}
                                path={call.path}
                                requestData={call.requestData}
                                result={call.result}
                                startedAt={call.startedAt}
                                statusCode={call.statusCode}
                                tags={[
                                    call.origin,
                                    ...(call.fetcherId ? [`fetcher:${call.fetcherId}`] : []),
                                    ...call.requestDataKeys.map((key) => `arg:${key}`),
                                    ...call.resultKeys.map((key) => `res:${key}`),
                                ]}
                            />
                        ))}
                    </div>
                )}

                <div className="proteum-profiler__sectionTitle">Async requests</div>
                {asyncTraces.length === 0 ? (
                    <div className="proteum-profiler__empty">No async API calls captured.</div>
                ) : (
                    <div className="proteum-profiler__list">
                        {asyncTraces.map((trace) => (
                            <ApiRequestEntry
                                durationMs={trace.durationMs}
                                errorMessage={trace.errorMessage || trace.trace?.errorMessage}
                                finishedAt={trace.finishedAt}
                                key={trace.id}
                                label={trace.label}
                                method={trace.method}
                                path={trace.path}
                                requestData={getTraceRequestData(trace.trace)}
                                result={getTraceResultData(trace.trace)}
                                startedAt={trace.startedAt}
                                statusCode={trace.trace?.statusCode}
                                statusLabel={trace.status}
                                tags={[trace.status, ...(trace.requestId ? [`request:${trace.requestId}`] : [])]}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (panel === 'explain') {
        const explain = state.explain;
        const blocks = explain.manifest
            ? [
                  { title: 'Overview', items: buildExplainSummaryItems(explain.manifest) },
                  ...buildExplainBlocks(explain.manifest, [...explainSectionNames]),
              ]
            : [];

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionHeader">
                    <div className="proteum-profiler__sectionTitle">Explain</div>
                    <div className="proteum-profiler__actions">
                        <button className="proteum-profiler__pill" onClick={() => void profilerRuntime.refreshExplain()} type="button">
                            Refresh
                        </button>
                    </div>
                </div>

                {explain.errorMessage ? (
                    <div className="proteum-profiler__row">
                        <div className="proteum-profiler__rowHeader">
                            <strong>Last explain panel error</strong>
                        </div>
                        <div className="proteum-profiler__mono">{explain.errorMessage}</div>
                    </div>
                ) : null}

                {explain.status === 'loading' && !explain.manifest ? (
                    <div className="proteum-profiler__empty">Loading explain data...</div>
                ) : !explain.manifest ? (
                    <div className="proteum-profiler__empty">No explain manifest is available.</div>
                ) : (
                    <>
                        <div className="proteum-profiler__row">
                            <div className="proteum-profiler__rowHeader">
                                <strong>Manifest snapshot</strong>
                                <span className="proteum-profiler__mono proteum-profiler__muted">
                                    {explain.lastLoadedAt ? formatTimestamp(explain.lastLoadedAt) : 'Not loaded'}
                                </span>
                            </div>
                            <div className="proteum-profiler__mono">
                                Same manifest-backed sections as `proteum explain`, rendered from the shared diagnostics contract.
                            </div>
                        </div>
                        <TextBlocks blocks={blocks} />
                    </>
                )}
            </div>
        );
    }

    if (panel === 'doctor') {
        const doctor = state.doctor;
        const doctorRows =
            doctor.response?.diagnostics.map((diagnostic, index) => ({
                key: `${diagnostic.code}:${index}`,
                title: `[${diagnostic.level}] ${diagnostic.code}`,
                value: `${diagnostic.message} source=${diagnostic.filepath}${formatManifestLocation(
                    diagnostic.sourceLocation?.line,
                    diagnostic.sourceLocation?.column,
                )}${diagnostic.relatedFilepaths?.length ? ` related=${diagnostic.relatedFilepaths.join(',')}` : ''}`,
            })) || [];
        const doctorBlocks = state.explain.manifest ? buildDoctorBlocks(state.explain.manifest) : [];

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionHeader">
                    <div className="proteum-profiler__sectionTitle">Doctor</div>
                    <div className="proteum-profiler__actions">
                        <button className="proteum-profiler__pill" onClick={() => void profilerRuntime.refreshDoctor()} type="button">
                            Refresh
                        </button>
                    </div>
                </div>

                {doctor.errorMessage ? (
                    <div className="proteum-profiler__row">
                        <div className="proteum-profiler__rowHeader">
                            <strong>Last doctor panel error</strong>
                        </div>
                        <div className="proteum-profiler__mono">{doctor.errorMessage}</div>
                    </div>
                ) : null}

                {doctor.status === 'loading' && !doctor.response ? (
                    <div className="proteum-profiler__empty">Loading doctor diagnostics...</div>
                ) : !doctor.response ? (
                    <div className="proteum-profiler__empty">No doctor diagnostics are available.</div>
                ) : (
                    <>
                        <div className="proteum-profiler__metrics">
                            <SummaryRow label="Errors" value={String(doctor.response.summary.errors)} />
                            <SummaryRow label="Warnings" value={String(doctor.response.summary.warnings)} />
                            <SummaryRow label="Strict" value={doctor.response.summary.strictFailed ? 'failed' : 'ok'} />
                            <SummaryRow
                                label="Refreshed"
                                value={doctor.lastLoadedAt ? formatTimestamp(doctor.lastLoadedAt) : 'Not loaded'}
                            />
                        </div>
                        {doctorBlocks.length > 0 ? (
                            <TextBlocks blocks={doctorBlocks} />
                        ) : (
                            <SimpleSection empty="No manifest diagnostics were found." rows={doctorRows} title="Diagnostics" />
                        )}
                    </>
                )}
            </div>
        );
    }

    if (panel === 'commands') {
        const commandsState = state.commands;

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionHeader">
                    <div className="proteum-profiler__sectionTitle">Available commands</div>
                    <div className="proteum-profiler__actions">
                        <button className="proteum-profiler__pill" onClick={() => void profilerRuntime.refreshCommands()} type="button">
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="proteum-profiler__row">
                    <div className="proteum-profiler__rowHeader">
                        <strong>Dev commands</strong>
                        <span className="proteum-profiler__mono proteum-profiler__muted">
                            {commandsState.commands.length} command{commandsState.commands.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    <div className="proteum-profiler__mono">
                        Commands live under /commands, extend the Proteum Commands class, and run only in a dev context.
                    </div>
                </div>

                {commandsState.errorMessage ? (
                    <div className="proteum-profiler__row">
                        <div className="proteum-profiler__rowHeader">
                            <strong>Last command panel error</strong>
                        </div>
                        <div className="proteum-profiler__mono">{commandsState.errorMessage}</div>
                    </div>
                ) : null}

                {commandsState.status === 'loading' && commandsState.commands.length === 0 ? (
                    <div className="proteum-profiler__empty">Loading commands...</div>
                ) : commandsState.commands.length === 0 ? (
                    <div className="proteum-profiler__empty">No commands are registered for this app.</div>
                ) : (
                    <div className="proteum-profiler__list">
                        {commandsState.commands.map((command: TDevCommandDefinition) => {
                            const execution = commandsState.executions[command.path] as TDevCommandExecution | undefined;
                            return (
                                <div className="proteum-profiler__row" key={command.path}>
                                    <div className="proteum-profiler__rowHeader">
                                        <strong>{command.path}</strong>
                                        <div className="proteum-profiler__actions">
                                            <span className="proteum-profiler__mono proteum-profiler__muted">
                                                {execution ? formatTimestamp(execution.finishedAt) : 'Never run'}
                                            </span>
                                            <button
                                                className="proteum-profiler__pill"
                                                onClick={() => void profilerRuntime.runCommand(command.path)}
                                                type="button"
                                            >
                                                Run now
                                            </button>
                                        </div>
                                    </div>

                                    <div className="proteum-profiler__tags">
                                        <span className="proteum-profiler__tag">{command.className}</span>
                                        <span className="proteum-profiler__tag">{command.methodName}</span>
                                        <span className="proteum-profiler__tag">{command.scope}</span>
                                        {execution ? <span className="proteum-profiler__tag">{execution.status}</span> : null}
                                        {execution ? (
                                            <span className="proteum-profiler__tag">{formatDuration(execution.durationMs)}</span>
                                        ) : null}
                                        {execution?.errorMessage ? (
                                            <span className="proteum-profiler__tag">{truncate(execution.errorMessage, 72)}</span>
                                        ) : null}
                                    </div>

                                    <div className="proteum-profiler__mono proteum-profiler__muted">
                                        source {command.filepath}:{command.sourceLocation.line}:{command.sourceLocation.column}
                                        {commandsState.lastLoadedAt
                                            ? ` | refreshed ${formatTimestamp(commandsState.lastLoadedAt)}`
                                            : ''}
                                    </div>

                                    {execution ? (
                                        <div className="proteum-profiler__section">
                                            <div className="proteum-profiler__sectionTitle">Last result</div>
                                            <pre className="proteum-profiler__mono proteum-profiler__pre">
                                                {execution.result?.json !== undefined
                                                    ? formatStructuredValue(execution.result.json)
                                                    : execution.result
                                                      ? formatStructuredValue(execution.result.summary)
                                                      : execution.errorMessage || 'undefined'}
                                            </pre>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    if (panel === 'cron') {
        const cron = state.cron;

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionHeader">
                    <div className="proteum-profiler__sectionTitle">Registered tasks</div>
                    <div className="proteum-profiler__actions">
                        <button className="proteum-profiler__pill" onClick={() => void profilerRuntime.refreshCronTasks()} type="button">
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="proteum-profiler__row">
                    <div className="proteum-profiler__rowHeader">
                        <strong>Dev mode</strong>
                        <span className="proteum-profiler__mono proteum-profiler__muted">
                            {cron.tasks.length} task{cron.tasks.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    <div className="proteum-profiler__mono">
                        Automatic execution is disabled in dev. Registered cron tasks stay visible here and only run when
                        triggered manually.
                    </div>
                </div>

                {cron.errorMessage ? (
                    <div className="proteum-profiler__row">
                        <div className="proteum-profiler__rowHeader">
                            <strong>Last cron panel error</strong>
                        </div>
                        <div className="proteum-profiler__mono">{cron.errorMessage}</div>
                    </div>
                ) : null}

                {cron.status === 'loading' && cron.tasks.length === 0 ? (
                    <div className="proteum-profiler__empty">Loading cron tasks...</div>
                ) : cron.tasks.length === 0 ? (
                    <div className="proteum-profiler__empty">No cron tasks are registered for this app.</div>
                ) : (
                    <div className="proteum-profiler__list">
                        {cron.tasks.map((task) => (
                            <div className="proteum-profiler__row" key={task.name}>
                                <div className="proteum-profiler__rowHeader">
                                    <strong>{task.name}</strong>
                                    <div className="proteum-profiler__actions">
                                        <span className="proteum-profiler__mono proteum-profiler__muted">
                                            {task.running
                                                ? 'Running...'
                                                : task.lastRunFinishedAt
                                                  ? formatTimestamp(task.lastRunFinishedAt)
                                                  : 'Never run'}
                                        </span>
                                        <button
                                            className="proteum-profiler__pill"
                                            disabled={task.running}
                                            onClick={() => void profilerRuntime.runCronTask(task.name)}
                                            type="button"
                                        >
                                            {task.running ? 'Running...' : 'Run now'}
                                        </button>
                                    </div>
                                </div>

                                <div className="proteum-profiler__tags">
                                    <span className="proteum-profiler__tag">schedule:{truncate(formatCronFrequency(task), 64)}</span>
                                    <span className="proteum-profiler__tag">
                                        next:{task.nextInvocation ? formatTimestamp(task.nextInvocation) : 'none'}
                                    </span>
                                    <span className="proteum-profiler__tag">autoexec:{task.autoexec ? 'yes' : 'no'}</span>
                                    <span className="proteum-profiler__tag">
                                        automatic:{task.automaticExecution ? 'enabled' : 'disabled in dev'}
                                    </span>
                                    <span className="proteum-profiler__tag">runs:{task.runCount}</span>
                                    {task.lastTrigger ? <span className="proteum-profiler__tag">trigger:{task.lastTrigger}</span> : null}
                                    {task.lastRunStatus ? <span className="proteum-profiler__tag">{task.lastRunStatus}</span> : null}
                                    {task.lastRunDurationMs !== undefined ? (
                                        <span className="proteum-profiler__tag">{formatDuration(task.lastRunDurationMs)}</span>
                                    ) : null}
                                    {task.lastErrorMessage ? (
                                        <span className="proteum-profiler__tag">{truncate(task.lastErrorMessage, 72)}</span>
                                    ) : null}
                                </div>

                                <div className="proteum-profiler__mono proteum-profiler__muted">
                                    registered {formatTimestamp(task.registeredAt)}
                                    {cron.lastLoadedAt ? ` | refreshed ${formatTimestamp(cron.lastLoadedAt)}` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const errorRows = [
        ...session.steps
            .filter((step) => step.status === 'error')
            .map((step) => ({ key: step.id, title: step.label, value: step.errorMessage || 'Step failed' })),
        ...session.traces
            .filter((trace) => trace.status === 'error')
            .map((trace) => ({ key: trace.id, title: trace.label, value: trace.errorMessage || 'Request failed' })),
        ...findTraceEvents(primaryTrace, ['error']).map((event) => ({
            key: `${event.index}:error`,
            title: event.type,
            value: Object.entries(event.details)
                .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                .join(' '),
        })),
    ];

    return <SimpleSection empty="No errors captured." rows={errorRows} title="Errors" />;
};

export default function DevProfiler() {
    const [state, setState] = React.useState(() => profilerRuntime.getState());

    React.useEffect(() => profilerRuntime.subscribe(() => setState(profilerRuntime.getState())), []);
    React.useEffect(() => {
        void profilerRuntime.refreshCommands();
        void profilerRuntime.refreshCronTasks();
    }, []);

    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && profilerRuntime.getState().uiState === 'expanded') {
                profilerRuntime.setUiState('minimized');
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    if (!window.dev) return null;

    const session = getSelectedSession(state.sessions, state.selectedSessionId, state.currentSessionId);
    if (!session) return null;

    const summary = getSummary(session);
    const tone = summary.errorCount > 0 ? 'error' : (summary.totalMs || 0) > 500 ? 'warn' : 'ok';
    const primaryTrace = summary.primaryTrace?.trace;
    const minimizedLabel =
        session.kind === 'client-navigation'
            ? session.label
            : primaryTrace
              ? `${primaryTrace.statusCode || 'pending'} ${primaryTrace.method} ${primaryTrace.path}`
              : session.label;
    const recentSessions = state.sessions.slice(-6).reverse();

    return (
        <div className="proteum-profiler">
            <style dangerouslySetInnerHTML={{ __html: profilerStyles }} />

            {state.uiState === 'pinned-handle' ? (
                <button
                    className="proteum-profiler__handle"
                    onClick={() => profilerRuntime.setUiState('minimized')}
                    type="button"
                >
                    Proteum Profiler
                </button>
            ) : (
                <>
                    {state.uiState === 'expanded' ? (
                        <div className="proteum-profiler__panel">
                            <div className="proteum-profiler__panelHeader">
                                <select
                                    aria-label="Profiler path selector"
                                    className="proteum-profiler__select"
                                    onChange={(event) => profilerRuntime.selectSession(event.currentTarget.value)}
                                    value={session.id}
                                >
                                    {recentSessions.map((recentSession) => (
                                        <option key={recentSession.id} value={recentSession.id}>
                                            {getSessionSelectorLabel(recentSession)}
                                        </option>
                                    ))}
                                </select>

                                <div className="proteum-profiler__panelTabs">
                                    {(Object.keys(panelLabels) as TProfilerPanel[]).map((panel) => (
                                        <button
                                            className={`proteum-profiler__pill ${
                                                state.activePanel === panel ? 'proteum-profiler__pill--active' : ''
                                            }`}
                                            key={panel}
                                            onClick={() => profilerRuntime.openPanel(panel)}
                                            type="button"
                                        >
                                            {panelLabels[panel]}
                                        </button>
                                    ))}
                                </div>

                                <div className="proteum-profiler__actions">
                                    <button className="proteum-profiler__pill" onClick={() => profilerRuntime.setUiState('minimized')} type="button">
                                        Collapse
                                    </button>
                                    <button className="proteum-profiler__pill" onClick={() => profilerRuntime.setUiState('pinned-handle')} type="button">
                                        Hide
                                    </button>
                                </div>
                            </div>

                            <div className="proteum-profiler__panelBody">{renderPanel(state.activePanel, session, summary, state)}</div>
                        </div>
                    ) : null}

                    <div className="proteum-profiler__bar">
                        <button
                            className="proteum-profiler__token proteum-profiler__token--brand"
                            onClick={() => profilerRuntime.openPanel('summary')}
                            type="button"
                        >
                            Proteum
                        </button>
                        <StatusToken label={truncate(minimizedLabel, 56)} onClick={() => profilerRuntime.openPanel('summary')} tone={tone} />
                        <StatusToken
                            label={formatDuration(summary.totalMs)}
                            onClick={() => profilerRuntime.openPanel('summary')}
                            tone={tone}
                        />
                        <StatusToken
                            label={truncate(summary.routeLabel, 28)}
                            onClick={() => profilerRuntime.openPanel('routing')}
                            tone="ok"
                        />
                        <StatusToken
                            label={
                                summary.ssrPayloadBytes !== undefined
                                    ? `${formatDuration(summary.renderMs)} ${formatBytes(summary.ssrPayloadBytes)}`
                                    : formatDuration(summary.renderMs)
                            }
                            onClick={() => profilerRuntime.openPanel('ssr')}
                            tone="ok"
                        />
                        <StatusToken
                            label={`API ${summary.apiSyncCount} / ${summary.apiAsyncCount}`}
                            onClick={() => profilerRuntime.openPanel('api')}
                            tone={summary.apiAsyncCount > 0 || summary.apiSyncCount > 0 ? 'ok' : 'warn'}
                        />
                        {summary.errorCount > 0 ? (
                            <StatusToken
                                label={`${summary.errorCount} error${summary.errorCount === 1 ? '' : 's'}`}
                                onClick={() => profilerRuntime.openPanel('errors')}
                                tone="error"
                            />
                        ) : null}
                        <div className="proteum-profiler__spacer" />
                        <button className="proteum-profiler__token" onClick={() => profilerRuntime.setUiState('pinned-handle')} type="button">
                            Hide
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
