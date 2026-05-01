/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Specific
import type { Application } from '../index';
import type { Command } from '../commands';
import type { TRouterContext, TAnyRouter } from '../../services/router';

export { schema } from '../../services/router/request/validation/zod';
export type { z } from '../../services/router/request/validation/zod';

/*----------------------------------
- TYPES: OPTIONS
----------------------------------*/

export type AnyService = Service<{}, {}, Application, any>;
export type AnyServiceClass = ClassType<AnyService>;

/*----------------------------------
- TYPES: HOOKS
----------------------------------*/

export type THookCallback<THookArgs extends THookOptions> = (...args: THookArgs['args']) => Promise<void>;

type THooksList = { [hookName: string]: THookOptions };

type THookOptions = { args: any[] };

export type THooksIndex<THooks extends THooksList> = { [name in keyof THooks]?: THookCallback<THooks[name]>[] };

export type StartedServicesIndex = { [serviceId: string]: AnyService };

type TServiceRouter<TApplication extends Application> = TApplication extends { Router: infer TRouter }
    ? TRouter extends TAnyRouter
        ? TRouter
        : TAnyRouter
    : TAnyRouter;

/**
 * @deprecated Services should not depend on request context.
 * Resolve auth/input/request data in controllers and pass explicit typed values into services instead.
 */
export type TServiceRequestContext<TApplication extends Application = Application> = TRouterContext<
    TServiceRouter<TApplication>
>;

export type TServiceModelsClient<TApplication extends Application = Application> = TApplication extends {
    Models: { client: infer TModels };
}
    ? TModels
    : TApplication extends {
            models: { client: infer TModels };
        }
      ? TModels
      : never;

export type TSetupConfig<TConfig> = TConfig extends (...args: any[]) => any
    ? TConfig
    : TConfig extends AnyService
      ? TConfig
    : TConfig extends Array<infer TItem>
      ? Array<TSetupConfig<TItem>>
      : TConfig extends object
        ? { [K in keyof TConfig]?: TSetupConfig<TConfig[K]> }
        : TConfig;

export type TServiceArgs<TService extends { config: any; app: any; parent: any }> = [
    parent: TService['parent'] | 'self',
    config: null | undefined | TSetupConfig<TService['config']>,
    app: TService['app'] | 'self',
];

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = '[service]';

const resolveSelfReference = <TSelf extends object, TValue extends object>(
    value: TValue | 'self',
    self: TSelf,
): TValue | (TSelf & TValue) => (value === 'self' ? (self as TSelf & TValue) : value);

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class Service<
    TConfig extends {},
    THooks extends THooksList,
    TApplication extends Application = Application,
    TParent extends object = AnyService,
> {
    public started?: Promise<void>;
    public starting?: Promise<void>;
    public status: 'stopped' | 'starting' | 'running' | 'paused' = 'starting';

    public commands?: Command[];
    public bindings: string[] = [];

    public parent: TParent;
    public app: TApplication;
    public config: TConfig = {} as TConfig;

    public constructor(
        parent: TParent | 'self',
        config: null | undefined | TSetupConfig<TConfig>,
        app: TApplication | 'self',
    ) {
        this.parent = resolveSelfReference(parent, this) as TParent;

        this.app = resolveSelfReference(app, this) as TApplication;

        this.config = (config || {}) as TConfig;
    }

    public getServiceInstance() {
        return this;
    }

    public get services(): TApplication {
        return this.app;
    }

    public get models(): TServiceModelsClient<TApplication> {
        const app = this.app as {
            models?: { client?: TServiceModelsClient<TApplication> };
            Models?: { client?: TServiceModelsClient<TApplication> };
        };
        const models = app.models?.client ?? app.Models?.client;

        if (!models)
            throw new Error(`${this.constructor.name} tried to access models but no Models service is registered.`);

        return models;
    }

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    protected async ready(): Promise<any> {}

    protected async shutdown(): Promise<any> {}

    /*----------------------------------
    - SUBSERVICES
    ----------------------------------*/

    public use<TService extends AnyService = AnyService>(
        serviceId: string,
        useOptions: { optional?: boolean } = {},
    ): TService | undefined {
        const app = this.app as {
            findService?: (serviceId: string) => AnyService | undefined;
        } & Record<string, unknown>;
        const service = app.findService?.(serviceId);
        if (service !== undefined) return service as TService;

        if (useOptions.optional === false) throw new Error(`Service ${serviceId} not registered.`);

        return undefined;
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/

    public hooks: THooksIndex<THooks> = {};

    public on<THookName extends keyof THooksList>(name: THookName, callback: THookCallback<THooksList[THookName]>) {
        const callbacks = this.hooks[name];
        if (callbacks) callbacks.push(callback);
        else this.hooks[name] = [callback];

        return this;
    }

    public runHook<THookName extends keyof THooksList>(name: THookName, ...args: THooksList[THookName]['args']) {
        const callbacks = this.hooks[name];
        if (!callbacks) return; // console.info(LogPrefix, `No ${name} hook defined in the current service instance.`);

        //this.config.debug && console.info(`[hook] Run all ${name} hook (${callbacks.length}).`);
        return Promise.all(callbacks.map((cb) => cb(...args)))
            .then(() => {
                //this.config.debug && console.info(`[hook] Hooks ${name} executed with success.`);
            })
            .catch((e) => {
                if (name === 'error') {
                    // In error hook = avoid infinite loop
                    console.error('Error hook', e);
                } else {
                    // Let the error hook handle it
                    throw e;
                }
            });
    }
}
