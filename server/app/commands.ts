/*----------------------------------
- DEPENDANCES
----------------------------------*/

import { Command as ClipanionCommand, Option, UsageError } from 'clipanion';

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
    models?: { client?: object };
    Models?: { client?: object };
};

export type TCommandService = {
    [key: string]: unknown;
};

/*----------------------------------
- COMMAND CLASSES
----------------------------------*/

export abstract class Commands<TApplication extends TCommandApplication = TCommandApplication> {
    public app: TApplication;

    public constructor(app: TApplication) {
        this.app = app;
    }

    public get services(): TApplication {
        return this.app;
    }

    public get models(): object {
        const models = this.app.models?.client ?? this.app.Models?.client;

        if (!models)
            throw new Error(`${this.constructor.name} tried to access models but no Models service is registered.`);

        return models;
    }
}

export { ClipanionCommand as Command, Option, UsageError };
