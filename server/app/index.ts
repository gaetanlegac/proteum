/*----------------------------------
- DEPENDANCES
----------------------------------*/

process.env.DOTENV_CONFIG_QUIET ??= 'true';

// Core
import AppContainer from './container';
import ApplicationService, { AnyService } from './service';
import CommandsManager from './commandsManager';
import DevCommandsRegistry from './devCommands';
import DevDiagnosticsRegistry from './devDiagnostics';
import ServicesContainer, { ServicesContainer as ServicesContainerClass, TServiceMetas } from './service/container';

// Built-in
import type { TServerRouter, Request as ServerRequest } from '@server/services/router';
import { Anomaly } from '@common/errors';
import { TBasicUser } from '@server/services/auth';

export { default as Services } from './service/container';
export type { ServiceConfig } from './service/container';
export type { TEnvConfig as Environment } from './container/config';

/*----------------------------------
- TYPES
----------------------------------*/

type Config = {};

type Hooks = {
    ready: { args: [] };
    cleanup: { args: [] };
    error: { args: [error: Error, request?: ServerRequest<TServerRouter>] };
};

export type TApplicationStartOptions = {
    skipRootServices?: string[];
};

export const Service = ServicesContainer;

// Without prettify, we don't get a clear list of the class properties
type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type ApplicationProperties = Prettify<keyof Application>;
export type RootServicesOf<TApplication extends Application = Application> = Prettify<{
    [TKey in Exclude<keyof TApplication, ApplicationProperties> as TApplication[TKey] extends AnyService ? TKey : never]: TApplication[TKey];
}>;

const isServiceInstance = (value: unknown): value is AnyService => {
    if (!value || typeof value !== 'object') return false;

    const service = value as Partial<AnyService>;

    return typeof service.runHook === 'function' && typeof service.getServiceInstance === 'function' && service.status !== undefined;
};

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

    public side = 'server' as 'server';
    public metas: TServiceMetas = {
        id: 'application',
        name: 'Application',
        parent: 'root',
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

    /*----------------------------------
    - INIT
    ----------------------------------*/

    public constructor() {
        const self = 'self' as const;

        // Application itself doesnt have configuration
        // Configuration must be handled by application services
        super(self, {}, self);

        // Handle unhandled crash
        this.on('error', (e, request) => this.container.handleBug(e, 'An error occured in the application', request));

        process.on('unhandledRejection', (error: any, _promise: any) => {
            // Log so we know it's coming from unhandledRejection
            console.error('unhandledRejection', error);

            // We don't log the error here because it's the role of the app to decidehiw to log errors
            this.runHook('error', error);
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

    private commandsManager = new CommandsManager(this, { debug: true }, this);
    private devCommandsRegistry?: DevCommandsRegistry<this>;
    private devDiagnosticsRegistry?: DevDiagnosticsRegistry<this>;

    public command(...args: Parameters<CommandsManager['command']>) {
        return this.commandsManager.command(...args);
    }

    public getDevCommands() {
        this.devCommandsRegistry ??= new DevCommandsRegistry(this);
        return this.devCommandsRegistry;
    }

    public getDevDiagnostics() {
        this.devDiagnosticsRegistry ??= new DevDiagnosticsRegistry(this);
        return this.devDiagnosticsRegistry;
    }

    /*----------------------------------
    - LAUNCH
    ----------------------------------*/

    public async start(options: TApplicationStartOptions = {}) {
        const startTime = Date.now();

        const startingServices = await this.ready(options);
        await Promise.all(startingServices);
        await this.runHook('ready');

        const startedTime = (Date.now() - startTime) / 1000;
        console.info(`[boot] Application launched in ${startedTime}s`);
        this.launched = true;
    }

    /*----------------------------------
    - ERROR HANDLING
    ----------------------------------*/

    private listRootServices(): Array<[string, AnyService]> {
        return Object.keys(this)
            .map((serviceName) => [serviceName, (this as Record<string, unknown>)[serviceName]] as const)
            .filter(
                ([, service]) =>
                    isServiceInstance(service) &&
                    service !== this &&
                    service.parent === this &&
                    service.app === this,
            )
            .map(([serviceName, service]) => [serviceName, service as AnyService]);
    }

    public getRootServices(): RootServicesOf<this> {
        const services: Record<string, AnyService> = {};

        for (const [serviceName, service] of this.listRootServices()) {
            services[serviceName] = service;
        }

        return services as RootServicesOf<this>;
    }

    public findService(serviceId: string): AnyService | undefined {
        const rootServices = this.getRootServices() as Record<string, AnyService>;
        const directService = rootServices[serviceId];
        if (directService) return directService;

        const serviceName = serviceId.split('/').pop();
        if (!serviceName) return undefined;

        return rootServices[serviceName];
    }

    public register(service: AnyService) {
        return (service as AnyService & { ready: () => Promise<any> }).ready();
    }

    public async ready(options: TApplicationStartOptions = {}) {
        const startingServices: Promise<any>[] = [];
        const skippedRootServices = new Set(options.skipRootServices || []);

        const processService = async (_propKey: string, service: AnyService) => {
            if (service.status !== 'starting') return;

            // Services start shouldn't block app boot
            // use await ServiceName.started to make services depends on each other
            service.starting = (service as AnyService & { ready: () => Promise<any> }).ready();
            startingServices.push(service.starting);
            service.status = 'running';

            // Subservices
            for (const propKey in service) {
                if (propKey === 'app' || propKey === 'parent') continue;
                const propValue = (service as Record<string, any>)[propKey];

                // Check if service
                if (!isServiceInstance(propValue) || propValue instanceof Application) continue;

                // Services start shouldn't block app boot
                processService(propKey, propValue);
            }
        };

        for (const [serviceName, service] of this.listRootServices()) {
            const rootService = service as AnyService;
            if (skippedRootServices.has(serviceName)) {
                rootService.status = 'stopped';
                continue;
            }

            // TODO: move to router
            //  Application.on('service.ready')

            // Services start shouldn't block app boot
            processService(serviceName, rootService);
        }

        return startingServices;
    }
}

export default Application;
