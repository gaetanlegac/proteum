/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type express from "express";

// Core
import AppContainer from "./container";
import ApplicationService, {
  AnyService,
  StartedServicesIndex,
} from "./service";
import CommandsManager from "./commands";
import ServicesContainer, {
  ServicesContainer as ServicesContainerClass,
  TServiceMetas,
} from "./service/container";

// Built-in
import type {
  default as Router,
  Request as ServerRequest,
  TRoute,
} from "@server/services/router";
import { Anomaly } from "@common/errors";
import { preprocessSchema } from "@server/services/router/request/validation/zod";
import { TBasicUser } from "@server/services/auth";

export { default as Services } from "./service/container";
export type { TEnvConfig as Environment } from "./container/config";

/*----------------------------------
- TYPES
----------------------------------*/

type Config = {};

type Hooks = {
  ready: {
    args: [];
  };
  cleanup: {
    args: [];
  };
  error: {
    args: [error: Error, request?: ServerRequest<Router>];
  };
};

export const Service = ServicesContainer;

// Without prettify, we don't get a clear list of the class properties
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type ApplicationProperties = Prettify<keyof Application>;

/*----------------------------------
- FUNCTIONS
----------------------------------*/
export abstract class Application<
  TServicesContainer extends ServicesContainerClass = ServicesContainerClass,
  TUser extends TBasicUser = TBasicUser,
> extends ApplicationService<Config, Hooks, Application, Application> {
  public app!: this;
  public servicesContainer!: TServicesContainer;
  public userType!: TUser;

  /*----------------------------------
    - PROPERTIES
    ----------------------------------*/

  public side = "server" as "server";
  public metas: TServiceMetas = {
    id: "application",
    name: "Application",
    parent: "root",
    dependences: [],
    class: () => ({ default: Application }),
  };

  // Shortcuts to ApplicationContainer
  public container = AppContainer;
  public env = AppContainer.Environment;
  public identity = AppContainer.Identity;

  // Status
  public debug: boolean = false;
  public launched: boolean = false;

  protected abstract registered: {
    [serviceId: string]: {
      name: string;
      start: () => AnyService;
    };
  };

  /*----------------------------------
    - INIT
    ----------------------------------*/

  public constructor() {
    const self = "self" as unknown as Application;

    // Application itself doesnt have configuration
    // Configuration must be handled by application services
    super(self, {}, self);

    // Handle unhandled crash
    this.on("error", (e, request) =>
      this.container.handleBug(
        e,
        "An error occured in the application",
        request,
      ),
    );

    process.on("unhandledRejection", (error: any, promise: any) => {
      // Log so we know it's coming from unhandledRejection
      console.error("unhandledRejection", error);

      // We don't log the error here because it's the role of the app to decidehiw to log errors
      this.runHook("error", error);
    });

    // We can't pass this in super so we assign here
    this.parent = this;
    this.app = this;
  }

  public report(...anomalyArgs: ConstructorParameters<typeof Anomaly>) {
    return this.container.Console.createBugReport(new Anomaly(...anomalyArgs));
  }

  /*----------------------------------
    - COMMANDS
    ----------------------------------*/

  private commandsManager = new CommandsManager(
    this,
    { debug: true },
    {},
    this,
  );

  public command(...args: Parameters<CommandsManager["command"]>) {
    return this.commandsManager.command(...args);
  }

  /*----------------------------------
    - LAUNCH
    ----------------------------------*/

  public async start() {
    console.log("Build date", BUILD_DATE);
    console.log("Core version", CORE_VERSION);
    const startTime = Date.now();

    this.startServices();

    console.log("----------------------------------");
    console.log("- SERVICES");
    console.log("----------------------------------");
    const startingServices = await this.ready();
    await Promise.all(startingServices);
    console.log("All services are ready");
    await this.runHook("ready");

    const startedTime = (Date.now() - startTime) / 1000;
    console.info(`[boot] Application launched in ${startedTime}s`);
    this.launched = true;
  }

  /*----------------------------------
    - ERROR HANDLING
    ----------------------------------*/

  private startServices() {
    // Satrt services
    for (const serviceId in this.registered) {
      try {
        const service = this.registered[serviceId];
        const instance = service.start();
        this[service.name] = instance.getServiceInstance();
      } catch (error) {
        console.error("Error while starting service", serviceId, error);
        throw error;
      }
    }
  }

  public register(service: AnyService) {
    return service.ready();
  }

  protected async ready() {
    const startingServices: Promise<any>[] = [];

    // Print services
    const processService = async (
      propKey: string,
      service: AnyService,
      level: number = 0,
    ) => {
      if (service.status !== "starting") return;

      // Services start shouldn't block app boot
      // use await ServiceName.started to make services depends on each other
      service.starting = service.ready();
      startingServices.push(service.starting);
      service.status = "running";
      console.log(
        "-" + "-".repeat(level * 1),
        propKey + ": " + service.constructor.name,
      );

      // Subservices
      for (const propKey in service) {
        if (propKey === "app") continue;
        const propValue = service[propKey];

        // Check if service
        const isService =
          typeof propValue === "object" &&
          !(propValue instanceof Application) &&
          propValue !== null &&
          propValue.status !== undefined;
        if (!isService) continue;

        // Services start shouldn't block app boot
        processService(propKey, propValue, level + 1);
      }
    };

    for (const serviceId in this.registered) {
      const registeredService = this.registered[serviceId];
      const service = this[registeredService.name];

      // TODO: move to router
      //  Application.on('service.ready')

      // Services start shouldn't block app boot
      processService(serviceId, service);
    }

    return startingServices;
  }
}

export default Application;
