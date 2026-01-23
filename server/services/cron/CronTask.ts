/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import cronParser, { CronExpression } from 'cron-parser';

/*----------------------------------
- TYPES
----------------------------------*/

import type CronManager from '.';

export type TFrequence = string | Date;
export type TRunner = () => Promise<any>

/*----------------------------------
- CLASS
----------------------------------*/
export default class CronTask {

    public cron?: CronExpression
    public nextInvocation?: Date;

    public constructor(
        private manager: CronManager,
        public nom: string,
        next: TFrequence,
        public runner: TRunner,
        public autoexec?: boolean
    ) {

        this.manager.config.debug && console.info(`[cron][${this.nom}] Enregistrement de la tâche`);

        this.schedule(next);

    }

    public schedule(next: TFrequence) {

        this.cron = undefined;

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
        if (this.cron !== undefined)
            this.nextInvocation = this.cron.next().toDate();
        else
            this.nextInvocation = undefined;
    }

    public run(now: boolean = false) {

        // Update invocation date
        const maintenant = new Date
        const runnable = this.nextInvocation !== undefined && this.nextInvocation.valueOf() <= maintenant.valueOf()
        if (runnable)
            this.scheduleNext();
        else if (now === false)
            return;

        // Execution
        this.runner().then(() => {
            this.manager.config.debug && console.info(`Task runned.`);
        })
    }
}