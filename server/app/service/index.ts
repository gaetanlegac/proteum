/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Specific
import type { Application } from "..";
import type { Command } from "../commands";
import type { TServiceMetas } from "./container";
import context from "@server/context";
import type {
  TRouterContext,
  TAnyRouter,
} from "../../services/router/response";

export { schema } from "../../services/router/request/validation/zod";
export type { z } from "../../services/router/request/validation/zod";

/*----------------------------------
- TYPES: OPTIONS
----------------------------------*/

export type AnyService<
  TSubServices extends StartedServicesIndex = StartedServicesIndex,
> = Service<{}, {}, Application>;

export type { TRegisteredServicesIndex, TRegisteredService } from "./container";

/*----------------------------------
- TYPES: HOOKS
----------------------------------*/

export type THookCallback<THookArgs extends THookOptions> = (
  ...args: THookArgs["args"]
) => Promise<void>;

type THooksList = {
  [hookName: string]: THookOptions;
};

type THookOptions = {
  args: any[];
};

export type THooksIndex<THooks extends THooksList> = {
  [name in keyof THooks]?: THookCallback<THooks[name]>[];
};

export type StartedServicesIndex = {
  [serviceId: string]: AnyService;
};

export type TServiceArgs<TService extends AnyService> = [
  parent: AnyService | "self",
  config: null | undefined | TService["config"],
  app: TService["app"] | "self",
];

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = "[service]";

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class Service<
  TConfig extends {},
  THooks extends THooksList,
  TApplication extends Application,
  TParent extends AnyService,
> {
  public started?: Promise<void>;
  public status: "stopped" | "starting" | "running" | "paused" = "starting";

  public commands?: Command[];
  public metas!: TServiceMetas;
  public bindings: string[] = [];

  public parent: TParent;
  public app: TApplication;
  public config: TConfig = {} as TConfig;

  public constructor(...[parent, config, app]: TServiceArgs<AnyService>) {
    this.parent = parent;
    if (this.parent === "self") this.parent = this as unknown as TParent;

    this.app = app === "self" ? (this as unknown as TApplication) : app;

    this.config = config || {};
  }

  public getServiceInstance() {
    return this;
  }

  public get services(): TApplication {
    return this.app;
  }

  public get models() {
    return this.app.Models?.client;
  }

  protected get request(): TRouterContext<TAnyRouter> {
    const store = context.getStore() as
      | { requestContext?: TRouterContext<TAnyRouter> }
      | undefined;
    const requestContext = store?.requestContext;

    if (!requestContext)
      throw new Error(
        `${this.constructor.name} tried to access request context outside of a controller request.`,
      );

    return requestContext;
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
    useOptions: { optional?: boolean } = {},
  ): TService | undefined {
    const registeredService = this.app.registered[serviceId];
    if (registeredService !== undefined)
      return this.app[registeredService.name];

    if (useOptions.optional === false)
      throw new Error(`Service ${registeredService} not registered.`);

    return undefined;
  }

  /*----------------------------------
    - HOOKS
    ----------------------------------*/

  public hooks: THooksIndex<THooks> = {};

  public on<THookName extends keyof THooksList>(
    name: THookName,
    callback: THookCallback<THooksList[THookName]>,
  ) {
    const callbacks = this.hooks[name];
    if (callbacks) callbacks.push(callback);
    else this.hooks[name] = [callback];

    return this;
  }

  public runHook<THookName extends keyof THooksList>(
    name: THookName,
    ...args: THooksList[THookName]["args"]
  ) {
    const callbacks = this.hooks[name];
    if (!callbacks) return; // console.info(LogPrefix, `No ${name} hook defined in the current service instance.`);

    //this.config.debug && console.info(`[hook] Run all ${name} hook (${callbacks.length}).`);
    return Promise.all(callbacks.map((cb) => cb(...args)))
      .then(() => {
        //this.config.debug && console.info(`[hook] Hooks ${name} executed with success.`);
      })
      .catch((e) => {
        if (name === "error") {
          // In error hook = avoid infinite loop
          console.error("Error hook", e);
        } else {
          // Let the error hook handle it
          throw e;
        }
      });
  }
}
