/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from 'zod';

// Specific
import type { Application } from "..";
import type { Command } from "../commands"; 
import type { TServiceMetas } from './container';
import type { TControllerDefinition, TRoute } from '../../services/router';
import { Anomaly } from "@common/errors";

export { schema } from '../../services/router/request/validation/zod';
export type { z } from '../../services/router/request/validation/zod';

/*----------------------------------
- TYPES: OPTIONS
----------------------------------*/

export type AnyService<TSubServices extends StartedServicesIndex = StartedServicesIndex> = 
    Service<{}, {}, Application>

export type { TRegisteredServicesIndex, TRegisteredService } from './container';

/*----------------------------------
- TYPES: HOOKS
----------------------------------*/

export type THookCallback<THookArgs extends THookOptions> = (...args: THookArgs["args"]) => Promise<void>;

type THooksList = {
    [hookName: string]: THookOptions
}

type THookOptions = {
    args: any[]
}

export type THooksIndex<THooks extends THooksList> = {[name in keyof THooks]?: THookCallback< THooks[name] >[]}

export type StartedServicesIndex = {
    [serviceId: string]: AnyService
}

export type TServiceArgs<TService extends AnyService> = [
    parent: AnyService | 'self',
    config: null | undefined | TService['config'],
    app: TService['app'] | 'self'
]

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = '[service]';

type TDecoratorArgs = (
    [path: string] |
    [path: string, schema: zod.ZodSchema] |
    [path: string, schema: zod.ZodSchema, options?: Omit<TControllerDefinition, 'controller'|'schema'|'path'>] |
    [options: Omit<TControllerDefinition, 'controller'>]
)

export function Route( ...args: TDecoratorArgs ) {

    let path: string | undefined;
    let schema: zod.ZodSchema | undefined;
    let options: Omit<TControllerDefinition, 'controller'|'schema'|'path'> = {};

    if (typeof args[0] === 'object') {
        const { path: path_, schema: schema_, ...options_ } = args[0];
        path = path_;
        schema = schema_;
        options = options_;
    } else {
        path = args[0];
        schema = args[1];
        options = args[2] || {};
    }

    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        // Store the original method
        const originalMethod = descriptor.value;

        if (path === undefined)
            path = target.constructor.name + '/' + propertyKey;

        // Ensure the class has a static property to collect routes
        if (!target.__routes) {
            target.__routes = [];
        }

        // Create route object
        const route: TRoute = {
            method: 'POST',
            path: '/api/' + path,
            controller: originalMethod,
            schema: schema,
            options: {
                priority: options.priority || 0
            }
        };
        
        // Add this route to the class's routes collection
        target.__routes.push(route);

        // Original method is unchanged, just registered with router
        return descriptor;
    };
}

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class Service<
    TConfig extends {}, 
    THooks extends THooksList,
    TApplication extends Application,
    TParent extends AnyService
> {

    public started?: Promise<void>;
    public status: 'stopped' | 'starting' | 'running' | 'paused' = 'starting';

    public commands?: Command[];
    public metas!: TServiceMetas;
    public bindings: string[] = []

    public parent: TParent;
    public app: TApplication;
    public config: TConfig = {} as TConfig;

    public constructor(...[parent, config, app]: TServiceArgs<AnyService>) {

        this.parent = parent;
        if (this.parent === 'self') 
            this.parent = this as unknown as TParent;

        this.app = app === 'self'
            ? this as unknown as TApplication
            : app

        this.config = config || {};
        
    }

    public getServiceInstance() {
        return this;
    }

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    protected async ready(): Promise<void> {}

    protected async shutdown(): Promise<void> {}

    /*----------------------------------
    - SUBSERVICES
    ----------------------------------*/

    // TODO:; babel plugin: transform Service references to app.use('Service')
    public use<TService extends AnyService = AnyService>( 
        serviceId: string,
        useOptions: { optional?: boolean } = {}
    ): TService | undefined {

        const registeredService = this.app.registered[serviceId];
        if (registeredService !== undefined) 
            return this.app[ registeredService.name ];

        if (useOptions.optional === false)
            throw new Error(`Service ${registeredService} not registered.`);

        return undefined;
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/

    public hooks: THooksIndex<THooks> = {}

    public on<THookName extends keyof THooksList>( 
        name: THookName, 
        callback: THookCallback<THooksList[THookName]> 
    ) {

        const callbacks = this.hooks[ name ];
        if (callbacks)
            callbacks.push( callback );
        else
            this.hooks[ name ] = [callback]

        return this;
    }

    public runHook<THookName extends keyof THooksList>( 
        name: THookName, 
        ...args: THooksList[THookName]["args"]
    ) {

        const callbacks = this.hooks[name];
        if (!callbacks)
            return;// console.info(LogPrefix, `No ${name} hook defined in the current service instance.`);

        //this.config.debug && console.info(`[hook] Run all ${name} hook (${callbacks.length}).`);
        return Promise.all( 
            callbacks.map(
                cb => cb(...args)
            ) 
        ).then(() => {
            //this.config.debug && console.info(`[hook] Hooks ${name} executed with success.`);
        }).catch(e => {
            if (name === 'error') {

                // In error hook = avoid infinite loop
                console.error("Error hook", e);

            } else {

                // Let the error hook handle it
                throw e;
            }
        })
    }

}