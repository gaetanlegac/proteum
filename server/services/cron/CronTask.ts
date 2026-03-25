/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import cronParser, { CronExpression } from 'cron-parser';

/*----------------------------------
- TYPES
----------------------------------*/

import type CronManager from '.';
import type {
    TProfilerCronTask,
    TProfilerCronTaskFrequency,
    TProfilerCronTaskRunStatus,
    TProfilerCronTaskTrigger,
} from '@common/dev/profiler';

export type TFrequence = string | Date;
export type TRunner = () => Promise<any>;
const nowIso = () => new Date().toISOString();

/*----------------------------------
- CLASS
----------------------------------*/
export default class CronTask {
    public cron?: CronExpression;
    public frequency!: TProfilerCronTaskFrequency;
    public nextInvocation?: Date;
    public registeredAt = nowIso();
    public running = false;
    public lastTrigger?: TProfilerCronTaskTrigger;
    public lastRunStartedAt?: string;
    public lastRunFinishedAt?: string;
    public lastRunDurationMs?: number;
    public lastRunStatus?: TProfilerCronTaskRunStatus;
    public lastErrorMessage?: string;
    public runCount = 0;

    public constructor(
        private manager: CronManager,
        public nom: string,
        next: TFrequence,
        public runner: TRunner,
        public autoexec?: boolean,
    ) {
        this.manager.config.debug && console.info(`[cron][${this.nom}] Enregistrement de la tâche`);

        this.schedule(next);
    }

    public schedule(next: TFrequence) {
        this.cron = undefined;
        this.frequency =
            typeof next === 'string'
                ? { kind: 'cron', value: next }
                : { kind: 'date', value: next.toISOString() };

        // Cron expression
        if (typeof next === 'string') {
            this.cron = cronParser.parseExpression(next);
            this.nextInvocation = this.cron.next().toDate();

            this.manager.config.debug &&
                console.info(`[cron][${this.nom}] Planifié pour ${this.nextInvocation.toISOString()} via cron ${next}`);

            // Date
        } else {
            this.nextInvocation = next;
            this.manager.config.debug &&
                console.info(`[cron][${this.nom}] Planifié pour ${this.nextInvocation.toISOString()} via date`);
        }
    }

    public scheduleNext() {
        // Prochaine invocation
        if (this.cron !== undefined) this.nextInvocation = this.cron.next().toDate();
        else this.nextInvocation = undefined;
    }

    public toProfilerTask(): TProfilerCronTask {
        return {
            name: this.nom,
            registeredAt: this.registeredAt,
            frequency: this.frequency,
            autoexec: Boolean(this.autoexec),
            automaticExecution: this.manager.isAutomaticExecutionEnabled(),
            nextInvocation: this.nextInvocation?.toISOString(),
            running: this.running,
            lastTrigger: this.lastTrigger,
            lastRunStartedAt: this.lastRunStartedAt,
            lastRunFinishedAt: this.lastRunFinishedAt,
            lastRunDurationMs: this.lastRunDurationMs,
            lastRunStatus: this.lastRunStatus,
            lastErrorMessage: this.lastErrorMessage,
            runCount: this.runCount,
        };
    }

    public async run(now: boolean = false, trigger: TProfilerCronTaskTrigger = 'scheduler') {
        // Update invocation date
        const maintenant = new Date();
        const runnable = this.nextInvocation !== undefined && this.nextInvocation.valueOf() <= maintenant.valueOf();
        if (runnable) this.scheduleNext();
        else if (now === false) return false;

        if (this.running) return false;

        this.running = true;
        this.lastTrigger = trigger;
        const startedAt = nowIso();
        this.lastRunStartedAt = startedAt;
        this.lastRunFinishedAt = undefined;
        this.lastRunDurationMs = undefined;
        this.lastRunStatus = undefined;
        this.lastErrorMessage = undefined;

        // Execution
        try {
            await this.runner();
            this.runCount += 1;
            const finishedAt = nowIso();
            this.lastRunFinishedAt = finishedAt;
            this.lastRunDurationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
            this.lastRunStatus = 'completed';
            this.manager.config.debug && console.info(`[cron][${this.nom}] Task completed.`);
            return true;
        } catch (error) {
            this.runCount += 1;
            const finishedAt = nowIso();
            this.lastRunFinishedAt = finishedAt;
            this.lastRunDurationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
            this.lastRunStatus = 'error';
            this.lastErrorMessage = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            this.running = false;
        }
    }
}
