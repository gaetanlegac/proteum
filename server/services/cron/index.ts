/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app';
import Service from '@server/app/service';
import { NotFound } from '@common/errors';
import context from '@server/context';

/*----------------------------------
- TYPES
----------------------------------*/

import CronTask, { TRunner, TFrequence } from './CronTask';

export { default as CronTask } from './CronTask';

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

export type Config = {
   debug?: boolean
}

export type Hooks = {

}

export type Services = {

}

/*----------------------------------
- CLASSE
----------------------------------*/

export default class CronManager extends Service<Config, Hooks, Application, Application> {

    public static taches: { [nom: string]: CronTask } = {}
    public static timer: NodeJS.Timeout;

    /*----------------------------------
    - LIFECICLE
    ----------------------------------*/

    public async ready() {

        clearInterval(CronManager.timer);
        CronManager.timer = setInterval(() => {

            for (const id in CronManager.taches)
                CronManager.taches[id].run();

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
    public task(nom: string, frequence: TFrequence, run: TRunner, autoexec?: boolean) {
        return new Promise<CronTask>((resolve, reject) => {
            context.run({ channelType: 'cron', channelId: nom }, async () => {

                CronManager.taches[nom] = new CronTask(this, nom, frequence, run, autoexec);

                if (autoexec)
                    await CronManager.taches[nom].run(true);

                resolve( CronManager.taches[nom] );

            })
        });

    }

    public async exec(nom: string) {

        const tache = CronManager.taches[nom];

        if (tache === undefined)
            throw new NotFound("Tâche NotFound: " + nom);

        await tache.run(true);

    }
    public get(): typeof CronManager.taches;
    public get(name: string): CronTask;
    public get(name?: string): CronTask | typeof CronManager.taches {

        if (name === undefined)
            return CronManager.taches;

        const cron = CronManager.taches[name];
        if (cron === undefined)
            throw new Error(`L'instance de la tâche cron ${name} n'a pas été trouvée`);
        return cron;
    }
}