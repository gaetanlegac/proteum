/*----------------------------------
- DEPENDANCES
----------------------------------*/

import { Command as ClipanionCommand, Option, UsageError } from 'clipanion';
import type CurrentCommandApplication from '@/server/index';

/*----------------------------------
- TYPES
----------------------------------*/

export type TCommandApplication = {
    env?: {
        profile?: string;
        name?: string;
        [key: string]: unknown;
    };
    identity?: {
        identifier?: string;
        [key: string]: unknown;
    };
    getRootServices?: () => Record<string, unknown>;
    findService?: (serviceId: string) => unknown;
    models?: unknown;
    Models?: unknown;
};

export type TCommandService = {
    [key: string]: unknown;
};

/*----------------------------------
- COMMAND CLASSES
----------------------------------*/

export abstract class Commands<TApplication extends TCommandApplication = CurrentCommandApplication> {
    public app: CurrentCommandApplication;

    public constructor(app: CurrentCommandApplication) {
        this.app = app;
    }

    public get services(): CurrentCommandApplication {
        return this.app;
    }

    public get models(): any {
        const app = this.app as {
            models?: { client?: any };
            Models?: { client?: any };
        };
        const models = app.models?.client ?? app.Models?.client;

        if (!models)
            throw new Error(`${this.constructor.name} tried to access models but no Models service is registered.`);

        return models;
    }
}

export { ClipanionCommand as Command, Option, UsageError };
