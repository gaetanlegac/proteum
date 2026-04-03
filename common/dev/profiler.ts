import type { TRequestTrace } from './requestTrace';

export const profilerTraceRequestIdHeader = 'x-proteum-trace-request-id';
export const profilerSessionIdHeader = 'x-proteum-profiler-session-id';
export const profilerOriginHeader = 'x-proteum-profiler-origin';
export const profilerParentRequestIdHeader = 'x-proteum-profiler-parent-request-id';
export const profilerConnectedNamespaceHeader = 'x-proteum-profiler-connected-namespace';

export type TProfilerUiState = 'expanded' | 'minimized' | 'pinned-handle';
export type TProfilerPanel =
    | 'summary'
    | 'timeline'
    | 'perf'
    | 'auth'
    | 'routing'
    | 'controller'
    | 'ssr'
    | 'api'
    | 'sql'
    | 'diagnose'
    | 'explain'
    | 'doctor'
    | 'commands'
    | 'cron'
    | 'errors';
export type TProfilerNavigationSessionKind = 'initial-ssr' | 'client-navigation';
export type TProfilerSessionTraceKind = 'initial-root' | 'navigation-data' | 'async';
export type TProfilerNavigationStepStatus = 'pending' | 'completed' | 'error';
export type TProfilerCronTaskTrigger = 'scheduler' | 'manual' | 'autoexec';
export type TProfilerCronTaskRunStatus = 'completed' | 'error';

export type TProfilerCronTaskFrequency =
    | { kind: 'cron'; value: string }
    | { kind: 'date'; value: string };

export type TProfilerCronTask = {
    name: string;
    registeredAt: string;
    frequency: TProfilerCronTaskFrequency;
    autoexec: boolean;
    automaticExecution: boolean;
    nextInvocation?: string;
    running: boolean;
    lastTrigger?: TProfilerCronTaskTrigger;
    lastRunStartedAt?: string;
    lastRunFinishedAt?: string;
    lastRunDurationMs?: number;
    lastRunStatus?: TProfilerCronTaskRunStatus;
    lastErrorMessage?: string;
    runCount: number;
};

export type TProfilerNavigationStep = {
    id: string;
    label: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    status: TProfilerNavigationStepStatus;
    details?: { [key: string]: string | number | boolean };
    errorMessage?: string;
};

export type TProfilerSessionTrace = {
    id: string;
    kind: TProfilerSessionTraceKind;
    label: string;
    method: string;
    path: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    status: 'pending' | 'completed' | 'error';
    requestId?: string;
    fetcherIds?: string[];
    trace?: TRequestTrace;
    errorMessage?: string;
};

export type TProfilerNavigationSession = {
    id: string;
    kind: TProfilerNavigationSessionKind;
    label: string;
    path: string;
    url: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    status: 'active' | 'completed' | 'error';
    requestId?: string;
    routeLabel?: string;
    routeChunkId?: string;
    title?: string;
    steps: TProfilerNavigationStep[];
    traces: TProfilerSessionTrace[];
};
