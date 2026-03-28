import React from 'react';
import type { ApexOptions } from 'apexcharts';

import {
    buildDoctorBlocks,
    buildExplainBlocks,
    buildExplainSummaryItems,
    explainSectionNames,
    formatManifestLocation,
    type THumanTextBlock,
} from '@common/dev/diagnostics';
import type { TDevCommandDefinition, TDevCommandExecution } from '@common/dev/commands';
import { summarizeTraceForDiagnose, type TExplainOwnerMatch } from '@common/dev/inspection';
import {
    buildRequestPerformance,
    perfGroupByValues,
    perfWindowPresets,
    type TRequestPerformance,
} from '@common/dev/performance';
import type {
    TProfilerCronTask,
    TProfilerNavigationSession,
    TProfilerPanel,
    TProfilerSessionTrace,
} from '@common/dev/profiler';
import type { TRequestTrace, TTraceCall, TTraceEventType, TTraceSqlQuery, TTraceSummaryValue } from '@common/dev/requestTrace';

import { profilerRuntime } from './runtime';
import ApexChart from './ApexChart';

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

.proteum-profiler__panelBody--split {
    overflow: hidden;
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
    max-height: 100%;
}

.proteum-profiler__splitView {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 420px);
    gap: 0;
    align-items: stretch;
    min-height: 100%;
    height: 100%;
    max-height: 100%;
}

.proteum-profiler__splitView--stacked {
    min-height: 0;
    height: auto;
}

.proteum-profiler__splitColumn {
    display: grid;
    gap: 0;
    min-width: 0;
    min-height: 0;
    height: 100%;
    align-content: start;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
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
    overflow: hidden;
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

.proteum-profiler__chartGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    border-top: 1px solid var(--profiler-line);
}

.proteum-profiler__chartCard {
    display: grid;
    align-content: start;
    min-width: 0;
    border-top: 1px solid var(--profiler-line);
    border-left: 1px solid var(--profiler-line);
}

.proteum-profiler__chartCard:nth-child(2n + 1) {
    border-left: none;
}

.proteum-profiler__chartHeader {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
    background: var(--profiler-title-row-bg);
}

.proteum-profiler__chartSubtitle {
    color: var(--profiler-muted);
    font-size: 11px;
    line-height: 1.5;
}

.proteum-profiler__chartMount {
    min-width: 0;
    padding: 8px 8px 2px;
    background: transparent;
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

    .proteum-profiler__panelBody--split {
        overflow: auto;
    }

    .proteum-profiler__chartGrid {
        grid-template-columns: 1fr;
    }

    .proteum-profiler__chartCard {
        border-left: none;
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
        max-height: none;
    }

    .proteum-profiler__splitView {
        grid-template-columns: 1fr;
        min-height: 0;
        height: auto;
        max-height: none;
    }

    .proteum-profiler__splitColumn {
        height: auto;
        overflow: visible;
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
    sqlCount: number;
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
    originLabel?: string;
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
type TSqlQueryItem = {
    callerLabel: string;
    durationMs: number;
    finishedAt: string;
    id: string;
    kind: TTraceSqlQuery['kind'];
    model?: string;
    operation: string;
    paramsJson?: unknown;
    paramsText?: string;
    query: string;
    startedAt: string;
    tags: string[];
    target?: string;
};
type TSqlQueryGroup = {
    id: string;
    items: TSqlQueryItem[];
    label: string;
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
    perf: 'Perf',
    routing: 'Routing',
    auth: 'Auth',
    controller: 'Controller',
    ssr: 'SSR',
    api: 'API',
    sql: 'SQL',
    diagnose: 'Diagnose',
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
const formatSignedBytes = (value?: number) =>
    value === undefined ? 'n/a' : `${value >= 0 ? '+' : '-'}${formatBytes(Math.abs(value))}`;
const formatSignedPercent = (value?: number) => (value === undefined ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`);
const formatTimestamp = (value?: string) => {
    if (!value) return 'never';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
};
const formatTimeLabel = (value?: string) => {
    if (!value) return 'n/a';
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
        ? value
        : date.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
          });
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
const formatOwnerSource = (match: TExplainOwnerMatch) =>
    `${match.source.filepath}${formatManifestLocation(match.source.line, match.source.column)}`;
const toRoundedNumber = (value?: number, precision = 1) => {
    if (value === undefined || Number.isNaN(value)) return 0;
    return Number(value.toFixed(precision));
};
const toKilobytes = (value?: number, precision = 1) => toRoundedNumber((value || 0) / 1024, precision);
const buildChartHeight = (rowCount: number, options?: { max?: number; min?: number; rowHeight?: number }) =>
    Math.max(options?.min || 240, Math.min(options?.max || 460, 112 + rowCount * (options?.rowHeight || 34)));

const profilerChartTheme = {
    amber: '#f59e0b',
    blue: '#175fe6',
    cyan: '#0ea5e9',
    green: '#15803d',
    indigo: '#6366f1',
    line: 'rgba(19, 32, 51, 0.1)',
    muted: '#627186',
    orange: '#ea580c',
    red: '#b91c1c',
    teal: '#0f766e',
    text: '#132033',
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
    const sqlCount = session.traces.reduce((count, traceItem) => count + (traceItem.trace?.sqlQueries.length || 0), 0);
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
        sqlCount,
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

const PlainCodeBlock = ({ value }: { value: string }) => <pre className="proteum-profiler__mono proteum-profiler__pre">{value}</pre>;

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

const formatSqlCallerReference = ({
    callerLabel,
    callerMethod,
    callerPath,
}: Pick<TTraceSqlQuery, 'callerLabel' | 'callerMethod' | 'callerPath'>) =>
    formatProfilerRequestReference({
        fallbackLabel: callerLabel,
        method: callerMethod,
        path: callerPath,
    });

const formatSqlQueryTitle = (query: string) => truncate(query.replace(/\s+/g, ' ').trim() || 'SQL query', 160);

const formatSqlParams = (item: TSqlQueryItem) =>
    item.paramsJson !== undefined ? formatStructuredValue(item.paramsJson) : item.paramsText || '[]';

const buildSqlQueryWorkspace = (session: TProfilerNavigationSession) => {
    const groups = new Map<string, TSqlQueryGroup>();
    const queryItems: TSqlQueryItem[] = [];
    const sortItems = (left: { id: string; startedAt: string }, right: { id: string; startedAt: string }) =>
        (readDateMs(left.startedAt) ?? 0) - (readDateMs(right.startedAt) ?? 0) || left.id.localeCompare(right.id);

    for (const traceItem of session.traces) {
        const trace = traceItem.trace;
        if (!trace) continue;

        for (const query of trace.sqlQueries || []) {
            const callerLabel = formatSqlCallerReference(query);
            const item: TSqlQueryItem = {
                callerLabel,
                durationMs: query.durationMs,
                finishedAt: query.finishedAt,
                id: query.id,
                kind: query.kind,
                model: query.model,
                operation: query.operation,
                paramsJson: query.paramsJson,
                paramsText: query.paramsText,
                query: query.query,
                startedAt: query.startedAt,
                tags: [
                    query.kind,
                    `op:${query.operation}`,
                    ...(query.model ? [`model:${query.model}`] : []),
                    ...(query.target ? [`target:${query.target}`] : []),
                    ...(query.callerOrigin !== 'request' ? [query.callerOrigin] : []),
                    ...(query.callerFetcherId ? [`fetcher:${query.callerFetcherId}`] : []),
                    ...(query.callerLabel &&
                    query.callerLabel !== query.callerFetcherId &&
                    query.callerLabel !== callerLabel
                        ? [`label:${query.callerLabel}`]
                        : []),
                ],
                target: query.target,
            };

            queryItems.push(item);

            const groupId = `${traceItem.id}:${query.callerCallId || 'request'}`;
            const group = groups.get(groupId);
            if (group) group.items.push(item);
            else groups.set(groupId, { id: groupId, items: [item], label: callerLabel });
        }
    }

    return {
        groups: [...groups.values()]
            .map((group) => ({ ...group, items: [...group.items].sort(sortItems) }))
            .sort(
                (left, right) =>
                    sortItems(left.items[0] || { id: left.id, startedAt: '' }, right.items[0] || { id: right.id, startedAt: '' }) ||
                    left.label.localeCompare(right.label),
            ),
        queryItems: [...queryItems].sort(sortItems),
    };
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

const SqlQueryListEntry = ({
    isSelected,
    item,
    onSelect,
}: {
    isSelected: boolean;
    item: TSqlQueryItem;
    onSelect: () => void;
}) => (
    <button
        aria-pressed={isSelected}
        className={`proteum-profiler__row proteum-profiler__row--interactive ${isSelected ? 'proteum-profiler__row--selected' : ''}`}
        onClick={onSelect}
        type="button"
    >
        <div className="proteum-profiler__rowHeader">
            <strong className="proteum-profiler__rowTitle">{formatSqlQueryTitle(item.query)}</strong>
            <span className="proteum-profiler__rowMeta">
                <span className="proteum-profiler__mono proteum-profiler__muted">{formatDuration(item.durationMs)}</span>
            </span>
        </div>
        <div className="proteum-profiler__tags">
            {item.tags.map((tag) => (
                <span className="proteum-profiler__tag" key={`${item.id}:tag:${tag}`}>
                    {tag}
                </span>
            ))}
        </div>
    </button>
);

const SqlQuerySidebar = ({ item }: { item?: TSqlQueryItem }) => {
    if (!item) {
        return (
            <aside className="proteum-profiler__sidebar">
                <div className="proteum-profiler__sidebarScroller">
                    <div className="proteum-profiler__sidebarHeader">
                        <div className="proteum-profiler__sidebarEyebrow">SQL details</div>
                        <div className="proteum-profiler__sidebarEmpty">
                            Select a query to inspect its caller, SQL text, bound params, and timing.
                        </div>
                    </div>
                </div>
            </aside>
        );
    }

    return (
        <aside className="proteum-profiler__sidebar">
            <div className="proteum-profiler__sidebarScroller">
                <div className="proteum-profiler__sidebarHeader">
                    <div className="proteum-profiler__sidebarEyebrow">SQL query</div>
                    <div className="proteum-profiler__sidebarTitle">
                        <strong>{formatSqlQueryTitle(item.query)}</strong>
                    </div>
                    <div className="proteum-profiler__mono proteum-profiler__muted">{item.callerLabel}</div>
                </div>

                <div className="proteum-profiler__metrics">
                    <SummaryRow label="Caller" value={item.callerLabel} />
                    <SummaryRow label="Duration" value={formatDuration(item.durationMs)} />
                    <SummaryRow label="Started" value={formatTimestamp(item.startedAt)} />
                    <SummaryRow label="Finished" value={formatTimestamp(item.finishedAt)} />
                    <SummaryRow label="Kind" value={item.kind} />
                    <SummaryRow label="Operation" value={item.operation} />
                    <SummaryRow label="Model" value={item.model || 'n/a'} />
                    <SummaryRow label="Target" value={item.target || 'n/a'} />
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
                    <div className="proteum-profiler__sidebarSectionTitle">SQL</div>
                    <PlainCodeBlock value={item.query} />
                </div>

                <div className="proteum-profiler__sidebarSection">
                    <div className="proteum-profiler__sidebarSectionTitle">Parameters</div>
                    {item.paramsJson !== undefined ? (
                        <JsonCodeBlock value={formatStructuredValue(item.paramsJson)} />
                    ) : (
                        <PlainCodeBlock value={formatSqlParams(item)} />
                    )}
                </div>
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
            originLabel: call.origin,
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
            originLabel: 'client-async',
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
    const endpointDurationChart = buildHorizontalBarChartOptions({
        color: profilerChartTheme.blue,
        entries: buildDurationEntries(
            requestItems,
            (item) => formatApiReference(item.method, item.path, item.requestData, item.label),
            (item) => item.durationMs,
        ),
        title: 'Endpoint workload',
        valueUnit: 'Milliseconds',
    });
    const originWorkloadChart = buildColumnChartOptions({
        colors: [profilerChartTheme.indigo],
        entries: buildDurationEntries(
            requestItems,
            (item) => getApiOriginLabel(item),
            (item) => item.durationMs,
            6,
        ),
        title: 'Origin time share',
        valueUnit: 'Milliseconds',
    });
    const statusCountChart = buildColumnChartOptions({
        colors: [profilerChartTheme.amber],
        entries: buildCountEntries(requestItems.map((item) => getRequestStatusGroup(item.statusCode, item.statusLabel))),
        title: 'Status groups',
        valueUnit: 'Requests',
    });

    React.useEffect(() => {
        if (requestItems.some((item) => item.id === selectedRequestId)) return;
        setSelectedRequestId(requestItems[0]?.id);
    }, [requestItems, selectedRequestId]);

    const waterfallItems = buildApiWaterfallItems(requestItems);
    const selectedItem = requestItems.find((item) => item.id === selectedRequestId) || requestItems[0];

    return (
        <div className="proteum-profiler__requestWorkspace">
            <div className="proteum-profiler__splitColumn">
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No API request timings were captured for this session."
                        options={endpointDurationChart}
                        subtitle="Rank the most expensive endpoints across synchronous and async requests."
                        title="Hot Endpoints"
                    />
                    <ChartSection
                        emptyLabel="No API origin timings were captured for this session."
                        options={originWorkloadChart}
                        subtitle="Compare time spent in SSR fetchers, batch fetchers, and client async calls."
                        title="Origin Mix"
                    />
                    <ChartSection
                        emptyLabel="No API status information was captured for this session."
                        options={statusCountChart}
                        subtitle="Spot failures or pending requests without scanning every row."
                        title="Status Spread"
                    />
                </div>

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

const SqlPanel = ({ session }: { session: TProfilerNavigationSession }) => {
    const { groups, queryItems } = buildSqlQueryWorkspace(session);
    const [selectedQueryId, setSelectedQueryId] = React.useState<string | undefined>(() => queryItems[0]?.id);
    const callerDurationChart = buildHorizontalBarChartOptions({
        color: profilerChartTheme.teal,
        entries: buildDurationEntries(queryItems, (item) => item.callerLabel, (item) => item.durationMs),
        title: 'Hot SQL callers',
        valueUnit: 'Milliseconds',
    });
    const operationCountChart = buildColumnChartOptions({
        colors: [profilerChartTheme.amber],
        entries: buildCountEntries(queryItems.map((item) => `${item.operation}${item.model ? `:${item.model}` : ''}`)),
        title: 'Operation volume',
        valueUnit: 'Queries',
    });
    const selectedCallers = buildDurationEntries(queryItems, (item) => item.callerLabel, (item) => item.durationMs, 6).map((entry) => entry.label);
    const selectedOperations = buildCountEntries(
        queryItems.map((item) => `${item.operation}${item.model ? `:${item.model}` : ''}`),
        6,
    ).map((entry) => entry.label);
    const callerOperationHeatmap = buildHeatmapChartOptions({
        rows: selectedCallers.map((callerLabel) => ({
            data: selectedOperations.map((operationLabel) => ({
                x: truncate(operationLabel, 22),
                y: queryItems.filter(
                    (item) => item.callerLabel === callerLabel && `${item.operation}${item.model ? `:${item.model}` : ''}` === operationLabel,
                ).length,
            })),
            name: truncate(callerLabel, 28),
        })),
        title: 'Caller x operation density',
        valueUnit: 'Operation',
    });

    React.useEffect(() => {
        if (queryItems.some((item) => item.id === selectedQueryId)) return;
        setSelectedQueryId(queryItems[0]?.id);
    }, [queryItems, selectedQueryId]);

    const waterfallItems = buildSqlWaterfallItems(queryItems);
    const selectedItem = queryItems.find((item) => item.id === selectedQueryId) || queryItems[0];

    return (
        <div className="proteum-profiler__requestWorkspace">
            <div className="proteum-profiler__splitColumn">
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No SQL timings were captured for this session."
                        options={callerDurationChart}
                        subtitle="Show which callers are driving the most database time."
                        title="Hot Callers"
                    />
                    <ChartSection
                        emptyLabel="No SQL operation counts were captured for this session."
                        options={operationCountChart}
                        subtitle="Highlight whether reads, writes, or raw queries dominate the request."
                        title="Operation Mix"
                    />
                    <ChartSection
                        emptyLabel="No caller or operation overlap was captured for this session."
                        options={callerOperationHeatmap}
                        subtitle="Surface dense caller and operation combinations at a glance."
                        title="Caller Heatmap"
                    />
                </div>

                <WaterfallChart
                    emptyLabel="No SQL queries were captured for this session."
                    itemLabel="query"
                    items={waterfallItems}
                    onSelect={setSelectedQueryId}
                />

                <div className="proteum-profiler__requestGroups">
                    {groups.length === 0 ? (
                        <div className="proteum-profiler__empty">No SQL queries were captured for this session.</div>
                    ) : (
                        groups.map((group) => (
                            <div className="proteum-profiler__requestGroup" key={group.id}>
                                <div className="proteum-profiler__requestGroupHeader">
                                    <div className="proteum-profiler__sectionTitle">{group.label}</div>
                                    <div className="proteum-profiler__requestGroupCount">
                                        {group.items.length} item{group.items.length === 1 ? '' : 's'}
                                    </div>
                                </div>

                                <div className="proteum-profiler__list">
                                    {group.items.map((item) => (
                                        <SqlQueryListEntry
                                            isSelected={item.id === selectedItem?.id}
                                            item={item}
                                            key={item.id}
                                            onSelect={() => setSelectedQueryId(item.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <SqlQuerySidebar item={selectedItem} />
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

const buildSqlWaterfallItems = (queryItems: TSqlQueryItem[]): TWaterfallChartItem[] => {
    const rawItems = queryItems.map((item) => {
        const startMs = readDateMs(item.startedAt) ?? 0;
        const endMs = buildWaterfallEndMs({
            durationMs: item.durationMs,
            finishedAt: item.finishedAt,
            startMs,
        });

        return {
            endMs,
            item,
            startMs,
            title: formatSqlQueryTitle(item.query),
        };
    });

    const sortedItems = [...rawItems].sort((left, right) => left.startMs - right.startMs || left.item.id.localeCompare(right.item.id));
    const chartStartMs = sortedItems.length > 0 ? Math.min(...sortedItems.map((item) => item.startMs)) : 0;

    return sortedItems.map(({ endMs, item, startMs, title }) => {
        const startOffsetMs = startMs - chartStartMs;
        const endOffsetMs = endMs - chartStartMs;

        return {
            barLabel: truncate(title, 84),
            color: getTimelineDurationColor(item.durationMs),
            detailLines: [
                `Caller: ${item.callerLabel}`,
                `Operation: ${item.operation}${item.model ? ` (${item.model})` : ''}`,
                `Duration: ${formatDuration(item.durationMs)}`,
                `Start: +${Math.round(startOffsetMs)} ms`,
                `End: +${Math.round(endOffsetMs)} ms`,
            ],
            endOffsetMs,
            id: item.id,
            startOffsetMs,
            subtitle: item.callerLabel,
            title,
        };
    });
};

const getPerfStageColor = (stageId: TRequestPerformance['stages'][number]['id']) => {
    if (stageId === 'auth') return '#0ea5e9';
    if (stageId === 'routing') return '#3b82f6';
    if (stageId === 'controller') return '#6366f1';
    if (stageId === 'page-data') return '#14b8a6';
    if (stageId === 'render') return '#f59e0b';
    return '#22c55e';
};

const buildPerfWaterfallItems = (request: TRequestPerformance): TWaterfallChartItem[] =>
    request.stages.map((stage) => ({
        barLabel: `${stage.label} ${formatDuration(stage.durationMs)}`,
        color: getPerfStageColor(stage.id),
        detailLines: [
            `Start: +${Math.round(stage.startOffsetMs)} ms`,
            `End: +${Math.round(stage.endOffsetMs)} ms`,
            `Duration: ${formatDuration(stage.durationMs)}`,
        ],
        endOffsetMs: stage.endOffsetMs,
        id: stage.id,
        startOffsetMs: stage.startOffsetMs,
        title: stage.label,
    }));

const pluralizeCountLabel = (label: string, count: number) => {
    if (count === 1) return label;
    if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
    return `${label}s`;
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
    const totalDurationMs = Math.max(items.length > 0 ? Math.max(...items.map((item) => item.endOffsetMs)) : 1, 1);
    const chartHeight = Math.max(260, items.length * waterfallRowHeight + 24);
    const options: ApexOptions | undefined =
        items.length === 0
            ? undefined
            : ({
                  chart: {
                      animations: { enabled: false },
                      background: 'transparent',
                      ...(onSelect
                          ? {
                                events: {
                                    dataPointSelection: (
                                        _event: unknown,
                                        _chartContext: unknown,
                                        config: { dataPointIndex: number },
                                    ) => {
                                        const item = items[config.dataPointIndex];
                                        if (item) onSelect(item.id);
                                    },
                                },
                            }
                          : {}),
                      foreColor: profilerChartTheme.muted,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                      height: chartHeight,
                      parentHeightOffset: 0,
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
                      borderColor: profilerChartTheme.line,
                      padding: { bottom: 0, left: 0, right: 0, top: 4 },
                      xaxis: { lines: { show: true } },
                      yaxis: { lines: { show: false } },
                  },
                  legend: {
                      show: false,
                  },
                  noData: {
                      style: {
                          color: profilerChartTheme.muted,
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
                  series: [
                      {
                          data: items.map((item) => ({
                              fillColor: item.color,
                              x: item.barLabel,
                              y: [item.startOffsetMs, item.endOffsetMs],
                          })),
                          name: itemLabel,
                      },
                  ],
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
                              colors: profilerChartTheme.muted,
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
              }) as ApexOptions;

    return (
        <div className="proteum-profiler__section">
            <div className="proteum-profiler__timelineChart">
                <div className="proteum-profiler__timelineChartMeta">
                    <span className="proteum-profiler__mono proteum-profiler__muted">
                        {items.length} {pluralizeCountLabel(itemLabel, items.length)}
                    </span>
                    <span className="proteum-profiler__mono proteum-profiler__muted">{formatDuration(totalDurationMs)}</span>
                </div>

                <div className="proteum-profiler__timelineChartCanvas" style={{ height: `${chartHeight}px` }}>
                    {options ? (
                        <ApexChart emptyLabel={emptyLabel} options={options} />
                    ) : (
                        <div className="proteum-profiler__empty">{emptyLabel}</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const createProfilerBarChartOptions = ({
    categories,
    colors,
    height,
    series,
    stacked = false,
    title,
    valueUnit,
}: {
    categories: string[];
    colors: string[];
    height: number;
    series: Array<{ data: number[]; name: string }>;
    stacked?: boolean;
    title: string;
    valueUnit: string;
}): ApexOptions => ({
    chart: {
        animations: { enabled: false },
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        foreColor: profilerChartTheme.muted,
        height,
        parentHeightOffset: 0,
        stacked,
        toolbar: { show: false },
        type: 'bar',
        zoom: { enabled: false },
    },
    colors,
    dataLabels: { enabled: false },
    grid: {
        borderColor: profilerChartTheme.line,
        padding: { bottom: 4, left: 8, right: 8, top: 0 },
        strokeDashArray: 2,
    },
    legend: {
        fontSize: '11px',
        horizontalAlign: 'left',
        position: 'top',
    },
    noData: { text: 'No chart data.' },
    plotOptions: {
        bar: {
            barHeight: '68%',
            horizontal: true,
        },
    },
    series,
    stroke: { width: 1 },
    title: {
        style: {
            color: profilerChartTheme.text,
            fontSize: '12px',
            fontWeight: 700,
        },
        text: title,
    },
    tooltip: { intersect: false, shared: stacked },
    xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        categories,
        labels: { style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
        title: {
            style: {
                color: profilerChartTheme.muted,
                fontSize: '10px',
                fontWeight: 600,
            },
            text: valueUnit,
        },
    },
    yaxis: {
        labels: {
            style: { colors: profilerChartTheme.text, fontSize: '11px' },
        },
    },
});

const createProfilerColumnChartOptions = ({
    categories,
    colors,
    height,
    series,
    stacked = false,
    title,
    valueUnit,
}: {
    categories: string[];
    colors: string[];
    height: number;
    series: Array<{ data: number[]; name: string }>;
    stacked?: boolean;
    title: string;
    valueUnit: string;
}): ApexOptions => ({
    chart: {
        animations: { enabled: false },
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        foreColor: profilerChartTheme.muted,
        height,
        parentHeightOffset: 0,
        stacked,
        toolbar: { show: false },
        type: 'bar',
        zoom: { enabled: false },
    },
    colors,
    dataLabels: { enabled: false },
    grid: {
        borderColor: profilerChartTheme.line,
        padding: { bottom: 4, left: 8, right: 8, top: 0 },
        strokeDashArray: 2,
    },
    legend: {
        fontSize: '11px',
        horizontalAlign: 'left',
        position: 'top',
    },
    noData: { text: 'No chart data.' },
    plotOptions: {
        bar: {
            borderRadius: 2,
            columnWidth: '58%',
            horizontal: false,
        },
    },
    series,
    stroke: { width: 1 },
    title: {
        style: {
            color: profilerChartTheme.text,
            fontSize: '12px',
            fontWeight: 700,
        },
        text: title,
    },
    tooltip: { intersect: false, shared: stacked },
    xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        categories,
        labels: {
            rotate: -28,
            style: { colors: profilerChartTheme.muted, fontSize: '11px' },
            trim: true,
        },
    },
    yaxis: {
        labels: { style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
        title: {
            style: {
                color: profilerChartTheme.muted,
                fontSize: '10px',
                fontWeight: 600,
            },
            text: valueUnit,
        },
    },
});

const createProfilerLineChartOptions = ({
    categories,
    colors,
    height,
    series,
    title,
    valueUnit,
}: {
    categories: string[];
    colors: string[];
    height: number;
    series: Array<{ data: number[]; name: string }>;
    title: string;
    valueUnit: string;
}): ApexOptions => ({
    chart: {
        animations: { enabled: false },
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        foreColor: profilerChartTheme.muted,
        height,
        parentHeightOffset: 0,
        toolbar: { show: false },
        type: 'line',
        zoom: { enabled: false },
    },
    colors,
    dataLabels: { enabled: false },
    grid: {
        borderColor: profilerChartTheme.line,
        padding: { bottom: 4, left: 8, right: 8, top: 0 },
        strokeDashArray: 2,
    },
    legend: {
        fontSize: '11px',
        horizontalAlign: 'left',
        position: 'top',
    },
    markers: { size: 4, strokeWidth: 0 },
    noData: { text: 'No chart data.' },
    series,
    stroke: { curve: 'smooth', width: 2 },
    title: {
        style: {
            color: profilerChartTheme.text,
            fontSize: '12px',
            fontWeight: 700,
        },
        text: title,
    },
    tooltip: { intersect: false, shared: true },
    xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        categories,
        labels: { rotate: -24, style: { colors: profilerChartTheme.muted, fontSize: '11px' }, trim: true },
    },
    yaxis: {
        labels: { style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
        title: {
            style: {
                color: profilerChartTheme.muted,
                fontSize: '10px',
                fontWeight: 600,
            },
            text: valueUnit,
        },
    },
});

const createProfilerScatterChartOptions = ({
    colors,
    height,
    series,
    title,
    xaxisTitle,
    yaxisTitle,
}: {
    colors: string[];
    height: number;
    series: Array<{ data: Array<{ x: number; y: number }>; name: string }>;
    title: string;
    xaxisTitle: string;
    yaxisTitle: string;
}): ApexOptions => ({
    chart: {
        animations: { enabled: false },
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        foreColor: profilerChartTheme.muted,
        height,
        parentHeightOffset: 0,
        toolbar: { show: false },
        type: 'scatter',
        zoom: { enabled: false },
    },
    colors,
    dataLabels: { enabled: false },
    grid: {
        borderColor: profilerChartTheme.line,
        padding: { bottom: 4, left: 8, right: 8, top: 0 },
        strokeDashArray: 2,
    },
    legend: {
        fontSize: '11px',
        horizontalAlign: 'left',
        position: 'top',
    },
    markers: { size: 6, strokeWidth: 0 },
    noData: { text: 'No chart data.' },
    series,
    title: {
        style: {
            color: profilerChartTheme.text,
            fontSize: '12px',
            fontWeight: 700,
        },
        text: title,
    },
    tooltip: { intersect: false, shared: false },
    xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
        title: {
            style: {
                color: profilerChartTheme.muted,
                fontSize: '10px',
                fontWeight: 600,
            },
            text: xaxisTitle,
        },
        tickAmount: 6,
    },
    yaxis: {
        labels: { style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
        title: {
            style: {
                color: profilerChartTheme.muted,
                fontSize: '10px',
                fontWeight: 600,
            },
            text: yaxisTitle,
        },
        tickAmount: 6,
    },
});

const createProfilerHeatmapOptions = ({
    height,
    series,
    title,
    valueUnit,
}: {
    height: number;
    series: Array<{ data: Array<{ x: string; y: number }>; name: string }>;
    title: string;
    valueUnit: string;
}): ApexOptions => ({
    chart: {
        animations: { enabled: false },
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        foreColor: profilerChartTheme.muted,
        height,
        parentHeightOffset: 0,
        toolbar: { show: false },
        type: 'heatmap',
        zoom: { enabled: false },
    },
    colors: [profilerChartTheme.blue],
    dataLabels: { enabled: false },
    grid: {
        borderColor: profilerChartTheme.line,
        padding: { bottom: 4, left: 8, right: 8, top: 0 },
        strokeDashArray: 2,
    },
    legend: { show: false },
    noData: { text: 'No chart data.' },
    plotOptions: {
        heatmap: {
            colorScale: {
                ranges: [
                    { color: '#eef4ff', from: 0, to: 0 },
                    { color: '#bfdbfe', from: 0.01, to: 5 },
                    { color: '#60a5fa', from: 5.01, to: 25 },
                    { color: '#2563eb', from: 25.01, to: 1000000 },
                ],
            },
            radius: 0,
        },
    },
    series,
    stroke: { width: 1 },
    title: {
        style: {
            color: profilerChartTheme.text,
            fontSize: '12px',
            fontWeight: 700,
        },
        text: title,
    },
    tooltip: { intersect: false, shared: false },
    xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { rotate: -24, style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
        title: {
            style: {
                color: profilerChartTheme.muted,
                fontSize: '10px',
                fontWeight: 600,
            },
            text: valueUnit,
        },
    },
    yaxis: {
        labels: { style: { colors: profilerChartTheme.text, fontSize: '11px' } },
    },
});

const buildTopEntries = (entries: Array<{ label: string; value: number }>, limit = 8) =>
    entries
        .filter((entry) => entry.label && entry.value > 0)
        .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
        .slice(0, limit);

const buildCountEntries = (labels: string[], limit = 8) => {
    const counts = new Map<string, number>();
    for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
    return buildTopEntries(
        [...counts.entries()].map(([label, value]) => ({ label, value })),
        limit,
    );
};

const buildDurationEntries = <T,>(items: T[], readLabel: (item: T) => string | undefined, readValue: (item: T) => number | undefined, limit = 8) => {
    const totals = new Map<string, number>();
    for (const item of items) {
        const label = readLabel(item);
        const value = readValue(item);
        if (!label || value === undefined) continue;
        totals.set(label, (totals.get(label) || 0) + value);
    }

    return buildTopEntries(
        [...totals.entries()].map(([label, value]) => ({ label, value })),
        limit,
    );
};

const buildHorizontalBarChartOptions = ({
    color,
    entries,
    title,
    valueUnit,
}: {
    color: string;
    entries: Array<{ label: string; value: number }>;
    title: string;
    valueUnit: string;
}) =>
    entries.length === 0
        ? undefined
        : createProfilerBarChartOptions({
              categories: entries.map((entry) => truncate(entry.label, 44)),
              colors: [color],
              height: buildChartHeight(entries.length),
              series: [{ data: entries.map((entry) => toRoundedNumber(entry.value)), name: valueUnit }],
              title,
              valueUnit,
          });

const buildColumnChartOptions = ({
    colors,
    entries,
    title,
    valueUnit,
}: {
    colors: string[];
    entries: Array<{ label: string; value: number }>;
    title: string;
    valueUnit: string;
}) =>
    entries.length === 0
        ? undefined
        : createProfilerColumnChartOptions({
              categories: entries.map((entry) => truncate(entry.label, 28)),
              colors,
              height: 280,
              series: [{ data: entries.map((entry) => toRoundedNumber(entry.value)), name: valueUnit }],
              title,
              valueUnit,
          });

const buildLineChartOptions = ({
    color,
    entries,
    title,
    valueUnit,
}: {
    color: string;
    entries: Array<{ label: string; value: number }>;
    title: string;
    valueUnit: string;
}) =>
    entries.length === 0
        ? undefined
        : createProfilerLineChartOptions({
              categories: entries.map((entry) => truncate(entry.label, 28)),
              colors: [color],
              height: 280,
              series: [{ data: entries.map((entry) => toRoundedNumber(entry.value)), name: valueUnit }],
              title,
              valueUnit,
          });

const buildScatterChartOptions = ({
    color,
    points,
    seriesName,
    title,
    xaxisTitle,
    yaxisTitle,
}: {
    color: string;
    points: Array<{ x: number; y: number }>;
    seriesName: string;
    title: string;
    xaxisTitle: string;
    yaxisTitle: string;
}) =>
    points.length === 0
        ? undefined
        : createProfilerScatterChartOptions({
              colors: [color],
              height: 300,
              series: [{ data: points, name: seriesName }],
              title,
              xaxisTitle,
              yaxisTitle,
          });

const buildStackedColumnChartOptions = ({
    categories,
    colors,
    series,
    title,
    valueUnit,
}: {
    categories: string[];
    colors: string[];
    series: Array<{ data: number[]; name: string }>;
    title: string;
    valueUnit: string;
}) =>
    categories.length === 0 || series.length === 0 || series.every((entry) => entry.data.every((value) => value === 0))
        ? undefined
        : createProfilerColumnChartOptions({
              categories,
              colors,
              height: 300,
              series,
              stacked: true,
              title,
              valueUnit,
          });

const buildHeatmapChartOptions = ({
    rows,
    title,
    valueUnit,
}: {
    rows: Array<{ data: Array<{ x: string; y: number }>; name: string }>;
    title: string;
    valueUnit: string;
}) =>
    rows.length === 0 || rows.every((row) => row.data.every((entry) => entry.y === 0))
        ? undefined
        : createProfilerHeatmapOptions({
              height: buildChartHeight(rows.length, { max: 360, min: 240, rowHeight: 36 }),
              series: rows,
              title,
              valueUnit,
          });

const getSessionChartLabel = (candidate: TProfilerNavigationSession, summary: TSessionSummary) =>
    truncate(`${formatTimeLabel(candidate.startedAt)} ${summary.routeLabel}`, 28);

const getApiOriginLabel = (item: TApiRequestItem) => item.originLabel || item.groupLabel;

const getRequestStatusGroup = (statusCode?: number, statusLabel?: string) => {
    if (statusCode === undefined) return statusLabel || 'pending';
    if (statusCode >= 500) return '5xx';
    if (statusCode >= 400) return '4xx';
    if (statusCode >= 300) return '3xx';
    if (statusCode >= 200) return '2xx';
    return String(statusCode);
};

const buildPerfTopLatencyChartOptions = (rows: NonNullable<TProfilerState['perf']['top']>['rows']): ApexOptions | undefined => {
    if (rows.length === 0) return undefined;

    return createProfilerBarChartOptions({
        categories: rows.map((row) => truncate(row.label, 40)),
        colors: [profilerChartTheme.blue, profilerChartTheme.indigo],
        height: buildChartHeight(rows.length),
        series: [
            { data: rows.map((row) => toRoundedNumber(row.avgDurationMs)), name: 'Avg ms' },
            { data: rows.map((row) => toRoundedNumber(row.p95DurationMs)), name: 'P95 ms' },
        ],
        title: 'Latency by hot path',
        valueUnit: 'Milliseconds',
    });
};

const buildPerfBreakdownChartOptions = (rows: NonNullable<TProfilerState['perf']['top']>['rows']): ApexOptions | undefined => {
    if (rows.length === 0) return undefined;

    return createProfilerBarChartOptions({
        categories: rows.map((row) => truncate(row.label, 40)),
        colors: [profilerChartTheme.blue, profilerChartTheme.amber, profilerChartTheme.teal, profilerChartTheme.green],
        height: buildChartHeight(rows.length),
        series: [
            { data: rows.map((row) => toRoundedNumber(row.avgSelfDurationMs)), name: 'Self ms' },
            { data: rows.map((row) => toRoundedNumber(row.avgSqlDurationMs)), name: 'SQL ms' },
            { data: rows.map((row) => toRoundedNumber(row.avgCallDurationMs)), name: 'Calls ms' },
            { data: rows.map((row) => toRoundedNumber(row.avgRenderDurationMs)), name: 'Render ms' },
        ],
        stacked: true,
        title: 'Average time breakdown',
        valueUnit: 'Milliseconds',
    });
};

const buildPerfCompareChartOptions = (rows: NonNullable<TProfilerState['perf']['compare']>['rows']): ApexOptions | undefined => {
    if (rows.length === 0) return undefined;

    const values = rows.map((row) => toRoundedNumber(row.p95DurationMs.deltaPercent));
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 0);

    return {
        ...createProfilerBarChartOptions({
            categories: rows.map((row) => truncate(row.label, 40)),
            colors: rows.map((row) =>
                row.change === 'improved'
                    ? profilerChartTheme.green
                    : row.change === 'regressed'
                      ? profilerChartTheme.red
                      : row.change === 'new'
                        ? profilerChartTheme.blue
                        : row.change === 'removed'
                          ? profilerChartTheme.muted
                          : profilerChartTheme.orange,
            ),
            height: buildChartHeight(rows.length, { max: 420 }),
            series: [{ data: values, name: 'P95 delta %' }],
            title: 'Regression pressure',
            valueUnit: 'Percent vs baseline',
        }),
        plotOptions: {
            bar: {
                barHeight: '68%',
                distributed: true,
                horizontal: true,
            },
        },
        xaxis: {
            axisBorder: { show: false },
            axisTicks: { show: false },
            categories: rows.map((row) => truncate(row.label, 40)),
            labels: { style: { colors: profilerChartTheme.muted, fontSize: '11px' } },
            max: Math.max(10, Math.ceil(maxValue / 10) * 10),
            min: Math.min(-10, Math.floor(minValue / 10) * 10),
            title: {
                style: {
                    color: profilerChartTheme.muted,
                    fontSize: '10px',
                    fontWeight: 600,
                },
                text: 'Percent vs baseline',
            },
        },
    };
};

const buildPerfMemoryChartOptions = (rows: NonNullable<TProfilerState['perf']['memory']>['rows']): ApexOptions | undefined => {
    if (rows.length === 0) return undefined;

    return createProfilerBarChartOptions({
        categories: rows.map((row) => truncate(row.label, 40)),
        colors: [profilerChartTheme.amber, profilerChartTheme.red, profilerChartTheme.cyan],
        height: buildChartHeight(rows.length),
        series: [
            { data: rows.map((row) => toKilobytes(row.avgHeapDeltaBytes)), name: 'Avg heap KB' },
            { data: rows.map((row) => toKilobytes(row.maxHeapDeltaBytes)), name: 'Max heap KB' },
            { data: rows.map((row) => toKilobytes(row.avgRssDeltaBytes)), name: 'Avg RSS KB' },
        ],
        title: 'Memory drift by group',
        valueUnit: 'Kilobytes',
    });
};

const ChartSection = ({
    emptyLabel,
    options,
    subtitle,
    title,
}: {
    emptyLabel: string;
    options?: ApexOptions;
    subtitle: string;
    title: string;
}) => (
    <div className="proteum-profiler__chartCard">
        <div className="proteum-profiler__chartHeader">
            <div className="proteum-profiler__sectionTitle">{title}</div>
            <div className="proteum-profiler__chartSubtitle">{subtitle}</div>
        </div>
        <ApexChart emptyLabel={emptyLabel} options={options} />
    </div>
);

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
    const allAuthEvents = authSections.flatMap((section) => section.authEvents);
    const authEventTypeChart = buildHorizontalBarChartOptions({
        color: profilerChartTheme.cyan,
        entries: buildCountEntries(allAuthEvents.map((event) => event.type.replace(/^auth\./, ''))),
        title: 'Auth event frequency',
        valueUnit: 'Events',
    });
    const authRuleChart = buildColumnChartOptions({
        colors: [profilerChartTheme.indigo],
        entries: buildCountEntries(
            allAuthEvents
                .filter((event) => event.type === 'auth.check.rule')
                .map(
                    (event) =>
                        readString(event.details.rule) ||
                        readString(event.details.name) ||
                        readString(event.details.label) ||
                        `rule ${event.index}`,
                ),
        ),
        title: 'Rule hits',
        valueUnit: 'Checks',
    });
    const authResultChart = buildColumnChartOptions({
        colors: [profilerChartTheme.green],
        entries: buildCountEntries(
            allAuthEvents
                .filter((event) => event.type === 'auth.check.result' || event.type === 'auth.route')
                .map(
                    (event) =>
                        readString(event.details.result) ||
                        readString(event.details.status) ||
                        readString(event.details.mode) ||
                        renderSummaryValue(event.details.allowed) ||
                        event.type,
                ),
        ),
        title: 'Auth outcomes',
        valueUnit: 'Events',
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
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No auth events were captured for this session."
                        options={authEventTypeChart}
                        subtitle="See which auth phases are actually active for the selected navigation."
                        title="Auth Flow"
                    />
                    <ChartSection
                        emptyLabel="No rule checks were captured for this session."
                        options={authRuleChart}
                        subtitle="Highlight the rules that are firing most often in the current auth flow."
                        title="Rule Pressure"
                    />
                    <ChartSection
                        emptyLabel="No auth outcome events were captured for this session."
                        options={authResultChart}
                        subtitle="Summarize allow, deny, and routing outcomes without reading every trace row."
                        title="Outcomes"
                    />
                </div>

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
        const recentSessionRows = state.sessions.slice(-8).map((candidate) => ({
            session: candidate,
            summary: getSummary(candidate),
        }));
        const recentSessionLabels = recentSessionRows.map(({ session: candidate, summary: candidateSummary }) =>
            getSessionChartLabel(candidate, candidateSummary),
        );
        const durationTrendChart = buildLineChartOptions({
            color: profilerChartTheme.blue,
            entries: recentSessionRows.map(({ session: candidate, summary: candidateSummary }) => ({
                label: getSessionChartLabel(candidate, candidateSummary),
                value: candidateSummary.totalMs || 0,
            })),
            title: 'Recent navigation duration',
            valueUnit: 'Milliseconds',
        });
        const workloadChart =
            recentSessionLabels.length === 0
                ? undefined
                : createProfilerColumnChartOptions({
                      categories: recentSessionLabels,
                      colors: [profilerChartTheme.indigo, profilerChartTheme.teal, profilerChartTheme.red],
                      height: 300,
                      series: [
                          {
                              data: recentSessionRows.map(({ summary: candidateSummary }) => candidateSummary.apiSyncCount + candidateSummary.apiAsyncCount),
                              name: 'API',
                          },
                          { data: recentSessionRows.map(({ summary: candidateSummary }) => candidateSummary.sqlCount), name: 'SQL' },
                          { data: recentSessionRows.map(({ summary: candidateSummary }) => candidateSummary.errorCount), name: 'Errors' },
                      ],
                      title: 'Recent workload mix',
                      valueUnit: 'Count',
                  });
        const routeFrequencyChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.amber,
            entries: buildCountEntries(recentSessionRows.map(({ summary: candidateSummary }) => candidateSummary.routeLabel)),
            title: 'Hot recent routes',
            valueUnit: 'Sessions',
        });
        const statusSpreadChart = buildColumnChartOptions({
            colors: [profilerChartTheme.green],
            entries: buildCountEntries(recentSessionRows.map(({ summary: candidateSummary }) => candidateSummary.statusLabel)),
            title: 'Recent status spread',
            valueUnit: 'Sessions',
        });

        return (
            <>
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No recent session durations were captured yet."
                        options={durationTrendChart}
                        subtitle="Track how the last few navigations are trending instead of reading one request in isolation."
                        title="Duration Trend"
                    />
                    <ChartSection
                        emptyLabel="No recent workload data was captured yet."
                        options={workloadChart}
                        subtitle="Compare API, SQL, and error volume across the most recent sessions."
                        title="Workload Mix"
                    />
                    <ChartSection
                        emptyLabel="No recent route frequency data was captured yet."
                        options={routeFrequencyChart}
                        subtitle="See which routes are dominating the recent debugging session."
                        title="Route Frequency"
                    />
                    <ChartSection
                        emptyLabel="No recent session statuses were captured yet."
                        options={statusSpreadChart}
                        subtitle="Quick view of SSR, navigation, and request status patterns."
                        title="Status Spread"
                    />
                </div>

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
                    <SummaryRow label="SQL" value={String(summary.sqlCount)} />
                    <SummaryRow label="Errors" value={String(summary.errorCount)} />
                    <SummaryRow label="Request" value={session.requestId || 'client-only'} />
                </div>
            </>
        );
    }

    if (panel === 'timeline') {
        return <TimelinePanel session={session} />;
    }

    if (panel === 'perf') {
        const perf = state.perf;
        const currentRequest = primaryTrace ? buildRequestPerformance(primaryTrace) : undefined;
        const waterfallItems = currentRequest ? buildPerfWaterfallItems(currentRequest) : [];
        const topRows =
            perf.top?.rows.map((row) => ({
                key: `top:${row.key}`,
                title: `${row.label} · ${formatDuration(row.avgDurationMs)}`,
                value: `requests=${row.requestCount} p95=${formatDuration(row.p95DurationMs)} cpu=${formatDuration(row.avgCpuMs)} sql=${formatDuration(row.avgSqlDurationMs)} heap=${formatSignedBytes(row.avgHeapDeltaBytes)} slowest=${row.slowestRequestId || 'n/a'}`,
            })) || [];
        const compareRows =
            perf.compare?.rows.map((row) => ({
                key: `compare:${row.key}`,
                title: `[${row.change}] ${row.label}`,
                value: `p95=${formatSignedPercent(row.p95DurationMs.deltaPercent)} avg=${formatSignedPercent(row.avgDurationMs.deltaPercent)} cpu=${formatSignedPercent(row.avgCpuMs.deltaPercent)} heap=${formatSignedBytes(row.avgHeapDeltaBytes.delta)} sql=${formatSignedPercent(row.avgSqlDurationMs.deltaPercent)}`,
            })) || [];
        const memoryRows =
            perf.memory?.rows.map((row) => ({
                key: `memory:${row.key}`,
                title: `[${row.trend}] ${row.label}`,
                value: `requests=${row.requestCount} heap avg=${formatSignedBytes(row.avgHeapDeltaBytes)} max=${formatSignedBytes(row.maxHeapDeltaBytes)} rss avg=${formatSignedBytes(row.avgRssDeltaBytes)} drift=${formatSignedPercent(row.positiveHeapDriftRatio * 100)}`,
            })) || [];
        const callRows =
            currentRequest?.hottestCalls.map((call) => ({
                key: `call:${call.id}`,
                title: call.label,
                value: `duration=${formatDuration(call.durationMs)} status=${call.statusCode ?? 'pending'} origin=${call.origin}${call.errorMessage ? ` error=${call.errorMessage}` : ''}`,
            })) || [];
        const sqlRows =
            currentRequest?.hottestSqlQueries.map((query) => ({
                key: `sql:${query.id}`,
                title: `${query.callerLabel} · ${formatDuration(query.durationMs)}`,
                value: `${query.operation}${query.model ? ` ${query.model}` : ''} | ${truncate(query.query, 160)}`,
            })) || [];
        const topLatencyChart = perf.top ? buildPerfTopLatencyChartOptions(perf.top.rows) : undefined;
        const topBreakdownChart = perf.top ? buildPerfBreakdownChartOptions(perf.top.rows) : undefined;
        const compareChart = perf.compare ? buildPerfCompareChartOptions(perf.compare.rows) : undefined;
        const memoryChart = perf.memory ? buildPerfMemoryChartOptions(perf.memory.rows) : undefined;

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionHeader">
                    <div className="proteum-profiler__sectionTitle">Performance</div>
                    <div className="proteum-profiler__actions">
                        <select
                            aria-label="Performance top window"
                            className="proteum-profiler__select"
                            onChange={(event) => void profilerRuntime.refreshPerf({ since: event.currentTarget.value })}
                            value={perf.since}
                        >
                            {perfWindowPresets.map((windowPreset) => (
                                <option key={`since:${windowPreset}`} value={windowPreset}>
                                    since {windowPreset}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Performance baseline window"
                            className="proteum-profiler__select"
                            onChange={(event) => void profilerRuntime.refreshPerf({ baseline: event.currentTarget.value })}
                            value={perf.baseline}
                        >
                            {perfWindowPresets.map((windowPreset) => (
                                <option key={`baseline:${windowPreset}`} value={windowPreset}>
                                    baseline {windowPreset}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Performance target window"
                            className="proteum-profiler__select"
                            onChange={(event) => void profilerRuntime.refreshPerf({ target: event.currentTarget.value })}
                            value={perf.target}
                        >
                            {perfWindowPresets.map((windowPreset) => (
                                <option key={`target:${windowPreset}`} value={windowPreset}>
                                    target {windowPreset}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Performance grouping"
                            className="proteum-profiler__select"
                            onChange={(event) => void profilerRuntime.refreshPerf({ groupBy: event.currentTarget.value as (typeof perfGroupByValues)[number] })}
                            value={perf.groupBy}
                        >
                            {perfGroupByValues.map((groupBy) => (
                                <option key={`group:${groupBy}`} value={groupBy}>
                                    group {groupBy}
                                </option>
                            ))}
                        </select>
                        <button className="proteum-profiler__pill" onClick={() => void profilerRuntime.refreshPerf()} type="button">
                            Refresh
                        </button>
                    </div>
                </div>

                {perf.errorMessage ? (
                    <div className="proteum-profiler__row">
                        <div className="proteum-profiler__rowHeader">
                            <strong>Last perf panel error</strong>
                        </div>
                        <div className="proteum-profiler__mono">{perf.errorMessage}</div>
                    </div>
                ) : null}

                {perf.status === 'loading' && !perf.top && !currentRequest ? (
                    <div className="proteum-profiler__empty">Loading performance data...</div>
                ) : (
                    <>
                        <div className="proteum-profiler__metrics">
                            <SummaryRow
                                label="Window"
                                value={
                                    perf.top
                                        ? `${perf.top.window.label} (${perf.top.window.requestCount}/${perf.top.window.availableRequestCount})`
                                        : perf.since
                                }
                            />
                            <SummaryRow label="Group By" value={perf.groupBy} />
                            <SummaryRow label="Avg" value={perf.top ? formatDuration(perf.top.summary.avgDurationMs) : 'n/a'} />
                            <SummaryRow label="P95" value={perf.top ? formatDuration(perf.top.summary.p95DurationMs) : 'n/a'} />
                            <SummaryRow label="CPU" value={perf.top ? formatDuration(perf.top.summary.avgCpuMs) : 'n/a'} />
                            <SummaryRow label="Heap" value={perf.top ? formatSignedBytes(perf.top.summary.avgHeapDeltaBytes) : 'n/a'} />
                            <SummaryRow
                                label="Current Request"
                                value={currentRequest ? `${currentRequest.requestId} ${formatDuration(currentRequest.totalDurationMs)}` : 'No request'}
                            />
                            <SummaryRow label="Refreshed" value={perf.lastLoadedAt ? formatTimestamp(perf.lastLoadedAt) : 'Not loaded'} />
                        </div>

                        {currentRequest ? (
                            <>
                                <WaterfallChart
                                    emptyLabel="No request stages were captured."
                                    itemLabel="stage"
                                    items={waterfallItems}
                                />
                                <div className="proteum-profiler__metrics">
                                    <SummaryRow label="Route" value={currentRequest.routeLabel} />
                                    <SummaryRow label="Controller" value={currentRequest.controllerLabel} />
                                    <SummaryRow label="Total" value={formatDuration(currentRequest.totalDurationMs)} />
                                    <SummaryRow label="SQL" value={`${currentRequest.sqlCount} / ${formatDuration(currentRequest.sqlDurationMs)}`} />
                                    <SummaryRow label="Calls" value={`${currentRequest.callCount} / ${formatDuration(currentRequest.callDurationMs)}`} />
                                    <SummaryRow
                                        label="Render"
                                        value={`${formatDuration(currentRequest.renderDurationMs)} / ${formatBytes(currentRequest.ssrPayloadBytes)}`}
                                    />
                                    <SummaryRow label="CPU" value={formatDuration(currentRequest.cpuTotalMs)} />
                                    <SummaryRow label="Heap" value={formatSignedBytes(currentRequest.heapDeltaBytes)} />
                                </div>
                            </>
                        ) : (
                            <div className="proteum-profiler__empty">No traced request is attached to this session yet.</div>
                        )}

                        <div className="proteum-profiler__chartGrid">
                            <ChartSection
                                emptyLabel="No hot-path latency data matched this window."
                                options={topLatencyChart}
                                subtitle={`Compare average and p95 latency across the hottest ${perf.groupBy}s.`}
                                title={`Hot ${perf.groupBy}s`}
                            />
                            <ChartSection
                                emptyLabel="No breakdown data matched this window."
                                options={topBreakdownChart}
                                subtitle="See whether self time, SQL, external calls, or render work dominates the response."
                                title="Time Breakdown"
                            />
                            <ChartSection
                                emptyLabel="No compare data matched these windows."
                                options={compareChart}
                                subtitle={`Track p95 regression pressure between ${perf.baseline} and ${perf.target}.`}
                                title="Regression Delta"
                            />
                            <ChartSection
                                emptyLabel="No memory drift data matched this window."
                                options={memoryChart}
                                subtitle="Compare average heap growth, peak heap growth, and average RSS drift per group."
                                title="Memory Drift"
                            />
                        </div>

                        <SimpleSection empty="No hot calls captured for this request." rows={callRows} title="Current Request Calls" />
                        <SimpleSection empty="No hot SQL captured for this request." rows={sqlRows} title="Current Request SQL" />
                        <SimpleSection empty="No perf rollups matched this window." rows={topRows} title={`Hot ${perf.groupBy}s`} />
                        <SimpleSection empty="No compare deltas matched these windows." rows={compareRows} title="Compare" />
                        <SimpleSection empty="No memory drift data matched this window." rows={memoryRows} title="Memory" />
                    </>
                )}
            </div>
        );
    }

    if (panel === 'auth') {
        return <AuthPanel session={session} />;
    }

    if (panel === 'routing') {
        const routingEvents = findTraceEvents(primaryTrace, [
            'resolve.start',
            'resolve.controller-route',
            'resolve.route-match',
            'resolve.route-skip',
            'resolve.routes-evaluated',
            'resolve.not-found',
        ]);
        const routingFlowChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.blue,
            entries: buildCountEntries(routingEvents.map((event) => event.type.replace(/^resolve\./, ''))),
            title: 'Resolve event flow',
            valueUnit: 'Events',
        });
        const routingTimelineChart =
            routingEvents.length === 0
                ? undefined
                : createProfilerColumnChartOptions({
                      categories: routingEvents.map((event) => truncate(event.type.replace(/^resolve\./, ''), 22)),
                      colors: [profilerChartTheme.indigo],
                      height: 300,
                      series: [{ data: routingEvents.map((event) => toRoundedNumber(event.elapsedMs)), name: 'Elapsed ms' }],
                      title: 'Resolve milestone timing',
                      valueUnit: 'Milliseconds',
                  });
        const routingDecisionChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.amber,
            entries: buildCountEntries(
                routingEvents.map((event) => {
                    if (event.type === 'resolve.route-skip') {
                        return `skip:${readString(event.details.reason) || readString(event.details.code) || 'unknown'}`;
                    }

                    if (event.type === 'resolve.route-match') {
                        return `match:${readString(event.details.path) || readString(event.details.routePath) || 'route'}`;
                    }

                    if (event.type === 'resolve.controller-route') {
                        return `controller:${readString(event.details.httpPath) || readString(event.details.routePath) || 'route'}`;
                    }

                    return event.type.replace(/^resolve\./, '');
                }),
            ),
            title: 'Resolve decisions',
            valueUnit: 'Events',
        });

        return (
            <>
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No routing events were captured yet."
                        options={routingFlowChart}
                        subtitle="Summarize the current request’s resolve flow without reading each trace event."
                        title="Resolve Flow"
                    />
                    <ChartSection
                        emptyLabel="No routing milestones were captured yet."
                        options={routingTimelineChart}
                        subtitle="Order the resolve milestones by elapsed time to spot slow route decisions."
                        title="Resolve Timing"
                    />
                    <ChartSection
                        emptyLabel="No routing decisions were captured yet."
                        options={routingDecisionChart}
                        subtitle="Highlight skip reasons, matched routes, and controller routing outcomes."
                        title="Decisions"
                    />
                </div>

                <SimpleSection
                    empty="No routing data captured yet."
                    rows={routingEvents.map((event) => ({
                        key: `${event.index}:${event.type}`,
                        title: event.type,
                        value: Object.entries(event.details)
                            .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                            .join(' '),
                    }))}
                    showTitle={false}
                    title="Routing"
                />
            </>
        );
    }

    if (panel === 'controller') {
        const controllerEvents = findTraceEvents(primaryTrace, ['controller.start', 'controller.result', 'setup.options', 'context.create']);
        const controllerFlowChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.indigo,
            entries: buildCountEntries(controllerEvents.map((event) => event.type.replace(/\./g, ' '))),
            title: 'Controller lifecycle',
            valueUnit: 'Events',
        });
        const controllerTimelineChart =
            controllerEvents.length === 0
                ? undefined
                : createProfilerColumnChartOptions({
                      categories: controllerEvents.map((event) => truncate(event.type.replace(/\./g, ' '), 22)),
                      colors: [profilerChartTheme.teal],
                      height: 300,
                      series: [{ data: controllerEvents.map((event) => toRoundedNumber(event.elapsedMs)), name: 'Elapsed ms' }],
                      title: 'Lifecycle timing',
                      valueUnit: 'Milliseconds',
                  });
        const controllerDetailChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.cyan,
            entries: buildCountEntries(
                controllerEvents.flatMap((event) => Object.keys(event.details).map((key) => `${event.type}:${key}`)),
            ),
            title: 'Detail coverage',
            valueUnit: 'Fields',
        });

        return (
            <>
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No controller events were captured yet."
                        options={controllerFlowChart}
                        subtitle="See which controller phases are present in the traced request."
                        title="Lifecycle"
                    />
                    <ChartSection
                        emptyLabel="No controller timing data was captured yet."
                        options={controllerTimelineChart}
                        subtitle="Compare elapsed time at each controller milestone."
                        title="Timing"
                    />
                    <ChartSection
                        emptyLabel="No controller event details were captured yet."
                        options={controllerDetailChart}
                        subtitle="Highlight which detail fields are most common across controller events."
                        title="Detail Keys"
                    />
                </div>

                <SimpleSection
                    empty="No controller data captured yet."
                    rows={controllerEvents.map((event) => ({
                        key: `${event.index}:${event.type}`,
                        title: event.type,
                        value: Object.entries(event.details)
                            .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                            .join(' '),
                    }))}
                    showTitle={false}
                    title="Controller"
                />
            </>
        );
    }

    if (panel === 'ssr') {
        const ssrEvents = findTraceEvents(primaryTrace, ['page.data', 'ssr.payload', 'render.start', 'render.end']);
        const recentSsrRows = state.sessions
            .slice(-10)
            .map((candidate) => ({ session: candidate, summary: getSummary(candidate) }))
            .filter(({ summary: candidateSummary }) => candidateSummary.renderMs !== undefined || candidateSummary.ssrPayloadBytes !== undefined);
        const ssrScatterChart = buildScatterChartOptions({
            color: profilerChartTheme.amber,
            points: recentSsrRows.map(({ summary: candidateSummary }) => ({
                x: toRoundedNumber(candidateSummary.renderMs),
                y: toKilobytes(candidateSummary.ssrPayloadBytes, 2),
            })),
            seriesName: 'Session',
            title: 'Render vs payload',
            xaxisTitle: 'Render ms',
            yaxisTitle: 'Payload KB',
        });
        const payloadChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.teal,
            entries: buildTopEntries(
                recentSsrRows.map(({ summary: candidateSummary }) => ({
                    label: candidateSummary.routeLabel,
                    value: toKilobytes(candidateSummary.ssrPayloadBytes, 2),
                })),
                8,
            ),
            title: 'Largest payloads',
            valueUnit: 'KB',
        });
        const renderTrendChart = buildLineChartOptions({
            color: profilerChartTheme.orange,
            entries: recentSsrRows.map(({ session: candidate, summary: candidateSummary }) => ({
                label: getSessionChartLabel(candidate, candidateSummary),
                value: candidateSummary.renderMs || 0,
            })),
            title: 'Recent render time',
            valueUnit: 'Milliseconds',
        });

        return (
            <>
                <div className="proteum-profiler__chartGrid">
                    <ChartSection
                        emptyLabel="No SSR timing and payload data was captured yet."
                        options={ssrScatterChart}
                        subtitle="Correlate render cost with payload size across recent navigations."
                        title="Render vs Payload"
                    />
                    <ChartSection
                        emptyLabel="No SSR payload sizes were captured yet."
                        options={payloadChart}
                        subtitle="Rank the largest payload producers from the recent session window."
                        title="Payload Pressure"
                    />
                    <ChartSection
                        emptyLabel="No SSR render timings were captured yet."
                        options={renderTrendChart}
                        subtitle="Track render time across the last few SSR sessions."
                        title="Render Trend"
                    />
                </div>

                <SimpleSection
                    empty="No SSR data captured for this session."
                    rows={ssrEvents.map((event) => ({
                        key: `${event.index}:${event.type}`,
                        title: event.type,
                        value: Object.entries(event.details)
                            .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                            .join(' '),
                    }))}
                    showTitle={false}
                    title="SSR"
                />
            </>
        );
    }

    if (panel === 'api') {
        return <ApiPanel session={session} />;
    }

    if (panel === 'sql') {
        return <SqlPanel session={session} />;
    }

    if (panel === 'diagnose') {
        const diagnose = state.diagnose;
        const response = diagnose.response;
        const suspectScoreChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.red,
            entries:
                response?.suspects.map((suspect) => ({
                    label: suspect.label,
                    value: suspect.score,
                })) || [],
            title: 'Suspect scoring',
            valueUnit: 'Score',
        });
        const ownerScoreChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.indigo,
            entries:
                response?.owner.matches.map((match) => ({
                    label: `[${match.kind}] ${match.label}`,
                    value: match.score,
                })) || [],
            title: 'Owner confidence',
            valueUnit: 'Score',
        });
        const diagnoseSeverityChart =
            response === undefined
                ? undefined
                : createProfilerColumnChartOptions({
                      categories: ['Errors', 'Warnings'],
                      colors: [profilerChartTheme.red, profilerChartTheme.amber],
                      height: 300,
                      series: [
                          {
                              data: [response.doctor.summary.errors, response.doctor.summary.warnings],
                              name: 'Doctor',
                          },
                          {
                              data: [response.contracts.summary.errors, response.contracts.summary.warnings],
                              name: 'Contracts',
                          },
                      ],
                      title: 'Diagnostic severity',
                      valueUnit: 'Count',
                  });
        const suspectRows =
            response?.suspects.map((suspect, index) => ({
                key: `suspect:${index}`,
                title: `${suspect.score} · ${suspect.label}`,
                value: `${suspect.filepath}${formatManifestLocation(suspect.line, suspect.column)} reasons=${suspect.reasons.join(', ')}`,
            })) || [];
        const ownerRows =
            response?.owner.matches.map((match, index) => ({
                key: `owner:${index}`,
                title: `[${match.kind}] ${match.label}`,
                value: `score=${match.score} source=${formatOwnerSource(match)} matchedOn=${match.matchedOn.join(', ') || 'n/a'}`,
            })) || [];
        const contractRows =
            response?.contracts.diagnostics.map((diagnostic, index) => ({
                key: `contract:${diagnostic.code}:${index}`,
                title: `[${diagnostic.level}] ${diagnostic.code}`,
                value: `${diagnostic.message} source=${diagnostic.filepath}${formatManifestLocation(
                    diagnostic.sourceLocation?.line,
                    diagnostic.sourceLocation?.column,
                )}`,
            })) || [];
        const logRows =
            response?.serverLogs.logs.map((entry, index) => ({
                key: `log:${index}`,
                title: `[${entry.level}] ${formatTimestamp(entry.time)}`,
                value: truncate(entry.text, 220),
            })) || [];

        return (
            <div className="proteum-profiler__section">
                <div className="proteum-profiler__sectionHeader">
                    <div className="proteum-profiler__sectionTitle">Diagnose</div>
                    <div className="proteum-profiler__actions">
                        <button className="proteum-profiler__pill" onClick={() => void profilerRuntime.refreshDiagnose(session.id)} type="button">
                            Refresh
                        </button>
                    </div>
                </div>

                {diagnose.errorMessage ? (
                    <div className="proteum-profiler__row">
                        <div className="proteum-profiler__rowHeader">
                            <strong>Last diagnose panel error</strong>
                        </div>
                        <div className="proteum-profiler__mono">{diagnose.errorMessage}</div>
                    </div>
                ) : null}

                {diagnose.status === 'loading' && !response ? (
                    <div className="proteum-profiler__empty">Loading diagnose data...</div>
                ) : !response ? (
                    <div className="proteum-profiler__empty">No diagnose data is available for this session yet.</div>
                ) : (
                    <>
                        <div className="proteum-profiler__metrics">
                            <SummaryRow label="Query" value={response.query} />
                            <SummaryRow label="Request" value={response.request ? summarizeTraceForDiagnose(response.request) : 'No trace'} />
                            <SummaryRow label="Doctor" value={`${response.doctor.summary.errors} errors / ${response.doctor.summary.warnings} warnings`} />
                            <SummaryRow label="Contracts" value={`${response.contracts.summary.errors} errors / ${response.contracts.summary.warnings} warnings`} />
                            <SummaryRow
                                label="Refreshed"
                                value={diagnose.lastLoadedAt ? formatTimestamp(diagnose.lastLoadedAt) : 'Not loaded'}
                            />
                        </div>
                        <div className="proteum-profiler__chartGrid">
                            <ChartSection
                                emptyLabel="No suspect scores were returned for this diagnose run."
                                options={suspectScoreChart}
                                subtitle="Rank the files Proteum currently believes are most likely involved."
                                title="Suspects"
                            />
                            <ChartSection
                                emptyLabel="No owner matches were returned for this diagnose run."
                                options={ownerScoreChart}
                                subtitle="Compare owner candidates and their confidence scores."
                                title="Owner Matches"
                            />
                            <ChartSection
                                emptyLabel="No diagnose severity data was returned for this run."
                                options={diagnoseSeverityChart}
                                subtitle="Compare doctor diagnostics against contract diagnostics in one view."
                                title="Severity"
                            />
                        </div>
                        <SimpleSection empty="No likely suspect files were found." rows={suspectRows} title="Suspects" />
                        <SimpleSection empty="No owner matches were found." rows={ownerRows} title="Owner Matches" />
                        <SimpleSection empty="No contract diagnostics were found." rows={contractRows} title="Contracts" />
                        <SimpleSection empty="No recent server logs were captured." rows={logRows} title="Server Logs" />
                    </>
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
        const manifest = explain.manifest;
        const structureChart = manifest
            ? buildColumnChartOptions({
                  colors: [profilerChartTheme.blue],
                  entries: [
                      { label: 'app services', value: manifest.services.app.length },
                      { label: 'router plugins', value: manifest.services.routerPlugins.length },
                      { label: 'controllers', value: manifest.controllers.length },
                      { label: 'commands', value: manifest.commands.length },
                      { label: 'client routes', value: manifest.routes.client.length },
                      { label: 'server routes', value: manifest.routes.server.length },
                      { label: 'layouts', value: manifest.layouts.length },
                      { label: 'diagnostics', value: manifest.diagnostics.length },
                  ],
                  title: 'Manifest structure',
                  valueUnit: 'Count',
              })
            : undefined;
        const manifestScopeChart = manifest
            ? buildColumnChartOptions({
                  colors: [profilerChartTheme.indigo],
                  entries: [
                      {
                          label: 'app',
                          value: [
                              ...manifest.services.app,
                              ...manifest.services.routerPlugins,
                              ...manifest.controllers,
                              ...manifest.commands,
                              ...manifest.routes.client,
                              ...manifest.routes.server,
                              ...manifest.layouts,
                          ].filter((entry) => entry.scope === 'app').length,
                      },
                      {
                          label: 'framework',
                          value: [
                              ...manifest.services.app,
                              ...manifest.services.routerPlugins,
                              ...manifest.controllers,
                              ...manifest.commands,
                              ...manifest.routes.client,
                              ...manifest.routes.server,
                              ...manifest.layouts,
                          ].filter((entry) => entry.scope === 'framework').length,
                      },
                  ],
                  title: 'Scope split',
                  valueUnit: 'Entries',
              })
            : undefined;
        const envReadinessChart = manifest
            ? buildColumnChartOptions({
                  colors: [profilerChartTheme.green, profilerChartTheme.red],
                  entries: [
                      {
                          label: 'provided',
                          value: manifest.env.requiredVariables.filter((variable) => variable.provided).length,
                      },
                      {
                          label: 'missing',
                          value: manifest.env.requiredVariables.filter((variable) => !variable.provided).length,
                      },
                  ],
                  title: 'Env readiness',
                  valueUnit: 'Variables',
              })
            : undefined;

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
                        <div className="proteum-profiler__chartGrid">
                            <ChartSection
                                emptyLabel="No manifest structure data is available."
                                options={structureChart}
                                subtitle="Summarize the main object counts in the current Proteum manifest."
                                title="Structure"
                            />
                            <ChartSection
                                emptyLabel="No manifest scope data is available."
                                options={manifestScopeChart}
                                subtitle="Show how much of the current manifest comes from app code vs framework code."
                                title="Scope Split"
                            />
                            <ChartSection
                                emptyLabel="No manifest env readiness data is available."
                                options={envReadinessChart}
                                subtitle="Check required variable coverage before digging through the raw manifest."
                                title="Env Ready"
                            />
                        </div>

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
        const doctorSeverityChart =
            doctor.response === undefined
                ? undefined
                : createProfilerColumnChartOptions({
                      categories: ['Errors', 'Warnings'],
                      colors: [profilerChartTheme.red, profilerChartTheme.amber],
                      height: 300,
                      series: [
                          {
                              data: [doctor.response.summary.errors, doctor.response.summary.warnings],
                              name: 'Doctor',
                          },
                          {
                              data: [
                                  doctor.contracts?.summary.errors || 0,
                                  doctor.contracts?.summary.warnings || 0,
                              ],
                              name: 'Contracts',
                          },
                      ],
                      title: 'Severity overview',
                      valueUnit: 'Count',
                  });
        const doctorCodeChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.orange,
            entries: buildCountEntries(doctor.response?.diagnostics.map((diagnostic) => diagnostic.code) || []),
            title: 'Diagnostic codes',
            valueUnit: 'Hits',
        });
        const doctorFileChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.cyan,
            entries: buildCountEntries(doctor.response?.diagnostics.map((diagnostic) => diagnostic.filepath) || []),
            title: 'Hot files',
            valueUnit: 'Diagnostics',
        });
        const contractRows =
            doctor.contracts?.diagnostics.map((diagnostic, index) => ({
                key: `contract:${diagnostic.code}:${index}`,
                title: `[${diagnostic.level}] ${diagnostic.code}`,
                value: `${diagnostic.message} source=${diagnostic.filepath}${formatManifestLocation(
                    diagnostic.sourceLocation?.line,
                    diagnostic.sourceLocation?.column,
                )}${diagnostic.relatedFilepaths?.length ? ` related=${diagnostic.relatedFilepaths.join(',')}` : ''}`,
            })) || [];
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
                            <SummaryRow
                                label="Contracts"
                                value={
                                    doctor.contracts
                                        ? `${doctor.contracts.summary.errors} errors / ${doctor.contracts.summary.warnings} warnings`
                                        : 'not loaded'
                                }
                            />
                            <SummaryRow label="Strict" value={doctor.response.summary.strictFailed ? 'failed' : 'ok'} />
                            <SummaryRow
                                label="Refreshed"
                                value={doctor.lastLoadedAt ? formatTimestamp(doctor.lastLoadedAt) : 'Not loaded'}
                            />
                        </div>
                        <div className="proteum-profiler__chartGrid">
                            <ChartSection
                                emptyLabel="No doctor severity data is available."
                                options={doctorSeverityChart}
                                subtitle="Compare doctor and contract diagnostics across errors and warnings."
                                title="Severity"
                            />
                            <ChartSection
                                emptyLabel="No diagnostic codes are available."
                                options={doctorCodeChart}
                                subtitle="See which diagnostic families are dominating the current manifest."
                                title="Codes"
                            />
                            <ChartSection
                                emptyLabel="No diagnostic file hotspots are available."
                                options={doctorFileChart}
                                subtitle="Highlight the files attracting the most diagnostics."
                                title="Files"
                            />
                        </div>
                        {doctorBlocks.length > 0 ? (
                            <TextBlocks blocks={doctorBlocks} />
                        ) : (
                            <SimpleSection empty="No manifest diagnostics were found." rows={doctorRows} title="Diagnostics" />
                        )}
                        <SimpleSection empty="No contract diagnostics were found." rows={contractRows} title="Contracts" />
                    </>
                )}
            </div>
        );
    }

    if (panel === 'commands') {
        const commandsState = state.commands;
        const commandScopeChart = buildColumnChartOptions({
            colors: [profilerChartTheme.indigo],
            entries: buildCountEntries(commandsState.commands.map((command) => command.scope)),
            title: 'Command scope split',
            valueUnit: 'Commands',
        });
        const commandDurationChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.blue,
            entries: buildTopEntries(
                commandsState.commands
                    .map((command) => ({
                        label: command.path,
                        value: commandsState.executions[command.path]?.durationMs || 0,
                    }))
                    .filter((entry) => entry.value > 0),
            ),
            title: 'Latest execution duration',
            valueUnit: 'Milliseconds',
        });
        const commandStatusChart = buildColumnChartOptions({
            colors: [profilerChartTheme.green],
            entries: buildCountEntries(
                commandsState.commands.map((command) => commandsState.executions[command.path]?.status || 'never-run'),
            ),
            title: 'Execution status',
            valueUnit: 'Commands',
        });

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
                    <>
                        <div className="proteum-profiler__chartGrid">
                            <ChartSection
                                emptyLabel="No command scope data is available."
                                options={commandScopeChart}
                                subtitle="Show how the registered dev commands split between app and framework scopes."
                                title="Scope"
                            />
                            <ChartSection
                                emptyLabel="No command execution durations have been captured yet."
                                options={commandDurationChart}
                                subtitle="Highlight the commands with the slowest latest execution."
                                title="Latest Duration"
                            />
                            <ChartSection
                                emptyLabel="No command execution statuses have been captured yet."
                                options={commandStatusChart}
                                subtitle="Separate commands that have never run from completed or failed commands."
                                title="Status"
                            />
                        </div>

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
                    </>
                )}
            </div>
        );
    }

    if (panel === 'cron') {
        const cron = state.cron;
        const cronRunCountChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.blue,
            entries: buildTopEntries(cron.tasks.map((task) => ({ label: task.name, value: task.runCount }))),
            title: 'Run counts',
            valueUnit: 'Runs',
        });
        const cronDurationChart = buildHorizontalBarChartOptions({
            color: profilerChartTheme.orange,
            entries: buildTopEntries(
                cron.tasks
                    .map((task) => ({ label: task.name, value: task.lastRunDurationMs || 0 }))
                    .filter((entry) => entry.value > 0),
            ),
            title: 'Last run duration',
            valueUnit: 'Milliseconds',
        });
        const cronStatusChart = buildColumnChartOptions({
            colors: [profilerChartTheme.teal],
            entries: buildCountEntries(
                cron.tasks.map((task) => (task.running ? 'running' : task.lastRunStatus || 'never-run')),
            ),
            title: 'Task status',
            valueUnit: 'Tasks',
        });

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
                    <>
                        <div className="proteum-profiler__chartGrid">
                            <ChartSection
                                emptyLabel="No cron run counts are available."
                                options={cronRunCountChart}
                                subtitle="Highlight which tasks have been exercised the most in the current dev session."
                                title="Runs"
                            />
                            <ChartSection
                                emptyLabel="No cron duration data is available."
                                options={cronDurationChart}
                                subtitle="Compare the latest duration of tasks that have been executed."
                                title="Duration"
                            />
                            <ChartSection
                                emptyLabel="No cron status data is available."
                                options={cronStatusChart}
                                subtitle="Separate currently running, completed, failed, and never-run tasks."
                                title="Status"
                            />
                        </div>

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
                    </>
                )}
            </div>
        );
    }

    const stepErrors = session.steps
            .filter((step) => step.status === 'error')
            .map((step) => ({ key: step.id, title: step.label, value: step.errorMessage || 'Step failed' }));
    const traceErrors = session.traces
            .filter((trace) => trace.status === 'error')
            .map((trace) => ({ key: trace.id, title: trace.label, value: trace.errorMessage || 'Request failed' }));
    const eventErrors = findTraceEvents(primaryTrace, ['error']).map((event) => ({
            key: `${event.index}:error`,
            title: event.type,
            value: Object.entries(event.details)
                .map(([key, value]) => `${key}=${renderSummaryValue(value)}`)
                .join(' '),
        }));
    const errorRows = [...stepErrors, ...traceErrors, ...eventErrors];
    const errorSourceChart = buildColumnChartOptions({
        colors: [profilerChartTheme.red],
        entries: [
            { label: 'steps', value: stepErrors.length },
            { label: 'traces', value: traceErrors.length },
            { label: 'events', value: eventErrors.length },
        ],
        title: 'Error sources',
        valueUnit: 'Errors',
    });
    const errorLabelChart = buildHorizontalBarChartOptions({
        color: profilerChartTheme.orange,
        entries: buildCountEntries(errorRows.map((row) => row.title)),
        title: 'Error groups',
        valueUnit: 'Errors',
    });

    return (
        <>
            <div className="proteum-profiler__chartGrid">
                <ChartSection
                    emptyLabel="No errors were captured for this session."
                    options={errorSourceChart}
                    subtitle="Split captured failures between navigation steps, requests, and trace events."
                    title="Sources"
                />
                <ChartSection
                    emptyLabel="No grouped error labels were captured for this session."
                    options={errorLabelChart}
                    subtitle="Highlight the error families that are repeating in the selected session."
                    title="Groups"
                />
            </div>

            <SimpleSection empty="No errors captured." rows={errorRows} showTitle={false} title="Errors" />
        </>
    );
};

const splitScrollPanels = new Set<TProfilerPanel>(['timeline', 'auth', 'api', 'sql']);

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
    const currentPerfRequest = primaryTrace ? buildRequestPerformance(primaryTrace) : undefined;
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

                            <div
                                className={`proteum-profiler__panelBody ${
                                    splitScrollPanels.has(state.activePanel) ? 'proteum-profiler__panelBody--split' : ''
                                }`}
                            >
                                {renderPanel(state.activePanel, session, summary, state)}
                            </div>
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
                        <StatusToken
                            label={`SQL ${summary.sqlCount}`}
                            onClick={() => profilerRuntime.openPanel('sql')}
                            tone={summary.sqlCount > 0 ? 'ok' : 'warn'}
                        />
                        <StatusToken
                            label={
                                currentPerfRequest
                                    ? `Perf ${formatDuration(currentPerfRequest.cpuTotalMs)} ${formatSignedBytes(currentPerfRequest.heapDeltaBytes)}`
                                    : 'Perf'
                            }
                            onClick={() => profilerRuntime.openPanel('perf')}
                            tone={currentPerfRequest?.heapDeltaBytes && currentPerfRequest.heapDeltaBytes > 0 ? 'warn' : 'ok'}
                        />
                        {summary.errorCount > 0 ? (
                            <StatusToken
                                label={`${summary.errorCount} error${summary.errorCount === 1 ? '' : 's'}`}
                                onClick={() => profilerRuntime.openPanel('errors')}
                                tone="error"
                            />
                        ) : null}
                        <StatusToken
                            label="Diagnose"
                            onClick={() => profilerRuntime.openPanel('diagnose')}
                            tone={summary.errorCount > 0 ? 'error' : 'warn'}
                        />
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
