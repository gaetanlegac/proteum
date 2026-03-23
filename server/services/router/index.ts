// INSPIRATION:
// https://adonisjs.com/docs/4.1/routing
// https://laravel.com/docs/8.x/routing
// https://github.com/adonisjs/http-server/blob/develop/src/ServerRouter/indexApi.ts
// https://github.com/expressjs/express/blob/06d11755c99fe4c1cddf8b889a687448b568472d/lib/response.js#L1016

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Node
// Npm
const { v4: uuid } = require('uuid') as { v4: () => string };
import got from 'got';
import hInterval from 'human-interval';
import type express from 'express';
import type { Request, Response, NextFunction } from 'express';
import zod, { ZodError } from 'zod';
export { default as schema } from 'zod';

// Core
import Service, { AnyService, TServiceArgs } from '@server/app/service';
import context from '@server/context';
import type DisksManager from '@server/services/disks';
import { CoreError, InputError, NotFound, toJson as errorToJson } from '@common/errors';
import BaseRouter, {
    TMatchedRoute,
    TRoute,
    TErrorRoute,
    TRouteModule,
    TRouteOptions,
    defaultOptions,
    matchRoute,
    buildUrl,
    TDomainsList,
} from '@common/router';
import type { TSsrUnresolvedRoute, TRegisterPageArgs } from '@common/router/contracts';
import { buildRegex, getRegisterPageArgs } from '@common/router/register';
import { layoutsList, getLayout } from '@common/router/layouts';
import { TFetcherList } from '@common/router/request/api';
import type { TFrontRenderer } from '@common/router/response/page';

// Specific
import { AnyRouterService } from './service';
import ServerRequest from './request';
import ServerResponse, { TRouterContext, TRouterContextServices } from './response';
import Page from './response/page';
import HTTP, { Config as HttpServiceConfig } from './http';
import DocumentRenderer from './response/page/document';
import { loadGeneratedRuntimeBundle } from './generatedRuntime';

/*----------------------------------
- TYPES
----------------------------------*/

export { type AnyRouterService, default as RouterService } from './service';
export { default as RequestService } from './request/service';
export type { default as Request, UploadedFile } from './request';
export type { default as Response, TRouterContext, TRouterContextServices } from './response';
export type { TRoute, TAnyRoute } from '@common/router';

export type TApiRegisterArgs<TRouter extends TServerRouter> =
    | [path: string, controller: TServerController<TRouter>]
    | [path: string, options: Partial<TRouteOptions>, controller: TServerController<TRouter>];

type TGeneratedRouteModule = { filepath: string; register?: TRouteModule['__register'] };

type TGeneratedControllerDefinition = {
    path: string;
    Controller: new (request: TRouterContext<TServerRouter>) => { [method: string]: () => any };
    method: string;
};

type TGeneratedDefinitionsSnapshot = {
    routes: TMatchedRoute[];
    errors: { [code: number]: TErrorRoute<any> };
    controllers: { [path: string]: TRoute };
    ssrRoutes: TSsrUnresolvedRoute[];
    cache: { [pageId: string]: { rendered: any; expire: number | undefined; options: TRouteOptions['static'] } };
};

export type TServerController<TRouter extends TServerRouter> = (context: TRouterContext<TRouter>) => any;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export type TRouteHttpMethod = HttpMethod | '*';

export type TApiResponseData = { data: any; triggers?: { [cle: string]: any } };

export type HttpHeaders = { [cle: string]: string };

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

export type TAnyRouter = ServerRouter<
    AnyService['app'],
    TRouterServicesList,
    Config<TRouterServicesList, AnyService['app']>
>;

const LogPrefix = '[router]';

export type Config<
    TServices extends TRouterServicesList,
    TApplication extends AnyService['app'] = AnyService['app'],
> = {
    debug: boolean;

    disk?: string; // Disk driver ID

    domains: TDomainsList;

    http: HttpServiceConfig;

    context: (request: ServerRequest<TServerRouter>, app: TApplication) => {};

    plugins: TServices;
};

// Set it as a function, so when we instanciate the services, we can callthis.router to pass the router instance in roiuter services
type TRouterServicesList = { [serviceName: string]: AnyRouterService };

export type Hooks = {};

export type TControllerDefinition = {
    path?: string;
    schema?: zod.ZodSchema;
    controller: TServerController<TServerRouter>;
};

export type TServerRouter = ServerRouter<
    AnyService['app'],
    TRouterServicesList,
    Config<TRouterServicesList, AnyService['app']>
>;

/*----------------------------------
- CLASSE
----------------------------------*/
export default class ServerRouter<
        TApplication extends AnyService['app'] = AnyService['app'],
        TServices extends TRouterServicesList = TRouterServicesList,
        TConfig extends Config<TServices, TApplication> = Config<TServices, TApplication>,
    >
    extends Service<TConfig, Hooks, TApplication, TApplication>
    implements BaseRouter
{
    public disks = this.use<DisksManager<any, any, TApplication>>('Core/Disks', { optional: true });

    // Services
    public http: HTTP;
    public render: DocumentRenderer<this>;

    // Indexed
    public routes: TMatchedRoute[] = []; // API + pages front front
    public errors: { [code: number]: TErrorRoute } = {};
    public controllers: { [path: string]: TRoute } = {};
    public ssrRoutes: TSsrUnresolvedRoute[] = [];

    // Cache (ex: for static pages)
    public cache: {
        [pageId: string]: { rendered: any; expire: number | undefined; options: TRouteOptions['static'] };
    } = {};

    private staticRoutesRefreshInterval?: NodeJS.Timeout;

    /*----------------------------------
    - SERVICE
    ----------------------------------*/

    public constructor(...args: TServiceArgs<ServerRouter<TApplication, TServices, TConfig>>) {
        super(...args);

        this.http = new HTTP(this.config.http, this);
        this.render = new DocumentRenderer(this);
    }

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public async ready() {
        // Detect router services
        for (const serviceName in this.config.plugins) {
            const service = this.config.plugins[serviceName];
            service.parent = this;
            this.app.register(service);
        }

        this.registerControllers(this.loadGeneratedControllerDefinitions());

        this.registerRoutes(this.loadGeneratedRouteModules());

        // Start HTTP server
        await this.http.start();

        // override
        const originalLog = console.log;
        console.log = (...args: any[]) => {
            // parse stack trace: skip this function and the console.log call
            /*const stackLine = (new Error()).stack?.split('\n')[2] || '';
            const match = stackLine.match(/at (\w+)\.(\w+) /);
            const className = match ? match[1] : '<global>';
            const methodName = match ? match[2] : '<anonymous>';*/

            const contextData = context.getStore() || { channelType: 'master' };

            const requestPrefix =
                contextData.channelType === 'request'
                    ? `[${contextData.user ? contextData.user : 'guest'}] ${contextData.method} ${contextData.path} |`
                    : 'master';

            // prefix and forward
            originalLog.call(
                console,
                `${requestPrefix}`, // ${className}.${methodName}
                ...args,
            );
        };

        // When all the services are ready, initialize static routes
        this.app.on('ready', async () => {
            this.initStaticRoutes();
        });
    }

    public async shutdown() {}

    public async reloadGeneratedDefinitions(changedFiles: string[] = []) {
        const changeSummary = changedFiles.length > 0 ? `\n${changedFiles.join('\n')}` : '';
        console.info(`[router] Hot reloading generated definitions ...${changeSummary}`);

        const controllerDefinitions = this.loadGeneratedControllerDefinitions();
        const routeModules = this.loadGeneratedRouteModules();
        const previousState = this.snapshotGeneratedDefinitions();

        this.resetGeneratedDefinitions();

        try {
            this.registerControllers(controllerDefinitions);
            this.registerRoutes(routeModules);
            this.initStaticRoutes();

            console.info('[router] Generated definitions hot reloaded.');
        } catch (error) {
            console.error('[router] Failed to hot reload generated definitions. Restoring previous router state.');
            this.restoreGeneratedDefinitions(previousState);
            throw error;
        }
    }

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/

    public async renderStatic(url: string, options: TRouteOptions['static'], rendered?: any) {
        // Wildcard: tell that the newly rendered pages should be cached
        if (url === '*' || !url) return;

        if (!rendered) {
            console.log('[router] renderStatic: url', url);

            const fullUrl = this.url(url, {}, true);
            const response = await got(fullUrl, {
                method: 'GET',
                headers: { Accept: 'text/html', bypasscache: '1' },
                throwHttpErrors: false,
            });

            if (response.statusCode !== 200) {
                console.error('[router] renderStatic: page returned code', response.statusCode, fullUrl);
                return;
            }

            rendered = response.body;
        }

        this.cache[url] = {
            rendered: rendered,
            options: options,
            expire: typeof options === 'object' ? Date.now() + (hInterval(options.refresh) || 3600) : undefined,
        };
    }

    private initStaticRoutes() {
        this.clearStaticRoutesRefreshInterval();

        for (const route of this.routes) {
            if (!route.options.static) continue;

            // Add to static pages
            // Should be a GET oage that don't take any parameter
            for (const url of route.options.static.urls) {
                this.renderStatic(url, route.options.static);
            }
        }

        // Every hours, refresh static pages
        this.staticRoutesRefreshInterval = setInterval(
            () => {
                this.refreshStaticPages();
            },
            1000 * 60 * 60,
        );
    }

    private refreshStaticPages() {
        console.log('[router] refreshStaticPages');

        for (const pageUrl in this.cache) {
            const page = this.cache[pageUrl];
            if (page.expire && page.expire < Date.now()) {
                this.renderStatic(pageUrl, page.options);
            }
        }
    }

    private registerRoutes(defModules: TGeneratedRouteModule[]) {
        for (const routeModule of defModules) {
            const register = routeModule.register;
            if (!register) continue;

            this.config.debug && console.log(LogPrefix, `Register file:`, routeModule.filepath);
            try {
                register(this.app);
            } catch (error) {
                console.error('Failed to register route file:', routeModule);
                console.error('Register function:', register.toString());
                throw error;
            }
        }

        this.afterRegister();
    }

    private registerControllers(definitions: TGeneratedControllerDefinition[]) {
        for (const definition of definitions) {
            const route: TRoute<TRouterContext<this>> = {
                method: 'POST',
                path: definition.path,
                controller: (requestContext: TRouterContext<this>) => {
                    const controller = new definition.Controller(requestContext);
                    return controller[definition.method]();
                },
                options: { ...defaultOptions },
            };

            this.controllers[route.path] = route;
        }
    }

    public url = (path: string, params: {} = {}, absolute: boolean = true) =>
        buildUrl(path, params, this.config.domains, absolute);

    /*----------------------------------
    - REGISTER
    ----------------------------------*/

    public page(...args: TRegisterPageArgs<any, TRouteOptions>) {
        const { path, options, setup, renderer, layout } = getRegisterPageArgs(...args);

        const { regex, keys } = buildRegex(path);

        const route: TMatchedRoute<TRouterContext<this>> = {
            method: 'GET',
            path,
            regex,
            keys,
            controller: (context: TRouterContext<this>) => new Page(route, renderer, context, layout),
            options: {
                ...defaultOptions,
                accept: 'html', // Les pages retournent forcémment du html
                setup,
                ...options,
            },
        };

        this.routes.push(route);

        return this;
    }

    public error(
        code: number,
        options: Partial<TRouteOptions>,
        renderer: TFrontRenderer<{}, { message: string }>,
    ) {
        const finalOptions = { ...defaultOptions, ...options };

        // Automatic layout form the nearest _layout folder
        const layout = getLayout('Error ' + code, finalOptions);

        const route: TErrorRoute<TRouterContext<this>> = {
            code,
            controller: (context: TRouterContext<this>) => new Page(route, renderer, context, layout),
            options: finalOptions,
        };

        this.errors[code] = route;
    }

    public all = (...args: TApiRegisterArgs<this>) => this.registerApi('*', ...args);
    public options = (...args: TApiRegisterArgs<this>) => this.registerApi('OPTIONS', ...args);
    public get = (...args: TApiRegisterArgs<this>) => this.registerApi('GET', ...args);
    public post = (...args: TApiRegisterArgs<this>) => this.registerApi('POST', ...args);
    public put = (...args: TApiRegisterArgs<this>) => this.registerApi('PUT', ...args);
    public patch = (...args: TApiRegisterArgs<this>) => this.registerApi('PATCH', ...args);
    public delete = (...args: TApiRegisterArgs<this>) => this.registerApi('DELETE', ...args);

    public express(
        middleware: (req: Request, res: Response, next: NextFunction, requestContext: TRouterContext<this>) => void,
    ) {
        return (context: TRouterContext<this>) =>
            new Promise((resolve) => {
                context.request.res.on('finish', function () {
                    //console.log('the response has been sent', request.res.statusCode);
                    resolve(true);
                });

                middleware(
                    context.request.req,
                    context.request.res,
                    () => {
                        resolve(true);
                    },
                    context,
                );
            });
    }

    protected registerApi(method: TRouteHttpMethod, ...args: TApiRegisterArgs<this>): this {
        let path: string;
        let options: Partial<TRouteOptions> = {};
        let controller: TServerController<this>;

        if (args.length === 2) [path, controller] = args;
        else [path, options, controller] = args;

        const { regex, keys } = buildRegex(path);

        const route: TMatchedRoute<TRouterContext<this>> = {
            method: method,
            path: path,
            regex,
            keys: keys,
            options: { ...defaultOptions, ...options },
            controller,
        };

        this.routes.push(route);

        return this;
    }

    private clearStaticRoutesRefreshInterval() {
        if (this.staticRoutesRefreshInterval) {
            clearInterval(this.staticRoutesRefreshInterval);
            this.staticRoutesRefreshInterval = undefined;
        }
    }

    private resetGeneratedDefinitions() {
        this.clearStaticRoutesRefreshInterval();
        this.routes = [];
        this.errors = {};
        this.controllers = {};
        this.ssrRoutes = [];
        this.cache = {};
    }

    private snapshotGeneratedDefinitions(): TGeneratedDefinitionsSnapshot {
        return {
            routes: [...this.routes],
            errors: { ...this.errors },
            controllers: { ...this.controllers },
            ssrRoutes: [...this.ssrRoutes],
            cache: { ...this.cache },
        };
    }

    private restoreGeneratedDefinitions(snapshot: TGeneratedDefinitionsSnapshot) {
        this.routes = snapshot.routes;
        this.errors = snapshot.errors;
        this.controllers = snapshot.controllers;
        this.ssrRoutes = snapshot.ssrRoutes;
        this.cache = snapshot.cache;
        this.initStaticRoutes();
    }

    private loadGeneratedControllerDefinitions() {
        return (
            loadGeneratedRuntimeBundle<TGeneratedControllerDefinition[]>('controllers') ||
            require('@generated/server/controllers').default ||
            []
        );
    }

    private loadGeneratedRouteModules() {
        return (
            loadGeneratedRuntimeBundle<TGeneratedRouteModule[]>('routes') ||
            require('@generated/server/routes').default ||
            []
        );
    }

    private async afterRegister() {
        // Ordonne par ordre de priorité
        this.config.debug && console.info('Loading routes ...');
        this.routes.sort((r1, r2) => {
            const prioDelta = r2.options.priority - r1.options.priority;
            if (prioDelta !== 0) return prioDelta;

            // HTML avant json
            if (r1.options.accept === 'html' && r2.options.accept !== 'html') return -1;

            // Unchanged
            return 0;
        });
        // - Génère les définitions de route pour le client
        this.config.debug && console.info(`Registered routes:`);
        for (const route of this.routes) {
            const chunkId = route.options.id;

            this.config.debug && console.info('-', route.method, route.path, ' :: ', JSON.stringify(route.options));

            if (chunkId) this.ssrRoutes.push({ regex: route.regex.source, keys: route.keys, chunk: chunkId });
        }

        this.config.debug && console.info(`Registered error pages:`);
        for (const code in this.errors) {
            const route = this.errors[code];
            const chunkId = route.options.id;

            this.config.debug && console.info('-', code, ' :: ', JSON.stringify(route.options));

            if (chunkId) this.ssrRoutes.push({ code: parseInt(code), chunk: chunkId });
        }

        this.config.debug && console.info(`Registered layouts:`);
        for (const layoutId in layoutsList) {
            const layout = layoutsList[layoutId];

            this.config.debug && console.info('-', layoutId, layout);
        }

        this.config.debug && console.info(this.routes.length + ' routes where registered.');
    }

    /*----------------------------------
    - RESOLUTION
    ----------------------------------*/
    public async middleware(req: express.Request, res: express.Response) {
        // Don't cache HTML, because in case of update, assets file name will change (hash.ext)
        // https://github.com/helmetjs/nocache/blob/main/index.ts
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        // Create request
        let requestId = uuid();
        const cachedPage = req.headers['bypasscache'] ? undefined : this.cache[req.path];
        const headers: HttpHeaders = Object.fromEntries(
            Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value || '']),
        );

        const request = new ServerRequest(
            requestId,

            req.method as HttpMethod,
            req.path, // url sans params
            // Exclusion de req.files, car le middleware multipart les a normalisé dans req.body
            { ...req.query, ...req.body },
            headers,

            res,
            this,
        );

        let response: ServerResponse<this>;
        try {
            // Hook
            await this.runHook('request', request);

            // Bulk API Requests
            if (request.path === '/api' && typeof request.data.fetchers === 'object') {
                return await this.resolveApiBatch(request.data.fetchers, request);
            } else {
                response = await this.resolve(
                    request,
                    // If cached page, we only run routes with priority >= 10
                    cachedPage ? true : false,
                );
            }
        } catch (e) {
            response = await this.handleError(e, request);
        }

        if (!res.headersSent) {
            // Static pages
            if (cachedPage) {
                console.log('[router] Get static page from cache', req.path);
                res.send(cachedPage.rendered);
                return;
            }

            // Status
            res.status(response.statusCode);
            // Headers
            res.header(response.headers);
            // Data
            res.send(response.data);
        } else if (response.data !== 'true') {
            throw new Error("Can't return data from the controller since response has already been sent via express.");
        }
    }

    public createContextServices(request: ServerRequest<this>) {
        const contextServices: Partial<TRouterContextServices<this>> = {};
        for (const serviceName in this.config.plugins) {
            const routerService = this.config.plugins[serviceName];
            if (!routerService)
                throw new Error(
                    `Could not access router service ${serviceName}. Maybe the referenced service is not started yet? Try to reduce its priority.`,
                );

            if (!routerService.requestService)
                throw new Error(
                    `Router service ${serviceName} is not implementing the requestService method from the RouterService interface.`,
                );

            const requestService = routerService.requestService(request);
            if (requestService !== null)
                contextServices[serviceName as keyof TRouterContextServices<this>] =
                    requestService as TRouterContextServices<this>[keyof TRouterContextServices<this>];
        }

        return contextServices;
    }

    public resolve = (request: ServerRequest<this>, isStatic?: boolean) =>
        new Promise<ServerResponse<this>>((resolve, reject) => {
            // Create request context so we can access request context across all the request-triggered libs
            context.run(
                {
                    // This is for debugging
                    channelType: 'request',
                    channelId: request.id,
                    method: request.method,
                    path: request.path,
                },
                async () => {
                    const timeStart = Date.now();

                    if (this.status === 'starting') {
                        console.log(LogPrefix, `Waiting for servert to be resdy before resolving request`);
                        await this.started;
                    }

                    try {
                        const response = new ServerResponse<this>(request);

                        await this.runHook('resolve', request);

                        // Controller route
                        const controllerRoute = this.controllers[request.path];
                        if (controllerRoute !== undefined) {
                            // Create response
                            await response.runController(controllerRoute);
                            if (response.wasProvided) return resolve(response);
                        }

                        const contextStore = context.getStore();
                        if (contextStore) contextStore.user = request.user?.email;

                        // Classic routes
                        for (const route of this.routes) {
                            if (isStatic && !route.options.whenStatic) continue;

                            // Match Method
                            if (request.method !== route.method && route.method !== '*') continue;

                            // Match Response format
                            if (!request.accepts(route.options.accept)) continue;

                            const isMatching = matchRoute(route, request);
                            if (!isMatching) continue;

                            await this.resolvedRoute(route, response, timeStart);
                            if (response.wasProvided) return resolve(response);
                        }

                        reject(new NotFound());
                    } catch (error) {
                        const typedError =
                            error instanceof Error
                                ? error
                                : new Error(typeof error === 'string' ? error : 'Unknown router error');

                        if (this.app.env.profile === 'dev') {
                            console.log('API batch error:', request.method, request.path, typedError);
                            const errOrigin = request.method + ' ' + request.path;
                            if ('details' in typedError) {
                                const routerError = typedError as Error & { details?: { origin?: string } };
                                if (routerError.details === undefined) routerError.details = { origin: errOrigin };
                                else routerError.details.origin = errOrigin;
                            }
                        }

                        this.printTakenTime(timeStart);
                        reject(typedError);
                    }
                },
            );
        });

    private async resolvedRoute(route: TMatchedRoute, response: ServerResponse<this>, timeStart: number) {
        route = await response.resolveRouteOptions(route);

        // Run on resolution hooks. Ex: authentication check
        await this.runHook('resolved', route, response.request, response);

        // Create response
        await response.runController(route);
        if (!response.wasProvided) return;

        // Set in cache
        if (response.request.path && route.options.static && route.options.static.urls.includes('*')) {
            console.log('[router] Set in cache', response.request.path);
            this.renderStatic(response.request.path, route.options.static, response.data);
        }

        const timeEndResolving = Date.now();
        this.printTakenTime(timeStart, timeEndResolving);
    }

    private printTakenTime = (timeStart: number, timeEndResolving?: number) => {
        if (this.app.env.name === 'server') return;

        console.log(
            Math.round(Date.now() - timeStart) +
                'ms' +
                (timeEndResolving === undefined ? '' : ' | Routing: ' + Math.round(timeEndResolving - timeStart)),
        );
    };

    private async resolveApiBatch(fetchers: TFetcherList, request: ServerRequest<this>) {
        // TODO: use api.fetchSync instead

        const responseData: TObjetDonnees = {};
        for (const id in fetchers) {
            const fetcher = fetchers[id];
            if (!fetcher || !('method' in fetcher)) continue;

            const { method, path, data } = fetcher;

            const response = await this.resolve(request.children(method, path, data));

            responseData[id] = response.data;

            // TODO: merge response.headers ?
        }

        // Status
        request.res.status(200);
        // Data
        request.res.json(responseData);
    }

    private async handleError(e: unknown, request: ServerRequest<this>) {
        let error: Error | CoreError;
        if (e instanceof ZodError)
            error = new InputError(e.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join(', '));
        else if (e instanceof Error) error = e;
        else error = new Error(typeof e === 'string' ? e : 'Unknown error');

        const code = 'http' in error ? error.http : 500;

        const response = new ServerResponse(request).status(code);

        // Rapport / debug
        if (code === 500) {
            // Print the error here so the stacktrace appears in the bug report logs
            console.log(LogPrefix, 'Error catched from the router:', error);

            // Report error
            await this.app.runHook('error', error, request);

            // Don't exose technical errors to users
            if (this.app.env.profile === 'prod')
                error = new Error(
                    'We encountered an internal error, and our team has just been notified. Sorry for the inconvenience.',
                );
        } else {
            // For debugging HTTP errors
            /*if (this.app.env.profile === "dev")
                console.warn(e);*/

            await this.app.runHook('error.' + code, error, request);
        }

        // Return error based on the request format
        if (request.accepts('html')) {
            const route = this.errors[code];
            if (route === undefined) throw new Error(`No route for error code ${code}`);

            const jsonError = errorToJson(error);
            await response.setRoute(route).runController(route, { error: jsonError });
        } else if (request.accepts('json')) {
            const jsonError = errorToJson(error);
            await response.json(jsonError);
        } else await response.text(error.message);

        return response;
    }
}
