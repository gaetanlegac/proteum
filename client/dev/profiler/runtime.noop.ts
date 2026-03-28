import type {
    TProfilerCronTask,
    TProfilerNavigationSession,
    TProfilerPanel,
    TProfilerSessionTraceKind,
    TProfilerUiState,
} from '@common/dev/profiler';
import type { TDevCommandDefinition, TDevCommandExecution } from '@common/dev/commands';
import type { TDoctorResponse } from '@common/dev/diagnostics';
import type { TDiagnoseResponse } from '@common/dev/inspection';
import type { TProteumManifest } from '@common/dev/proteumManifest';

type TProfilerState = {
    activePanel: TProfilerPanel;
    commands: {
        commands: TDevCommandDefinition[];
        errorMessage?: string;
        executions: { [path: string]: TDevCommandExecution };
        lastLoadedAt?: string;
        status: 'idle' | 'loading' | 'ready' | 'error';
    };
    cron: {
        automaticExecution: boolean;
        errorMessage?: string;
        lastLoadedAt?: string;
        status: 'idle' | 'loading' | 'ready' | 'error';
        tasks: TProfilerCronTask[];
    };
    diagnose: {
        errorMessage?: string;
        lastLoadedAt?: string;
        response?: TDiagnoseResponse;
        status: 'idle' | 'loading' | 'ready' | 'error';
    };
    doctor: {
        contracts?: TDoctorResponse;
        errorMessage?: string;
        lastLoadedAt?: string;
        response?: TDoctorResponse;
        status: 'idle' | 'loading' | 'ready' | 'error';
    };
    explain: {
        errorMessage?: string;
        lastLoadedAt?: string;
        manifest?: TProteumManifest;
        status: 'idle' | 'loading' | 'ready' | 'error';
    };
    currentSessionId?: string;
    selectedSessionId?: string;
    sessions: TProfilerNavigationSession[];
    uiState: TProfilerUiState;
};

const noopState: TProfilerState = {
    activePanel: 'summary',
    commands: {
        commands: [],
        executions: {},
        status: 'idle',
    },
    cron: {
        automaticExecution: false,
        status: 'idle',
        tasks: [],
    },
    diagnose: {
        status: 'idle',
    },
    doctor: {
        status: 'idle',
    },
    explain: {
        status: 'idle',
    },
    sessions: [],
    uiState: 'minimized',
};

export const profilerRuntime = {
    subscribe: (_listener: () => void) => () => undefined,
    getState: () => noopState,
    setUiState: (_nextState: TProfilerUiState) => undefined,
    openPanel: (_panel: TProfilerPanel) => undefined,
    selectSession: (_sessionId: string) => undefined,
    refreshCommands: async () => undefined,
    runCommand: async (_path: string) => undefined,
    refreshCronTasks: async () => undefined,
    runCronTask: async (_name: string) => undefined,
    refreshDiagnose: async (_sessionId?: string) => undefined,
    refreshDoctor: async () => undefined,
    refreshExplain: async () => undefined,
    ensureInitialSession: (_input: { path: string; requestId?: string; url: string }) => undefined,
    markInitialHydrated: (_meta: { chunkId?: string; title?: string }) => undefined,
    startNavigationSession: (_input: { path: string; url: string }) => undefined as string | undefined,
    completeResolveStep: (_meta: { chunkId?: string; routeLabel?: string; sessionId?: string }) => undefined,
    startChunkStep: (_chunkId: string, _sessionId?: string) => undefined as string | undefined,
    finishStep: (
        _stepId: string | undefined,
        _status: 'completed' | 'error' = 'completed',
        _errorMessage?: string,
    ) => undefined,
    startRenderStep: (_sessionId?: string) => undefined as string | undefined,
    finishNavigation: (_meta: { chunkId?: string; routeLabel?: string; sessionId?: string; title?: string }) => undefined,
    failNavigation: (_message: string, _sessionId?: string) => undefined,
    startTrace: (
        _kind: TProfilerSessionTraceKind,
        _input: {
            fetcherIds?: string[];
            label: string;
            method: string;
            path: string;
            requestId?: string;
            sessionId?: string;
        },
    ) => undefined as { sessionId: string; traceId: string } | undefined,
    completeTrace: (
        _traceId: string | undefined,
        _meta: { durationMs?: number; errorMessage?: string; status?: 'completed' | 'error' },
    ) => undefined,
    attachTraceByRequestId: async (
        _sessionId: string | undefined,
        _traceId: string | undefined,
        _requestId: string | undefined,
    ) => undefined,
    getRequestHeaders: (_origin: string) => ({}),
};

export const readProfilerTraceRequestId = (_response: Response) => undefined;
