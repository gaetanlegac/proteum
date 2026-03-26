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
    --profiler-bg: #f3f5f8;
    --profiler-bg-strong: #ffffff;
    --profiler-bg-soft: #eef3f8;
    --profiler-surface-hover: #eef4ff;
    --profiler-surface-selected: #e1ecff;
    --profiler-line: rgba(19, 32, 51, 0.1);
    --profiler-line-strong: rgba(19, 32, 51, 0.18);
    --profiler-text: #132033;
    --profiler-muted: #627186;
    --profiler-brand: #175fe6;
    --profiler-ok: #15803d;
    --profiler-warn: #b45309;
    --profiler-error: #b91c1c;
    --profiler-title-row-bg: #f1f3f5;
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
    background: var(--profiler-bg-strong);
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
    background: var(--profiler-bg-strong);
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
    background: var(--profiler-bg-strong);
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
    background: var(--profiler-bg-strong);
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
    border-radius: 0;
    background-color: var(--profiler-bg-strong);
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
    background: var(--profiler-bg-strong);
    color: var(--profiler-text);
}

.proteum-profiler__panelBody {
    overflow: auto;
    height: 100%;
    min-height: 0;
    padding: 0;
    background: transparent;
}

.proteum-profiler__metrics {
    display: grid;
    gap: 0;
    padding: 10px 12px 0;
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
    gap: 0;
    padding: 0;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__sectionHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: var(--profiler-title-row-bg);
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

.proteum-profiler__row {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--profiler-line);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
}

.proteum-profiler__row--interactive {
    width: 100%;
    appearance: none;
    background: transparent;
    border: none;
    text-align: left;
    color: inherit;
    cursor: pointer;
}

.proteum-profiler__row--interactive:hover {
    background: var(--profiler-surface-hover);
}

.proteum-profiler__row--selected {
    background: var(--profiler-surface-selected);
}

.proteum-profiler__rowHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    line-height: 1.45;
}

.proteum-profiler__rowTitle {
    min-width: 0;
    word-break: break-word;
}

.proteum-profiler__rowMeta {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-left: auto;
    white-space: nowrap;
}

.proteum-profiler__statusBadge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 18px;
    padding: 0 8px;
    border: 1px solid currentColor;
    color: var(--profiler-muted);
    background: transparent;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__statusBadge--ok {
    color: var(--profiler-ok);
}

.proteum-profiler__statusBadge--warn {
    color: var(--profiler-warn);
}

.proteum-profiler__statusBadge--error {
    color: var(--profiler-error);
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
    padding: 10px 0 0;
    border: none;
    border-top: 1px solid var(--profiler-line);
    border-radius: 0;
    background: transparent;
}

.proteum-profiler__jsonKey {
    color: var(--profiler-brand);
}

.proteum-profiler__jsonString {
    color: #0f766e;
}

.proteum-profiler__jsonNumber {
    color: #b45309;
}

.proteum-profiler__jsonLiteral {
    color: var(--profiler-error);
}

.proteum-profiler__detail {
    display: grid;
    gap: 10px;
    padding: 10px 0 0;
    border: none;
    border-top: 1px solid var(--profiler-line);
    border-radius: 0;
    background: transparent;
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
    padding: 12px;
    border-top: 1px solid var(--profiler-line);
    color: var(--profiler-muted);
}

.proteum-profiler__requestWorkspace {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 420px);
    gap: 0;
    align-items: stretch;
    min-height: 100%;
    height: 100%;
}

.proteum-profiler__splitView {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 420px);
    gap: 0;
    align-items: stretch;
    min-height: 100%;
    height: 100%;
}

.proteum-profiler__splitView--stacked {
    min-height: 0;
    height: auto;
}

.proteum-profiler__splitColumn {
    display: grid;
    gap: 0;
    min-width: 0;
    align-content: start;
}

.proteum-profiler__requestGroups {
    display: grid;
    gap: 0;
    min-width: 0;
}

.proteum-profiler__requestGroup {
    display: grid;
    gap: 0;
}

.proteum-profiler__requestGroupHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: var(--profiler-title-row-bg);
}

.proteum-profiler__requestGroupCount {
    color: var(--profiler-muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__sidebar {
    position: sticky;
    top: 0;
    display: flex;
    align-self: stretch;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: none;
    border-left: 1px solid var(--profiler-line);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
}

.proteum-profiler__sidebarScroller {
    display: grid;
    flex: 1 1 auto;
    gap: 0;
    align-content: start;
    height: 100%;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
}

.proteum-profiler__titleRow {
    padding: 8px 10px;
    background: var(--profiler-title-row-bg);
}

.proteum-profiler__sidebarHeader {
    display: grid;
    gap: 6px;
    padding: 10px 12px 0;
}

.proteum-profiler__sidebarEyebrow,
.proteum-profiler__sidebarSectionTitle {
    color: var(--profiler-muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.proteum-profiler__sidebarTitle {
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;
}

.proteum-profiler__sidebarSection {
    display: grid;
    gap: 6px;
    padding: 10px 12px 0;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__sidebarScroller > .proteum-profiler__metrics {
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__sidebarEmpty {
    font-size: 12px;
    color: var(--profiler-muted);
}

.proteum-profiler__timelineChart {
    display: grid;
    gap: 0;
}

.proteum-profiler__timelineChartMeta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px 0;
}

.proteum-profiler__timelineChartCanvas {
    position: relative;
    padding: 8px 12px 12px;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__timelineChartCanvas > * {
    height: 100%;
}

.proteum-profiler__timelineChartCanvas canvas {
    display: block;
    width: 100%;
    height: 100%;
}

.proteum-profiler__timelineChartCanvas .apexcharts-canvas,
.proteum-profiler__timelineChartCanvas .apexcharts-svg {
    background: transparent !important;
}

.proteum-profiler__traceEventRow {
    --profiler-trace-depth: 0;
    --profiler-trace-guide-opacity: 0;
    --profiler-trace-indent: calc(var(--profiler-trace-depth) * 18px);
}

.proteum-profiler__traceEventRow .proteum-profiler__rowHeader,
.proteum-profiler__traceEventRow .proteum-profiler__tags {
    padding-inline-start: var(--profiler-trace-indent);
}

.proteum-profiler__traceEventRow .proteum-profiler__rowHeader {
    position: relative;
}

.proteum-profiler__traceEventRow .proteum-profiler__rowHeader::before {
    content: '';
    position: absolute;
    left: max(0px, calc(var(--profiler-trace-indent) - 8px));
    top: 3px;
    bottom: 3px;
    width: 1px;
    background: var(--profiler-line-strong);
    opacity: var(--profiler-trace-guide-opacity);
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

    .proteum-profiler__requestWorkspace {
        grid-template-columns: 1fr;
        min-height: 0;
        height: auto;
    }

    .proteum-profiler__splitView {
        grid-template-columns: 1fr;
        min-height: 0;
        height: auto;
    }

    .proteum-profiler__sidebar {
        position: static;
        height: auto;
        min-height: 0;
        border-left: none;
        border-top: 1px solid var(--profiler-line);
    }

    .proteum-profiler__sidebarScroller {
        height: auto;
        max-height: none;
        min-height: 0;
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
type TApiRequestItem = {
    id: string;
    groupLabel: string;
    durationMs?: number;
    errorMessage?: string;
    finishedAt?: string;
    label?: string;
    method: string;
    path: string;
    requestData?: TTraceSummaryValue;
    requestDataJson?: unknown;
    result?: TTraceSummaryValue;
    resultJson?: unknown;
    startedAt: string;
    statusCode?: number;
    statusLabel?: string;
    tags: string[];
};
type TWaterfallChartItem = {
    barLabel: string;
    color: string;
    detailLines: string[];
    endOffsetMs: number;
    id: string;
    startOffsetMs: number;
    subtitle?: string;
    title: string;
};
type TProfilerState = ReturnType<typeof profilerRuntime.getState>;

const panelLabels: Record<TProfilerPanel, string> = {
    summary: 'Summary',
    timeline: 'Timeline',
    routing: 'Routing',
    auth: 'Auth',
    controller: 'Controller',
    ssr: 'SSR',
    api: 'API',
    errors: 'Errors',
    explain: 'Explain',
    doctor: 'Doctor',
    commands: 'Commands',
    cron: 'Cron',
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

const formatApiPanelJson = (jsonValue: unknown, summaryValue: TTraceSummaryValue | undefined) =>
    jsonValue !== undefined ? formatStructuredValue(jsonValue) : formatSummaryJson(summaryValue);

const formatTraceEventDetailsJson = (details: Record<string, TTraceSummaryValue>) =>
    JSON.stringify(
        Object.fromEntries(Object.entries(details).map(([key, value]) => [key, toSummaryJsonValue(value)])),
        null,
        2,
    );

const renderHighlightedJson = (value: string) => {
    const tokenPattern =
        /"(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(value))) {
        const index = match.index;
        const token = match[0];

        if (index > lastIndex) parts.push(value.slice(lastIndex, index));

        const trailing = value.slice(index + token.length);
        const isKey = token.startsWith('"') && /^\s*:/.test(trailing);
        const className = token.startsWith('"')
            ? isKey
                ? 'proteum-profiler__jsonKey'
                : 'proteum-profiler__jsonString'
            : token === 'true' || token === 'false' || token === 'null'
              ? 'proteum-profiler__jsonLiteral'
              : 'proteum-profiler__jsonNumber';

        parts.push(
            <span className={className} key={`json:${index}`}>
                {token}
            </span>,
        );
        lastIndex = index + token.length;
    }

    if (lastIndex < value.length) parts.push(value.slice(lastIndex));

    return parts;
};

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

const formatProfilerRequestReference = ({
    fallbackLabel,
    method,
    path,
    requestData,
}: {
    fallbackLabel?: string;
    method?: string;
    path?: string;
    requestData?: TTraceSummaryValue;
}) => {
    const safeMethod = method || '';
    const safePath = path || '';

    if (safePath.startsWith('/api/')) return formatApiReference(safeMethod, safePath, requestData, fallbackLabel);

    const rawReference = `${safeMethod} ${safePath}`.trim();
    return rawReference || fallbackLabel || 'request';
};

const getTraceRequestData = (trace: TRequestTrace | undefined) =>
    trace?.events.find((event) => event.type === 'request.start')?.details.data;

const getTraceResultData = (trace: TRequestTrace | undefined) =>
    [...findTraceEvents(trace, ['controller.result'])]
        .reverse()
        .find((event) => event.details.kind === 'json' && event.details.data !== undefined)?.details.data;

const getRequestStatusText = (statusCode?: number, statusLabel?: string) =>
    statusCode !== undefined ? String(statusCode) : statusLabel || 'pending';

const getRequestStatusTone = (statusCode?: number, statusLabel?: string): 'ok' | 'warn' | 'error' => {
    if (statusCode === undefined) return statusLabel === 'pending' ? 'warn' : 'ok';
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'error';
    if (statusCode >= 300) return 'warn';
    return 'ok';
};

const findTraceEvents = (trace: TRequestTrace | undefined, eventTypes: string[]) =>
    trace?.events.filter((event) => eventTypes.includes(event.type)) || [];

const traceEventDepths: Record<TTraceEventType, number> = {
    'request.start': 0,
    'request.user': 1,
    'auth.decode': 1,
    'auth.route': 1,
    'auth.check.start': 2,
    'auth.check.rule': 3,
    'auth.check.result': 2,
    'auth.session': 1,
    'resolve.start': 1,
    'resolve.controller-route': 2,
    'resolve.routes-evaluated': 1,
    'resolve.route-skip': 2,
    'resolve.route-match': 2,
    'resolve.not-found': 1,
    'controller.start': 2,
    'controller.result': 2,
    'setup.options': 3,
    'context.create': 3,
    'page.data': 3,
    'ssr.payload': 3,
    'render.start': 2,
    'render.end': 2,
    'response.send': 1,
    'request.finish': 0,
    error: 0,
};

const getTraceEventDepth = (event: TRequestTrace['events'][number]) => traceEventDepths[event.type] ?? 0;

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

const JsonCodeBlock = ({ value }: { value: string }) => (
    <pre className="proteum-profiler__mono proteum-profiler__pre">{renderHighlightedJson(value)}</pre>
);

const formatTraceCallDisplay = (call: TTraceCall) => {
    if (call.path.startsWith('/api/')) {
        return formatProfilerRequestReference({
            fallbackLabel: call.label,
            method: call.method,
            path: call.path,
            requestData: call.requestData,
        });
    }

    const rawReference = `${call.method} ${call.path}`.trim();
    if (call.label && rawReference) return `${call.label} (${rawReference})`;
    return call.label || rawReference || 'request';
};

const formatSessionTraceDisplay = (traceItem: TProfilerSessionTrace) => {
    if (traceItem.path.startsWith('/api/')) {
        return formatProfilerRequestReference({
            fallbackLabel: traceItem.label,
            method: traceItem.method,
            path: traceItem.path,
            requestData: getTraceRequestData(traceItem.trace),
        });
    }

    return traceItem.label || formatProfilerRequestReference({ method: traceItem.method, path: traceItem.path });
};

const ApiRequestListEntry = ({
    isSelected,
    item,
    onSelect,
}: {
    isSelected: boolean;
    item: TApiRequestItem;
    onSelect: () => void;
}) => {
    const statusText = getRequestStatusText(item.statusCode, item.statusLabel);
    const statusTone = getRequestStatusTone(item.statusCode, item.statusLabel);

    return (
        <button
            aria-pressed={isSelected}
            className={`proteum-profiler__row proteum-profiler__row--interactive ${isSelected ? 'proteum-profiler__row--selected' : ''}`}
            onClick={onSelect}
            type="button"
        >
            <div className="proteum-profiler__rowHeader">
                <strong className="proteum-profiler__rowTitle">
                    {formatApiReference(item.method, item.path, item.requestData, item.label)}
                </strong>
                <span className="proteum-profiler__rowMeta">
                    <span className="proteum-profiler__mono proteum-profiler__muted">{formatDuration(item.durationMs)}</span>
                    <span className={`proteum-profiler__statusBadge proteum-profiler__statusBadge--${statusTone}`}>{statusText}</span>
                </span>
            </div>
        </button>
    );
};

const ApiRequestSidebar = ({ item }: { item?: TApiRequestItem }) => {
    if (!item) {
        return (
            <aside className="proteum-profiler__sidebar">
                <div className="proteum-profiler__sidebarScroller">
                    <div className="proteum-profiler__sidebarHeader">
                        <div className="proteum-profiler__sidebarEyebrow">Request details</div>
                        <div className="proteum-profiler__sidebarEmpty">
                            Select a request to inspect its payload, result, and timing.
                        </div>
                    </div>
                </div>
            </aside>
        );
    }

    const statusText = getRequestStatusText(item.statusCode, item.statusLabel);

    return (
        <aside className="proteum-profiler__sidebar">
            <div className="proteum-profiler__sidebarScroller">
                <div className="proteum-profiler__sidebarHeader">
                    <div className="proteum-profiler__sidebarEyebrow">{item.groupLabel}</div>
                    <div className="proteum-profiler__sidebarTitle">
                        <strong>{formatApiReference(item.method, item.path, item.requestData, item.label)}</strong>
                    </div>
                    <div className="proteum-profiler__mono proteum-profiler__muted">
                        {formatProfilerRequestReference({
                            fallbackLabel: item.label,
                            method: item.method,
                            path: item.path,
                            requestData: item.requestData,
                        })}
                    </div>
                </div>

                <div className="proteum-profiler__metrics">
                    <SummaryRow label="Status" value={statusText} />
                    <SummaryRow label="Duration" value={formatDuration(item.durationMs)} />
                    <SummaryRow label="Started" value={formatTimestamp(item.startedAt)} />
                    <SummaryRow label="Finished" value={item.finishedAt ? formatTimestamp(item.finishedAt) : 'pending'} />
                    <SummaryRow
                        label="Endpoint"
                        value={formatProfilerRequestReference({
                            fallbackLabel: item.label,
                            method: item.method,
                            path: item.path,
                            requestData: item.requestData,
                        })}
                    />
                </div>

                {item.tags.length > 0 ? (
                    <div className="proteum-profiler__sidebarSection">
                        <div className="proteum-profiler__sidebarSectionTitle">Tags</div>
                        <div className="proteum-profiler__tags">
                            {item.tags.map((tag) => (
                                <span className="proteum-profiler__tag" key={`${item.id}:detail:${tag}`}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className="proteum-profiler__sidebarSection">
                    <div className="proteum-profiler__sidebarSectionTitle">Arguments</div>
                    <JsonCodeBlock value={formatApiPanelJson(item.requestDataJson, item.requestData)} />
                </div>

                <div className="proteum-profiler__sidebarSection">
                    <div className="proteum-profiler__sidebarSectionTitle">Result</div>
                    <JsonCodeBlock value={formatApiPanelJson(item.resultJson, item.result)} />
                </div>

                {item.errorMessage ? (
                    <div className="proteum-profiler__sidebarSection">
                        <div className="proteum-profiler__sidebarSectionTitle">Error</div>
                        <div className="proteum-profiler__mono">{item.errorMessage}</div>
                    </div>
                ) : null}
            </div>
        </aside>
    );
};

const ApiPanel = ({ session }: { session: TProfilerNavigationSession }) => {
    const syncItems: TApiRequestItem[] = session.traces
        .flatMap((trace) => trace.trace?.calls.filter((call) => call.origin !== 'client-async') || [])
        .map((call: TTraceCall) => ({
            id: call.id,
            groupLabel: 'Synchronous call',
            durationMs: call.durationMs,
            errorMessage: call.errorMessage,
            finishedAt: call.finishedAt,
            label: call.label,
            method: call.method,
            path: call.path,
            requestData: call.requestData,
            requestDataJson: call.requestDataJson,
            result: call.result,
            resultJson: call.resultJson,
            startedAt: call.startedAt,
            statusCode: call.statusCode,
            tags: [
                call.origin,
                ...(call.fetcherId ? [`fetcher:${call.fetcherId}`] : []),
                ...call.requestDataKeys.map((key) => `arg:${key}`),
                ...call.resultKeys.map((key) => `res:${key}`),
            ],
        }));
    const asyncItems: TApiRequestItem[] = session.traces
        .filter((trace) => trace.kind === 'async')
        .map((trace) => ({
            id: trace.id,
            groupLabel: 'Async request',
            durationMs: trace.durationMs,
            errorMessage: trace.errorMessage || trace.trace?.errorMessage,
            finishedAt: trace.finishedAt,
            label: trace.label,
            method: trace.method,
            path: trace.path,
            requestData: getTraceRequestData(trace.trace),
            requestDataJson: trace.trace?.requestDataJson,
            result: getTraceResultData(trace.trace),
            resultJson: trace.trace?.resultJson,
            startedAt: trace.startedAt,
            statusCode: trace.trace?.statusCode,
            statusLabel: trace.status,
            tags: [trace.status, ...(trace.requestId ? [`request:${trace.requestId}`] : [])],
        }));
    const requestItems = [...syncItems, ...asyncItems];
    const [selectedRequestId, setSelectedRequestId] = React.useState<string | undefined>(() => requestItems[0]?.id);

    React.useEffect(() => {
        if (requestItems.some((item) => item.id === selectedRequestId)) return;
        setSelectedRequestId(requestItems[0]?.id);
    }, [requestItems, selectedRequestId]);

    const waterfallItems = buildApiWaterfallItems(requestItems);
    const selectedItem = requestItems.find((item) => item.id === selectedRequestId) || requestItems[0];

    return (
        <div className="proteum-profiler__requestWorkspace">
            <div className="proteum-profiler__splitColumn">
                <WaterfallChart
                    emptyLabel="No API requests were captured for this session."
                    itemLabel="request"
                    items={waterfallItems}
                    onSelect={setSelectedRequestId}
                />

                <div className="proteum-profiler__requestGroups">
                    <div className="proteum-profiler__requestGroup">
                        <div className="proteum-profiler__requestGroupHeader">
                            <div className="proteum-profiler__sectionTitle">Synchronous calls</div>
                            <div className="proteum-profiler__requestGroupCount">
                                {syncItems.length} item{syncItems.length === 1 ? '' : 's'}
                            </div>
                        </div>

                        {syncItems.length === 0 ? (
                            <div className="proteum-profiler__empty">No synchronous SSR or batched API calls captured.</div>
                        ) : (
                            <div className="proteum-profiler__list">
                                {syncItems.map((item) => (
                                    <ApiRequestListEntry
                                        isSelected={item.id === selectedItem?.id}
                                        item={item}
                                        key={item.id}
                                        onSelect={() => setSelectedRequestId(item.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="proteum-profiler__requestGroup">
                        <div className="proteum-profiler__requestGroupHeader">
                            <div className="proteum-profiler__sectionTitle">Async requests</div>
                            <div className="proteum-profiler__requestGroupCount">
                                {asyncItems.length} item{asyncItems.length === 1 ? '' : 's'}
                            </div>
                        </div>

                        {asyncItems.length === 0 ? (
                            <div className="proteum-profiler__empty">No async API calls captured.</div>
                        ) : (
                            <div className="proteum-profiler__list">
                                {asyncItems.map((item) => (
                                    <ApiRequestListEntry
                                        isSelected={item.id === selectedItem?.id}
                                        item={item}
                                        key={item.id}
                                        onSelect={() => setSelectedRequestId(item.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ApiRequestSidebar item={selectedItem} />
        </div>
    );
};

const getTraceEventKey = (traceId: string, event: TRequestTrace['events'][number]) => `${traceId}:${event.index}`;

const TraceEventSidebar = ({
    event,
    label,
    trace,
}: {
    event?: TRequestTrace['events'][number];
    label: string;
    trace?: TRequestTrace;
}) => {
    const detailEntries = Object.entries(event?.details || {});

    if (!event) {
        return (
            <aside className="proteum-profiler__sidebar">
                <div className="proteum-profiler__sidebarScroller">
                    <div className="proteum-profiler__sidebarHeader">
                        <div className="proteum-profiler__sidebarEyebrow">{label}</div>
                        <div className="proteum-profiler__sidebarEmpty">Select an event to inspect its timing and payload.</div>
                    </div>
                </div>
            </aside>
        );
    }

    return (
        <aside className="proteum-profiler__sidebar">
            <div className="proteum-profiler__sidebarScroller">
                <div className="proteum-profiler__sidebarHeader">
                    <div className="proteum-profiler__sidebarEyebrow">{label}</div>
                    <div className="proteum-profiler__sidebarTitle">
                        <strong>{event.type}</strong>
                    </div>
                    {trace ? (
                        <div className="proteum-profiler__mono proteum-profiler__muted">
                            {formatProfilerRequestReference({
                                method: trace.method,
                                path: trace.path,
                                requestData: getTraceRequestData(trace),
                            })}
                        </div>
                    ) : null}
                </div>

                <div className="proteum-profiler__metrics">
                    <SummaryRow label="Elapsed" value={formatDuration(event.elapsedMs)} />
                    <SummaryRow label="Captured" value={formatTimestamp(event.at)} />
                    <SummaryRow label="Trace" value={trace?.id || 'n/a'} />
                </div>

                {detailEntries.length > 0 ? (
                    <div className="proteum-profiler__sidebarSection">
                        <div className="proteum-profiler__sidebarSectionTitle">Summary</div>
                        <div>
                            {detailEntries.map(([key, value]) => (
                                <SummaryRow
                                    key={`${trace?.id || 'trace'}:${event.index}:detail:${key}`}
                                    label={key}
                                    value={<span className="proteum-profiler__mono">{truncate(renderSummaryValue(value), 120)}</span>}
                                />
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className="proteum-profiler__sidebarSection">
                    <div className="proteum-profiler__sidebarSectionTitle">Raw JSON</div>
                    <JsonCodeBlock value={formatTraceEventDetailsJson(event.details)} />
                </div>
            </div>
        </aside>
    );
};

const TraceRows = ({
    onSelect,
    selectedEventKey,
    trace,
}: {
    onSelect: (selectionKey: string) => void;
    selectedEventKey?: string;
    trace: TRequestTrace;
}) => (
    <div className="proteum-profiler__section">
        <div className="proteum-profiler__sectionHeader">
            <div className="proteum-profiler__sectionTitle">
                {formatProfilerRequestReference({
                    method: trace.method,
                    path: trace.path,
                    requestData: getTraceRequestData(trace),
                })}
            </div>
            <div className="proteum-profiler__mono proteum-profiler__muted">{trace.id}</div>
        </div>

        {trace.calls.length > 0 && (
            <div className="proteum-profiler__list">
                {trace.calls.map((call) => (
                    <div className="proteum-profiler__row" key={call.id}>
                        <div className="proteum-profiler__rowHeader">
                            <strong>{formatTraceCallDisplay(call)}</strong>
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
            {trace.events.map((event) => {
                const selectionKey = getTraceEventKey(trace.id, event);

                return (
                    <TraceEventEntry
                        event={event}
                        isSelected={selectionKey === selectedEventKey}
                        key={selectionKey}
                        onSelect={() => onSelect(selectionKey)}
                        traceId={trace.id}
                    />
                );
            })}
        </div>
    </div>
);

const AuthTraceSection = ({
    authEvents,
    label,
    onSelect,
    selectedEventKey,
    trace,
}: {
    authEvents: TRequestTrace['events'];
    label: string;
    onSelect: (selectionKey: string) => void;
    selectedEventKey?: string;
    trace: TRequestTrace;
}) => (
    <div className="proteum-profiler__section">
        <div className="proteum-profiler__sectionHeader">
            <div>
                <div className="proteum-profiler__sectionTitle">{label}</div>
                <div className="proteum-profiler__mono proteum-profiler__muted">
                    {formatProfilerRequestReference({
                        method: trace.method,
                        path: trace.path,
                        requestData: getTraceRequestData(trace),
                    })}
                </div>
            </div>
            <div className="proteum-profiler__actions">
                <span className="proteum-profiler__tag">capture:{trace.capture}</span>
                <span className="proteum-profiler__tag">events:{authEvents.length}</span>
                {trace.statusCode !== undefined ? <span className="proteum-profiler__tag">status:{trace.statusCode}</span> : null}
            </div>
        </div>

        <div className="proteum-profiler__list">
            {authEvents.map((event) => {
                const selectionKey = getTraceEventKey(trace.id, event);

                return (
                    <TraceEventEntry
                        event={event}
                        isSelected={selectionKey === selectedEventKey}
                        key={selectionKey}
                        onSelect={() => onSelect(selectionKey)}
                        traceId={trace.id}
                    />
                );
            })}
        </div>
    </div>
);

const TraceEventEntry = ({
    event,
    isSelected,
    onSelect,
    traceId,
}: {
    event: TRequestTrace['events'][number];
    isSelected: boolean;
    onSelect: () => void;
    traceId: string;
}) => {
    const depth = getTraceEventDepth(event);

    return (
        <button
            aria-pressed={isSelected}
            className={`proteum-profiler__row proteum-profiler__row--interactive proteum-profiler__traceEventRow ${isSelected ? 'proteum-profiler__row--selected' : ''}`}
            onClick={onSelect}
            style={
                {
                    '--profiler-trace-depth': depth,
                    '--profiler-trace-guide-opacity': depth > 0 ? 1 : 0,
                } as React.CSSProperties
            }
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
    );
};

type TTraceEventInspectorSelection = {
    event: TRequestTrace['events'][number];
    key: string;
    label: string;
    trace: TRequestTrace;
};

const readDateMs = (value?: string) => {
    if (!value) return undefined;
    const ms = new Date(value).valueOf();
    return Number.isFinite(ms) ? ms : undefined;
};

const getTimelineDurationColor = (durationMs?: number) => {
    if (durationMs === undefined) return '#93c5fd';
    if (durationMs >= 800) return '#ef4444';
    if (durationMs >= 450) return '#f97316';
    if (durationMs >= 220) return '#f59e0b';
    if (durationMs >= 100) return '#3b82f6';
    return '#22c55e';
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const timelineWaterfallMinDurationMs = 6;
const waterfallBarHeight = 15;
const waterfallRowGap = 1;
const waterfallRowHeight = waterfallBarHeight + waterfallRowGap;

const buildWaterfallEndMs = ({ durationMs, fallbackEndMs, finishedAt, startMs }: {
    durationMs?: number;
    fallbackEndMs?: number;
    finishedAt?: string;
    startMs: number;
}) => {
    const finishedMs = readDateMs(finishedAt);
    const durationEndMs = durationMs !== undefined ? startMs + Math.max(durationMs, 1) : undefined;
    return Math.max(startMs + 1, fallbackEndMs ?? finishedMs ?? durationEndMs ?? startMs + 1);
};

const buildTimelineWaterfallItems = (session: TProfilerNavigationSession): TWaterfallChartItem[] => {
    const sessionStartMs = readDateMs(session.startedAt) ?? 0;
    const rawItems = session.traces.flatMap((traceItem) => {
        const trace = traceItem.trace;
        if (!trace) return [];

        const traceStartMs = readDateMs(trace.startedAt) ?? sessionStartMs;
        const traceFinishedMs = readDateMs(trace.finishedAt) ?? (trace.durationMs !== undefined ? traceStartMs + trace.durationMs : undefined);
        const traceLabel = formatSessionTraceDisplay(traceItem);

        return trace.events.map((event, index) => {
            const nextEvent = trace.events[index + 1];
            const startMs = readDateMs(event.at) ?? traceStartMs + event.elapsedMs;
            const nextStartMs = nextEvent ? readDateMs(nextEvent.at) ?? traceStartMs + nextEvent.elapsedMs : undefined;
            const endMs = buildWaterfallEndMs({
                fallbackEndMs: nextStartMs ?? traceFinishedMs,
                startMs,
            });

            return {
                durationMs: Math.max(1, endMs - startMs),
                endMs,
                event,
                startMs,
                trace,
                traceLabel,
            };
        });
    });

    const sortedItems = [...rawItems].sort((left, right) => left.startMs - right.startMs || left.event.index - right.event.index);
    const chartStartMs = sortedItems.length > 0 ? Math.min(...sortedItems.map((item) => item.startMs)) : 0;

    return sortedItems
        .filter((item) => item.durationMs >= timelineWaterfallMinDurationMs)
        .map((item) => {
            const startOffsetMs = item.startMs - chartStartMs;
            const endOffsetMs = item.endMs - chartStartMs;

            return {
                barLabel: truncate(`${item.event.type} | ${item.traceLabel}`, 84),
                color: getTimelineDurationColor(item.durationMs),
                detailLines: [
                    `Start: +${Math.round(startOffsetMs)} ms`,
                    `End: +${Math.round(endOffsetMs)} ms`,
                    `Span: ${formatDuration(item.durationMs)}`,
                ],
                endOffsetMs,
                id: getTraceEventKey(item.trace.id, item.event),
                startOffsetMs,
                subtitle: item.traceLabel,
                title: item.event.type,
            };
        });
};

const buildApiWaterfallItems = (requestItems: TApiRequestItem[]): TWaterfallChartItem[] => {
    const rawItems = requestItems.map((item) => {
        const startMs = readDateMs(item.startedAt) ?? 0;
        const endMs = buildWaterfallEndMs({
            durationMs: item.durationMs,
            finishedAt: item.finishedAt,
            startMs,
        });
        const statusText = getRequestStatusText(item.statusCode, item.statusLabel);
        const reference = formatApiReference(item.method, item.path, item.requestData, item.label);

        return {
            endMs,
            item,
            reference,
            startMs,
            statusText,
        };
    });

    const sortedItems = [...rawItems].sort((left, right) => left.startMs - right.startMs || left.reference.localeCompare(right.reference));
    const chartStartMs = sortedItems.length > 0 ? Math.min(...sortedItems.map((item) => item.startMs)) : 0;

    return sortedItems.map(({ endMs, item, reference, startMs, statusText }) => {
        const startOffsetMs = startMs - chartStartMs;
        const endOffsetMs = endMs - chartStartMs;

        return {
            barLabel: truncate(reference, 84),
            color: getTimelineDurationColor(item.durationMs),
            detailLines: [
                `Status: ${statusText}`,
                `Duration: ${formatDuration(item.durationMs)}`,
                `Start: +${Math.round(startOffsetMs)} ms`,
                `End: +${Math.round(endOffsetMs)} ms`,
            ],
            endOffsetMs,
            id: item.id,
            startOffsetMs,
            subtitle: item.groupLabel,
            title: reference,
        };
    });
};

const WaterfallChart = ({
    emptyLabel,
    itemLabel,
    items,
    onSelect,
}: {
    emptyLabel: string;
    itemLabel: string;
    items: TWaterfallChartItem[];
    onSelect?: (itemId: string) => void;
}) => {
    const [ApexChartComponent, setApexChartComponent] = React.useState<unknown>(null);

    React.useEffect(() => {
        let isDisposed = false;

        void import('react-apexcharts').then((module) => {
            if (isDisposed) return;
            setApexChartComponent(() => module.default);
        });

        return () => {
            isDisposed = true;
        };
    }, []);

    const totalDurationMs = Math.max(items.length > 0 ? Math.max(...items.map((item) => item.endOffsetMs)) : 1, 1);
    const chartHeight = Math.max(260, items.length * waterfallRowHeight + 24);
    const ChartComponent = ApexChartComponent as any;

    const series = [
        {
            data: items.map((item) => ({
                fillColor: item.color,
                x: item.barLabel,
                y: [item.startOffsetMs, item.endOffsetMs],
            })),
            name: itemLabel,
        },
    ];

    const options = {
        chart: {
            animations: { enabled: false },
            background: 'transparent',
            events: onSelect
                ? {
                      dataPointSelection: (
                          _event: unknown,
                          _chartContext: unknown,
                          config: { dataPointIndex: number },
                      ) => {
                          const item = items[config.dataPointIndex];
                          if (item) onSelect(item.id);
                      },
                  }
                : undefined,
            foreColor: '#627186',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            toolbar: { show: false },
            type: 'rangeBar',
            zoom: { enabled: false },
        },
        dataLabels: {
            enabled: false,
        },
        fill: {
            opacity: 1,
        },
        grid: {
            borderColor: 'rgba(19, 32, 51, 0.08)',
            padding: { bottom: 0, left: 0, right: 0, top: 4 },
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: false } },
        },
        legend: {
            show: false,
        },
        noData: {
            style: {
                color: '#627186',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                fontSize: '11px',
            },
            text: emptyLabel,
        },
        plotOptions: {
            bar: {
                barHeight: waterfallBarHeight,
                borderRadius: 2,
                horizontal: true,
                rangeBarGroupRows: false,
            },
        },
        stroke: {
            colors: ['#ffffff'],
            width: 1,
        },
        tooltip: {
            custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
                const item = items[dataPointIndex];
                if (!item) return '';

                return `
                    <div style="padding:8px 10px; color:#132033; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace; font-size:11px; line-height:1.5;">
                        <div style="font-weight:700;">${escapeHtml(item.title)}</div>
                        ${item.subtitle ? `<div style="color:#627186;">${escapeHtml(item.subtitle)}</div>` : ''}
                        ${item.detailLines
                            .map(
                                (line, index) =>
                                    `<div style="${index === 0 ? 'margin-top:6px;' : ''} color:#627186;">${escapeHtml(line)}</div>`,
                            )
                            .join('')}
                    </div>
                `;
            },
        },
        xaxis: {
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: {
                formatter: (value: string | number) => `${Math.round(Number(value))} ms`,
                style: {
                    colors: '#627186',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                    fontSize: '10px',
                },
            },
            max: totalDurationMs,
            min: 0,
            tickAmount: Math.min(6, Math.max(2, items.length > 0 ? 6 : 2)),
            type: 'numeric',
        },
        yaxis: {
            show: false,
            labels: {
                show: false,
            },
        },
    };

    return (
        <div className="proteum-profiler__section">
            <div className="proteum-profiler__timelineChart">
                <div className="proteum-profiler__timelineChartMeta">
                    <span className="proteum-profiler__mono proteum-profiler__muted">
                        {items.length} {itemLabel}
                        {items.length === 1 ? '' : 's'}
                    </span>
                    <span className="proteum-profiler__mono proteum-profiler__muted">{formatDuration(totalDurationMs)}</span>
                </div>

                <div className="proteum-profiler__timelineChartCanvas" style={{ height: `${chartHeight}px` }}>
                    {ChartComponent && items.length > 0 ? (
                        <ChartComponent height={chartHeight} options={options} series={series} type="rangeBar" width="100%" />
                    ) : items.length > 0 ? (
                        <div className="proteum-profiler__empty">Loading waterfall chart...</div>
                    ) : (
                        <div className="proteum-profiler__empty">{emptyLabel}</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const TimelinePanel = ({ session }: { session: TProfilerNavigationSession }) => {
    const selections: TTraceEventInspectorSelection[] = session.traces.flatMap((traceItem) =>
        traceItem.trace
            ? traceItem.trace.events.map((event) => ({
                  event,
                  key: getTraceEventKey(traceItem.trace!.id, event),
                  label: formatSessionTraceDisplay(traceItem),
                  trace: traceItem.trace!,
              }))
            : [],
    );
    const [selectedEventKey, setSelectedEventKey] = React.useState<string | undefined>(() => selections[0]?.key);

    React.useEffect(() => {
        if (selections.some((selection) => selection.key === selectedEventKey)) return;
        setSelectedEventKey(selections[0]?.key);
    }, [selectedEventKey, selections]);

    const waterfallItems = buildTimelineWaterfallItems(session);
    const selected = selections.find((selection) => selection.key === selectedEventKey) || selections[0];

    return (
        <div className="proteum-profiler__splitView">
            <div className="proteum-profiler__splitColumn">
                <WaterfallChart
                    emptyLabel="No timeline events were captured for this session."
                    itemLabel="event"
                    items={waterfallItems}
                    onSelect={setSelectedEventKey}
                />

                <div className="proteum-profiler__section">
                    <div className="proteum-profiler__titleRow">
                        <div className="proteum-profiler__sectionTitle">Navigation steps</div>
                    </div>
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
                </div>

                {session.traces.map((traceItem) =>
                    traceItem.trace ? (
                        <TraceRows
                            key={traceItem.id}
                            onSelect={setSelectedEventKey}
                            selectedEventKey={selectedEventKey}
                            trace={traceItem.trace}
                        />
                    ) : (
                        <div className="proteum-profiler__row" key={traceItem.id}>
                        <div className="proteum-profiler__rowHeader">
                                <strong>{formatSessionTraceDisplay(traceItem)}</strong>
                                <span className="proteum-profiler__mono proteum-profiler__muted">{traceItem.status}</span>
                            </div>
                            <div className="proteum-profiler__mono">
                                {formatProfilerRequestReference({
                                    fallbackLabel: traceItem.label,
                                    method: traceItem.method,
                                    path: traceItem.path,
                                    requestData: getTraceRequestData(traceItem.trace),
                                })}
                            </div>
                        </div>
                    ),
                )}
            </div>

            <TraceEventSidebar event={selected?.event} label={selected?.label || 'Trace event'} trace={selected?.trace} />
        </div>
    );
};

const AuthPanel = ({ session }: { session: TProfilerNavigationSession }) => {
    const authSections = session.traces.flatMap((traceItem) => {
        const authEvents = traceItem.trace ? findTraceEvents(traceItem.trace, authEventTypes) : [];
        return traceItem.trace && authEvents.length > 0
            ? [{ authEvents, id: traceItem.id, label: formatSessionTraceDisplay(traceItem), trace: traceItem.trace }]
            : [];
    });
    const selections: TTraceEventInspectorSelection[] = authSections.flatMap((section) =>
        section.authEvents.map((event) => ({
            event,
            key: getTraceEventKey(section.trace.id, event),
            label: `${section.label} event`,
            trace: section.trace,
        })),
    );
    const [selectedEventKey, setSelectedEventKey] = React.useState<string | undefined>(() => selections[0]?.key);

    React.useEffect(() => {
        if (selections.some((selection) => selection.key === selectedEventKey)) return;
        setSelectedEventKey(selections[0]?.key);
    }, [selectedEventKey, selections]);

    if (authSections.length === 0) return <div className="proteum-profiler__empty">No auth activity was captured for this session.</div>;

    const selected = selections.find((selection) => selection.key === selectedEventKey) || selections[0];

    return (
        <div className="proteum-profiler__splitView">
            <div className="proteum-profiler__splitColumn">
                {authSections.map((section) => (
                    <AuthTraceSection
                        authEvents={section.authEvents}
                        key={section.id}
                        label={section.label}
                        onSelect={setSelectedEventKey}
                        selectedEventKey={selectedEventKey}
                        trace={section.trace}
                    />
                ))}
            </div>

            <TraceEventSidebar event={selected?.event} label={selected?.label || 'Auth event'} trace={selected?.trace} />
        </div>
    );
};

const SimpleSection = ({
    empty,
    rows,
    showTitle = true,
    title,
}: {
    empty: string;
    rows: Array<{ key: string; title: string; value: string }>;
    showTitle?: boolean;
    title: string;
}) => (
    <div className="proteum-profiler__section">
        {showTitle ? (
            <div className="proteum-profiler__titleRow">
                <div className="proteum-profiler__sectionTitle">{title}</div>
            </div>
        ) : null}
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
                <div className="proteum-profiler__titleRow">
                    <div className="proteum-profiler__sectionTitle">{block.title}</div>
                </div>
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
        return <TimelinePanel session={session} />;
    }

    if (panel === 'auth') {
        return <AuthPanel session={session} />;
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
                showTitle={false}
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
                showTitle={false}
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
                showTitle={false}
                title="SSR"
            />
        );
    }

    if (panel === 'api') {
        return <ApiPanel session={session} />;
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
                                            <JsonCodeBlock
                                                value={
                                                    execution.result?.json !== undefined
                                                        ? formatStructuredValue(execution.result.json)
                                                        : execution.result
                                                          ? formatStructuredValue(execution.result.summary)
                                                          : execution.errorMessage || 'undefined'
                                                }
                                            />
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

    return <SimpleSection empty="No errors captured." rows={errorRows} showTitle={false} title="Errors" />;
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
              ? `${primaryTrace.statusCode || 'pending'} ${formatProfilerRequestReference({
                    method: primaryTrace.method,
                    path: primaryTrace.path,
                    requestData: getTraceRequestData(primaryTrace),
                })}`
              : session.label;
    const recentSessions: TProfilerNavigationSession[] = state.sessions.slice(-6).reverse();

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
