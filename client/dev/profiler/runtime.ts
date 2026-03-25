import {
    profilerOriginHeader,
    profilerParentRequestIdHeader,
    profilerSessionIdHeader,
    profilerTraceRequestIdHeader,
    type TProfilerCronTask,
    type TProfilerNavigationSession,
    type TProfilerNavigationStep,
    type TProfilerPanel,
    type TProfilerSessionTrace,
    type TProfilerSessionTraceKind,
    type TProfilerUiState,
} from '@common/dev/profiler';
import type { TDevCommandDefinition, TDevCommandExecution } from '@common/dev/commands';
import type { TDoctorResponse } from '@common/dev/diagnostics';
import type { TProteumManifest } from '@common/dev/proteumManifest';
import type { TRequestTrace } from '@common/dev/requestTrace';

type TProfilerCommandsState = {
    commands: TDevCommandDefinition[];
    errorMessage?: string;
    executions: { [path: string]: TDevCommandExecution };
    lastLoadedAt?: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
};

type TProfilerCronState = {
    automaticExecution: boolean;
    errorMessage?: string;
    lastLoadedAt?: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
    tasks: TProfilerCronTask[];
};

type TProfilerDoctorState = {
    errorMessage?: string;
    lastLoadedAt?: string;
    response?: TDoctorResponse;
    status: 'idle' | 'loading' | 'ready' | 'error';
};

type TProfilerExplainState = {
    errorMessage?: string;
    lastLoadedAt?: string;
    manifest?: TProteumManifest;
    status: 'idle' | 'loading' | 'ready' | 'error';
};

type TProfilerState = {
    activePanel: TProfilerPanel;
    commands: TProfilerCommandsState;
    cron: TProfilerCronState;
    doctor: TProfilerDoctorState;
    explain: TProfilerExplainState;
    currentSessionId?: string;
    selectedSessionId?: string;
    sessions: TProfilerNavigationSession[];
    uiState: TProfilerUiState;
};

type TStartTraceInput = {
    fetcherIds?: string[];
    label: string;
    method: string;
    path: string;
    requestId?: string;
    sessionId?: string;
};

const profilerStorageKey = 'proteum.dev.profiler.ui-state';
const nowIso = () => new Date().toISOString();
const durationMs = (startedAt: string, finishedAt: string) => Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
const safeSessionStorage =
    typeof window !== 'undefined'
        ? {
              get: (key: string) => {
                  try {
                      return window.sessionStorage.getItem(key);
                  } catch (error) {
                      return null;
                  }
              },
              set: (key: string, value: string) => {
                  try {
                      window.sessionStorage.setItem(key, value);
                  } catch (error) {}
              },
          }
        : { get: (_key: string) => null, set: (_key: string, _value: string) => undefined };

const isProfilerUiState = (value: string | null): value is TProfilerUiState =>
    value === 'expanded' || value === 'minimized' || value === 'pinned-handle';

const initialUiState = () => {
    const stored = safeSessionStorage.get(profilerStorageKey);
    return isProfilerUiState(stored) ? stored : 'minimized';
};

const cloneCommand = (command: TDevCommandDefinition) => ({ ...command, sourceLocation: { ...command.sourceLocation } });
const cloneCommandExecution = (execution: TDevCommandExecution): TDevCommandExecution => ({
    ...execution,
    command: cloneCommand(execution.command),
    result: execution.result
        ? {
              ...execution.result,
              json: execution.result.json === undefined ? undefined : JSON.parse(JSON.stringify(execution.result.json)),
              summary: execution.result.summary,
          }
        : undefined,
});
const cloneCronTask = (task: TProfilerCronTask) => ({ ...task, frequency: { ...task.frequency } });
const cloneDoctorResponse = (response: TDoctorResponse): TDoctorResponse => JSON.parse(JSON.stringify(response)) as TDoctorResponse;
const cloneManifest = (manifest: TProteumManifest): TProteumManifest => JSON.parse(JSON.stringify(manifest)) as TProteumManifest;
const cloneStep = (step: TProfilerNavigationStep) => ({ ...step, details: step.details ? { ...step.details } : undefined });
const cloneTrace = (trace: TProfilerSessionTrace) => ({ ...trace });
const cloneSession = (session: TProfilerNavigationSession) => ({
    ...session,
    steps: session.steps.map(cloneStep),
    traces: session.traces.map(cloneTrace),
});
const cloneCronState = (cron: TProfilerCronState) => ({
    ...cron,
    tasks: cron.tasks.map(cloneCronTask),
});
const cloneDoctorState = (doctor: TProfilerDoctorState) => ({
    ...doctor,
    response: doctor.response ? cloneDoctorResponse(doctor.response) : undefined,
});
const cloneExplainState = (explain: TProfilerExplainState) => ({
    ...explain,
    manifest: explain.manifest ? cloneManifest(explain.manifest) : undefined,
});
const cloneCommandsState = (commands: TProfilerCommandsState) => ({
    ...commands,
    commands: commands.commands.map(cloneCommand),
    executions: Object.fromEntries(
        Object.entries(commands.executions).map(([commandPath, execution]) => [commandPath, cloneCommandExecution(execution)]),
    ),
});

class ProfilerRuntime {
    private listeners = new Set<() => void>();
    private navigationCounter = 0;
    private stepCounter = 0;
    private traceCounter = 0;
    private traceFetches = new Map<string, Promise<TRequestTrace | undefined>>();
    private state: TProfilerState = {
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
        doctor: {
            status: 'idle',
        },
        explain: {
            status: 'idle',
        },
        sessions: [],
        uiState: initialUiState(),
    };

    public subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    public getState = () => this.state;

    public setUiState(nextState: TProfilerUiState) {
        this.state = { ...this.state, uiState: nextState };
        safeSessionStorage.set(profilerStorageKey, nextState);
        this.emit();
    }

    public openPanel(panel: TProfilerPanel) {
        this.state = { ...this.state, activePanel: panel, uiState: 'expanded' };
        safeSessionStorage.set(profilerStorageKey, 'expanded');
        this.emit();
        if (panel === 'commands') void this.refreshCommands();
        if (panel === 'cron') void this.refreshCronTasks();
        if (panel === 'doctor') void this.refreshDoctor();
        if (panel === 'doctor' || panel === 'explain') void this.refreshExplain();
    }

    public selectSession(sessionId: string) {
        this.state = { ...this.state, selectedSessionId: sessionId };
        this.emit();
    }

    public async refreshCommands() {
        this.state = {
            ...this.state,
            commands: {
                ...this.state.commands,
                errorMessage: undefined,
                status: 'loading',
            },
        };
        this.emit();

        try {
            const response = await fetch('/__proteum/commands', { cache: 'no-store' });
            const body = (await response.json()) as {
                commands?: TDevCommandDefinition[];
                error?: string;
            };

            if (!response.ok) {
                throw new Error(body.error || 'Failed to load commands.');
            }

            this.state = {
                ...this.state,
                commands: {
                    ...this.state.commands,
                    commands: Array.isArray(body.commands) ? body.commands.map(cloneCommand) : [],
                    errorMessage: undefined,
                    lastLoadedAt: nowIso(),
                    status: 'ready',
                },
            };
            this.emit();
        } catch (error) {
            this.state = {
                ...this.state,
                commands: {
                    ...this.state.commands,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                },
            };
            this.emit();
        }
    }

    public async runCommand(commandPath: string) {
        this.state = {
            ...this.state,
            commands: {
                ...this.state.commands,
                errorMessage: undefined,
            },
        };
        this.emit();

        try {
            const response = await fetch('/__proteum/commands/run', {
                body: JSON.stringify({ path: commandPath }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            const body = (await response.json()) as {
                error?: string;
                execution?: TDevCommandExecution;
            };

            this.state = {
                ...this.state,
                commands: {
                    ...this.state.commands,
                    errorMessage: response.ok ? undefined : body.error || 'Failed to run command.',
                    executions:
                        body.execution === undefined
                            ? { ...this.state.commands.executions }
                            : {
                                  ...this.state.commands.executions,
                                  [commandPath]: cloneCommandExecution(body.execution),
                              },
                    status: response.ok ? 'ready' : 'error',
                },
            };
            this.emit();

            if (response.ok) {
                await this.refreshCommands();
            }
        } catch (error) {
            this.state = {
                ...this.state,
                commands: {
                    ...this.state.commands,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                },
            };
            this.emit();
        }
    }

    public async refreshCronTasks() {
        this.state = {
            ...this.state,
            cron: {
                ...this.state.cron,
                errorMessage: undefined,
                status: 'loading',
            },
        };
        this.emit();

        try {
            const response = await fetch('/__proteum/cron/tasks', { cache: 'no-store' });
            const body = (await response.json()) as {
                automaticExecution?: boolean;
                error?: string;
                tasks?: TProfilerCronTask[];
            };

            if (!response.ok) {
                throw new Error(body.error || 'Failed to load cron tasks.');
            }

            this.state = {
                ...this.state,
                cron: {
                    automaticExecution: body.automaticExecution ?? false,
                    errorMessage: undefined,
                    lastLoadedAt: nowIso(),
                    status: 'ready',
                    tasks: Array.isArray(body.tasks) ? body.tasks.map(cloneCronTask) : [],
                },
            };
            this.emit();
        } catch (error) {
            this.state = {
                ...this.state,
                cron: {
                    ...this.state.cron,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                },
            };
            this.emit();
        }
    }

    public async refreshDoctor() {
        this.state = {
            ...this.state,
            doctor: {
                ...this.state.doctor,
                errorMessage: undefined,
                status: 'loading',
            },
        };
        this.emit();

        try {
            const response = await fetch('/__proteum/doctor', { cache: 'no-store' });
            const body = (await response.json()) as TDoctorResponse & { error?: string };

            if (!response.ok) {
                throw new Error(body.error || 'Failed to load doctor diagnostics.');
            }

            this.state = {
                ...this.state,
                doctor: {
                    errorMessage: undefined,
                    lastLoadedAt: nowIso(),
                    response: cloneDoctorResponse(body),
                    status: 'ready',
                },
            };
            this.emit();
        } catch (error) {
            this.state = {
                ...this.state,
                doctor: {
                    ...this.state.doctor,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                },
            };
            this.emit();
        }
    }

    public async refreshExplain() {
        this.state = {
            ...this.state,
            explain: {
                ...this.state.explain,
                errorMessage: undefined,
                status: 'loading',
            },
        };
        this.emit();

        try {
            const response = await fetch('/__proteum/explain', { cache: 'no-store' });
            const body = (await response.json()) as TProteumManifest & { error?: string };

            if (!response.ok) {
                throw new Error(body.error || 'Failed to load explain data.');
            }

            this.state = {
                ...this.state,
                explain: {
                    errorMessage: undefined,
                    lastLoadedAt: nowIso(),
                    manifest: cloneManifest(body),
                    status: 'ready',
                },
            };
            this.emit();
        } catch (error) {
            this.state = {
                ...this.state,
                explain: {
                    ...this.state.explain,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                },
            };
            this.emit();
        }
    }

    public async runCronTask(name: string) {
        this.state = {
            ...this.state,
            cron: {
                ...this.state.cron,
                errorMessage: undefined,
                tasks: this.state.cron.tasks.map((task) => (task.name === name ? { ...task, running: true } : cloneCronTask(task))),
            },
        };
        this.emit();

        try {
            const response = await fetch('/__proteum/cron/tasks/run', {
                body: JSON.stringify({ name }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            const body = (await response.json()) as {
                error?: string;
                task?: TProfilerCronTask;
            };

            const nextTasks = this.state.cron.tasks.map((task) =>
                task.name === name && body.task ? cloneCronTask(body.task) : cloneCronTask(task),
            );

            this.state = {
                ...this.state,
                cron: {
                    ...this.state.cron,
                    errorMessage: response.ok ? undefined : body.error || 'Failed to run cron task.',
                    status: response.ok ? 'ready' : 'error',
                    tasks: nextTasks,
                },
            };
            this.emit();

            if (response.ok) {
                await this.refreshCronTasks();
            }
        } catch (error) {
            this.state = {
                ...this.state,
                cron: {
                    ...this.state.cron,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                },
            };
            this.emit();
        }
    }

    public ensureInitialSession(input: { path: string; requestId?: string; url: string }) {
        if (this.state.sessions.some((session) => session.id === 'initial-ssr')) return;

        const session: TProfilerNavigationSession = {
            id: 'initial-ssr',
            kind: 'initial-ssr',
            label: input.path,
            path: input.path,
            url: input.url,
            startedAt: nowIso(),
            status: 'completed',
            requestId: input.requestId,
            steps: [this.createStep('Hydrate')],
            traces: input.requestId
                ? [
                      {
                          id: this.nextTraceId(),
                          kind: 'initial-root',
                          label: 'Initial SSR request',
                          method: 'GET',
                          path: input.path,
                          requestId: input.requestId,
                          startedAt: nowIso(),
                          status: 'pending',
                      },
                  ]
                : [],
        };

        this.state = {
            ...this.state,
            currentSessionId: session.id,
            selectedSessionId: session.id,
            sessions: [...this.state.sessions, session],
        };
        this.emit();

        if (input.requestId) void this.attachTraceByRequestId(session.id, session.traces[0]?.id, input.requestId);
    }

    public markInitialHydrated(meta: { chunkId?: string; title?: string }) {
        const session = this.getSession('initial-ssr');
        if (!session) return;

        const hydrateStep = session.steps[0];
        if (hydrateStep && hydrateStep.finishedAt === undefined) {
            hydrateStep.finishedAt = nowIso();
            hydrateStep.durationMs = durationMs(hydrateStep.startedAt, hydrateStep.finishedAt);
            hydrateStep.status = 'completed';
        }

        session.routeChunkId = meta.chunkId || session.routeChunkId;
        session.title = meta.title || session.title;
        this.commitSession(session);
    }

    public startNavigationSession(input: { path: string; url: string }) {
        const sessionId = `nav:${++this.navigationCounter}`;
        const session: TProfilerNavigationSession = {
            id: sessionId,
            kind: 'client-navigation',
            label: `NAV ${input.path}`,
            path: input.path,
            url: input.url,
            startedAt: nowIso(),
            status: 'active',
            steps: [this.createStep('Resolve route')],
            traces: [],
        };

        this.state = {
            ...this.state,
            currentSessionId: session.id,
            selectedSessionId: session.id,
            sessions: [...this.state.sessions, session],
        };
        this.emit();

        return session.id;
    }

    public completeResolveStep(meta: { chunkId?: string; routeLabel?: string; sessionId?: string }) {
        const session = this.getSession(meta.sessionId || this.state.currentSessionId);
        if (!session) return;

        const resolveStep = session.steps.find((step) => step.label === 'Resolve route' && step.finishedAt === undefined);
        if (resolveStep) {
            resolveStep.finishedAt = nowIso();
            resolveStep.durationMs = durationMs(resolveStep.startedAt, resolveStep.finishedAt);
            resolveStep.status = 'completed';
            resolveStep.details = {
                ...(resolveStep.details || {}),
                ...(meta.chunkId ? { chunkId: meta.chunkId } : {}),
                ...(meta.routeLabel ? { route: meta.routeLabel } : {}),
            };
        }

        if (meta.chunkId) session.routeChunkId = meta.chunkId;
        if (meta.routeLabel) session.routeLabel = meta.routeLabel;
        this.commitSession(session);
    }

    public startChunkStep(chunkId: string, sessionId?: string) {
        const session = this.getSession(sessionId || this.state.currentSessionId);
        if (!session) return undefined;

        const step = this.createStep(`Load chunk ${chunkId}`, { chunkId });
        session.steps.push(step);
        this.commitSession(session);
        return step.id;
    }

    public finishStep(stepId: string | undefined, status: 'completed' | 'error' = 'completed', errorMessage?: string) {
        if (!stepId) return;

        for (const session of this.state.sessions) {
            const step = session.steps.find((candidate) => candidate.id === stepId);
            if (!step || step.finishedAt) continue;

            step.finishedAt = nowIso();
            step.durationMs = durationMs(step.startedAt, step.finishedAt);
            step.status = status;
            step.errorMessage = errorMessage;
            this.commitSession(session);
            return;
        }
    }

    public startRenderStep(sessionId?: string) {
        const session = this.getSession(sessionId || this.state.currentSessionId);
        if (!session) return undefined;

        const step = this.createStep('Render');
        session.steps.push(step);
        this.commitSession(session);
        return step.id;
    }

    public finishNavigation(meta: { chunkId?: string; routeLabel?: string; sessionId?: string; title?: string }) {
        const session = this.getSession(meta.sessionId || this.state.currentSessionId);
        if (!session) return;

        const renderStep = [...session.steps].reverse().find((step) => step.label === 'Render' && step.finishedAt === undefined);
        if (renderStep) {
            renderStep.finishedAt = nowIso();
            renderStep.durationMs = durationMs(renderStep.startedAt, renderStep.finishedAt);
            renderStep.status = 'completed';
        }

        session.finishedAt = nowIso();
        session.durationMs = durationMs(session.startedAt, session.finishedAt);
        session.status = session.steps.some((step) => step.status === 'error') ? 'error' : 'completed';
        session.routeChunkId = meta.chunkId || session.routeChunkId;
        session.routeLabel = meta.routeLabel || session.routeLabel;
        session.title = meta.title || session.title;
        this.commitSession(session);
    }

    public failNavigation(message: string, sessionId?: string) {
        const session = this.getSession(sessionId || this.state.currentSessionId);
        if (!session) return;

        const pendingStep = [...session.steps].reverse().find((step) => step.finishedAt === undefined);
        if (pendingStep) {
            pendingStep.finishedAt = nowIso();
            pendingStep.durationMs = durationMs(pendingStep.startedAt, pendingStep.finishedAt);
            pendingStep.status = 'error';
            pendingStep.errorMessage = message;
        }

        session.finishedAt = nowIso();
        session.durationMs = durationMs(session.startedAt, session.finishedAt);
        session.status = 'error';
        this.commitSession(session);
    }

    public startTrace(kind: TProfilerSessionTraceKind, input: TStartTraceInput) {
        const session = this.getSession(input.sessionId || this.getAttachmentSessionId());
        if (!session) return undefined;

        const trace: TProfilerSessionTrace = {
            id: this.nextTraceId(),
            kind,
            label: input.label,
            method: input.method,
            path: input.path,
            requestId: input.requestId,
            fetcherIds: input.fetcherIds,
            startedAt: nowIso(),
            status: 'pending',
        };

        session.traces.push(trace);
        this.commitSession(session);
        return { sessionId: session.id, traceId: trace.id };
    }

    public completeTrace(traceId: string | undefined, meta: { durationMs?: number; errorMessage?: string; status?: 'completed' | 'error' }) {
        if (!traceId) return;

        for (const session of this.state.sessions) {
            const trace = session.traces.find((candidate) => candidate.id === traceId);
            if (!trace) continue;

            trace.finishedAt = nowIso();
            trace.durationMs = meta.durationMs ?? durationMs(trace.startedAt, trace.finishedAt);
            trace.status = meta.status || 'completed';
            trace.errorMessage = meta.errorMessage;
            this.commitSession(session);
            return;
        }
    }

    public async attachTraceByRequestId(sessionId: string | undefined, traceId: string | undefined, requestId: string | undefined) {
        if (!sessionId || !traceId || !requestId) return;

        const session = this.getSession(sessionId);
        const traceRef = session?.traces.find((candidate) => candidate.id === traceId);
        if (!session || !traceRef) return;

        traceRef.requestId = requestId;
        if (traceRef.kind !== 'async') session.requestId = session.requestId || requestId;
        this.commitSession(session);

        const trace = await this.fetchTrace(requestId);
        if (!trace) return;

        const nextSession = this.getSession(sessionId);
        const nextTraceRef = nextSession?.traces.find((candidate) => candidate.id === traceId);
        if (!nextSession || !nextTraceRef) return;

        nextTraceRef.trace = trace;
        nextTraceRef.method = trace.method;
        nextTraceRef.path = trace.path;
        nextTraceRef.startedAt = trace.startedAt;
        nextTraceRef.finishedAt = trace.finishedAt;
        nextTraceRef.durationMs = trace.durationMs;
        nextTraceRef.status =
            trace.errorMessage || (trace.statusCode !== undefined && trace.statusCode >= 400) ? 'error' : 'completed';
        nextTraceRef.errorMessage = trace.errorMessage;

        if (nextTraceRef.kind !== 'async') {
            nextSession.requestId = trace.id;
            nextSession.routeLabel = nextSession.routeLabel || this.findRouteLabel(trace);
            nextSession.title = nextSession.title || this.findRenderTitle(trace);
            nextSession.routeChunkId = nextSession.routeChunkId || this.findRouteChunkId(trace);
        }

        this.commitSession(nextSession);
    }

    public getRequestHeaders(origin: string) {
        const session = this.getSession(this.getAttachmentSessionId());
        if (!session) return {};

        const headers: Record<string, string> = {
            [profilerSessionIdHeader]: session.id,
            [profilerOriginHeader]: origin,
        };

        const parentRequestId = this.getParentRequestId(session);
        if (parentRequestId) headers[profilerParentRequestIdHeader] = parentRequestId;

        return headers;
    }

    private createStep(label: string, details?: TProfilerNavigationStep['details']): TProfilerNavigationStep {
        return {
            id: `step:${++this.stepCounter}`,
            label,
            startedAt: nowIso(),
            status: 'pending',
            details,
        };
    }

    private nextTraceId() {
        return `trace:${++this.traceCounter}`;
    }

    private getAttachmentSessionId() {
        return this.state.currentSessionId || this.state.selectedSessionId || this.state.sessions[this.state.sessions.length - 1]?.id;
    }

    private getParentRequestId(session: TProfilerNavigationSession) {
        if (session.requestId) return session.requestId;

        for (let index = this.state.sessions.length - 1; index >= 0; index -= 1) {
            const candidate = this.state.sessions[index];
            if (candidate.id === session.id) continue;
            if (candidate.requestId) return candidate.requestId;
        }

        return undefined;
    }

    private getSession(sessionId?: string) {
        if (!sessionId) return undefined;
        return this.state.sessions.find((session) => session.id === sessionId);
    }

    private commitSession(session: TProfilerNavigationSession) {
        this.state = {
            ...this.state,
            commands: cloneCommandsState(this.state.commands),
            cron: cloneCronState(this.state.cron),
            doctor: cloneDoctorState(this.state.doctor),
            explain: cloneExplainState(this.state.explain),
            sessions: this.state.sessions.map((candidate) => (candidate.id === session.id ? cloneSession(session) : candidate)),
        };
        this.emit();
    }

    private emit() {
        for (const listener of this.listeners) listener();
    }

    private async fetchTrace(requestId: string) {
        const existing = this.traceFetches.get(requestId);
        if (existing) return existing;

        const fetchPromise = fetch(`/__proteum/trace/requests/${requestId}`, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) return undefined;
                const body = (await response.json()) as { request?: TRequestTrace };
                return body.request;
            })
            .catch((_error) => undefined);

        this.traceFetches.set(requestId, fetchPromise);
        return fetchPromise;
    }

    private findRenderTitle(trace: TRequestTrace) {
        const title = trace.events.find((event) => event.type === 'render.start')?.details.title;
        return typeof title === 'string' ? title : undefined;
    }

    private findRouteChunkId(trace: TRequestTrace) {
        const chunkId = trace.events.find((event) => event.type === 'render.start')?.details.chunkId;
        return typeof chunkId === 'string' ? chunkId : undefined;
    }

    private findRouteLabel(trace: TRequestTrace) {
        const routeEvent =
            trace.events.find((event) => event.type === 'resolve.route-match') ||
            trace.events.find((event) => event.type === 'resolve.controller-route');
        if (!routeEvent) return undefined;

        const routeId = routeEvent.details.routeId;
        if (typeof routeId === 'string' && routeId) return routeId;

        const routePath = routeEvent.details.routePath || routeEvent.details.path;
        return typeof routePath === 'string' && routePath ? routePath : undefined;
    }
}

export const profilerRuntime = new ProfilerRuntime();

export const readProfilerTraceRequestId = (response: Response) => response.headers.get(profilerTraceRequestIdHeader) || undefined;
