/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app/index';
import Service from '@server/app/service';
import { NotFound } from '@common/errors';
import type { TProfilerCronTaskTrigger } from '@common/dev/profiler';
import context from '@server/context';

/*----------------------------------
- TYPES
----------------------------------*/

import CronTask, { TRunner, TFrequence } from './CronTask';

export { default as CronTask } from './CronTask';

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

export type Config = { debug?: boolean };

export type Hooks = {};

export type Services = {};

/*----------------------------------
- CLASSE
----------------------------------*/

export default class CronManager extends Service<Config, Hooks, Application, Application> {
    public static taches: { [nom: string]: CronTask } = {};
    public static timer?: NodeJS.Timeout;

    /*----------------------------------
    - LIFECICLE
    ----------------------------------*/

    public async ready() {
        clearInterval(CronManager.timer);
        if (!this.isAutomaticExecutionEnabled()) {
            this.config.debug && console.info('[cron] Automatic execution disabled in dev mode.');
            return;
        }

        CronManager.timer = setInterval(() => {
            for (const id in CronManager.taches) {
                void this.runTask(id, false, 'scheduler').catch((error) => {
                    console.error(`[cron][${id}] Task failed.`, error);
                });
            }
        }, 10000);
    }

    /*----------------------------------
    - STATIQUE
    ----------------------------------*/

    /**
     * Create a new Cron task
     * @param nom Unique ID / Label for this task (helpful for tracking & debugging)
     * @param frequence When to execute this task.
     *  - Date: The date at which to execute this task (one time execution)
     *  - string: Cron expression to define the interval for executing this task
     * @param run Function to run
     * @param autoexec true to execute the task immediatly
     * @returns The CronTask that just have been created
     */
    public async task(nom: string, frequence: TFrequence, run: TRunner, autoexec?: boolean) {
        CronManager.taches[nom] = new CronTask(this, nom, frequence, run, autoexec);

        if (autoexec && this.isAutomaticExecutionEnabled()) await this.runTask(nom, true, 'autoexec');

        return CronManager.taches[nom];
    }

    public async exec(nom: string) {
        const tache = CronManager.taches[nom];

        if (tache === undefined) throw new NotFound('Tâche NotFound: ' + nom);

        await this.runTask(nom, true, 'manual');
        return tache;
    }
    public get(): typeof CronManager.taches;
    public get(name: string): CronTask;
    public get(name?: string): CronTask | typeof CronManager.taches {
        if (name === undefined) return CronManager.taches;

        const cron = CronManager.taches[name];
        if (cron === undefined) throw new Error(`L'instance de la tâche cron ${name} n'a pas été trouvée`);
        return cron;
    }

    public isAutomaticExecutionEnabled() {
        return !__DEV__;
    }

    public listTasks() {
        return Object.values(CronManager.taches).map((task) => task.toProfilerTask());
    }

    private async runTask(name: string, now: boolean, trigger: TProfilerCronTaskTrigger) {
        const task = this.get(name);

        return context.run({ channelType: 'cron', channelId: name }, async () => {
            return task.run(now, trigger);
        });
    }
}
