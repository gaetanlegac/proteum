/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import ReactDOM from 'react-dom';

// Core
import type {
    default as ServerRouter,
    Request as ServerRequest,
    Response as ServerResponse,
    TAnyRouter,
} from '@server/services/router';
import type { TBasicSSrData } from '@server/services/router/response';

import BaseRouter, {
    defaultOptions,
    TRoute,
    TErrorRoute,
    TRouteOptions,
    TRouteModule,
    TDomainsList,
    matchRoute,
    buildUrl,
} from '@common/router';
import type { TRegisterPageArgs, TSsrUnresolvedRoute } from '@common/router/contracts';
import { getLayout } from '@common/router/layouts';
import { getRegisterPageArgs, buildRegex } from '@common/router/register';
import { TFetcherList } from '@common/router/request/api';
import type { TFrontRenderer, TPageSetup } from '@common/router/response/page';

import App from '@client/app/component';
import type ClientApplication from '@client/app';
import Service from '@client/app/service';

// Specific
import ClientRequest, { isClientRequest } from './request';
import { location, history } from './request/history';
import ClientResponse, { type TRouterContext } from './response';
import ClientPage from './response/page';

type AppPropsContext = Parameters<typeof App>[0]['context'];

// Routes (import __register)
import appRoutes from '@/client/.generated/routes';

/*----------------------------------
- CONFIG
----------------------------------*/

const debug = false;
const LogPrefix = '[router]';
const browserWindow = window as Window & { routes?: TSsrUnresolvedRoute[]; ssr?: TBasicSSrData };

/*----------------------------------
- TYPES
----------------------------------*/

// Client router can handle Client requests AND Server requests (for pages only)
export type { default as ClientResponse, TRouterContext } from './response';

export type TAnyClientRouter = ClientRouter<any, any>;

export type Router = TAnyClientRouter | TAnyRouter;

export type Request = ClientRequest<TAnyClientRouter> | ServerRequest<TAnyRouter>;

export type Response = ClientResponse<TAnyClientRouter> | ServerResponse<TAnyRouter>;

/*----------------------------------
- TYPES: ROUTES LOADING
----------------------------------*/

// WARN: Keep this aligned with the generated route wrapper contract on both sides.
// Route definition without having loaded the controller
type TUnresolvedRoute = TUnresolvedErrorRoute | TUnresolvedNormalRoute;

type TClientPageRoute<TRouter extends TAnyClientRouter = TAnyClientRouter> = TRoute<
    TRouterContext<TRouter, TRouter['app']>,
    ClientPage<TRouter> | Promise<any>
>;

type TClientPageErrorRoute<TRouter extends TAnyClientRouter = TAnyClientRouter> = TErrorRoute<
    TRouterContext<TRouter, TRouter['app']>,
    ClientPage<TRouter> | Promise<any>
>;

export type TUnresolvedErrorRoute = {
    index: number;
    chunk: string;
    code: number;
    load: TRouteLoader<TClientPageErrorRoute>;
};

export type TUnresolvedNormalRoute = {
    index: number;
    chunk: string;
    regex: RegExp;
    keys: (number | string)[];
    load: TRouteLoader<TClientPageRoute>;
};

type TRouteLoader<
    Route extends TClientPageRoute | TClientPageErrorRoute = TClientPageRoute | TClientPageErrorRoute,
> = () => Promise<
    TRouteModule<Route>
>;

export type TRoutesLoaders = { [chunkId: string]: TRouteLoader<TClientPageRoute | TClientPageErrorRoute> };

/*----------------------------------
- SERVICE TYPES
----------------------------------*/

export type THookCallback<TRouter extends TAnyClientRouter> = (request: ClientRequest<TRouter>) => void;

type THookName = 'page.change' | 'page.changed' | 'page.rendered';

type Config = {
    preload: string[]; // List of globs
    context: (context: {}, router: TAnyClientRouter) => any;
};

/*----------------------------------
- ROUTER
----------------------------------*/
export default class ClientRouter<
        TApplication extends ClientApplication = ClientApplication,
        TConfig extends Config = Config,
    >
    extends Service<TConfig, TApplication>
    implements BaseRouter
{
    // Context data
    public ssrRoutes = browserWindow.routes || [];
    public ssrContext = browserWindow.ssr;
    public domains: TDomainsList = browserWindow.ssr?.domains || ({ current: window.location.origin } as TDomainsList);
    public context!: TRouterContext<this, this['app']>;

    public setLoading!: React.Dispatch<React.SetStateAction<boolean>>;
    public navigate!: (page: ClientPage<this>, data?: {}) => void;

    public constructor(app: TApplication, config: TConfig) {
        super(app, config);
    }

    public async start() {
        const currentRoute = await this.registerRoutes();

        this.initialRender(currentRoute);
    }

    public url = (path: string, params: {} = {}, absolute: boolean = true) =>
        buildUrl(path, params, this.domains, absolute);

    public go(url: string | number, data: {} = {}, opt: { newTab?: boolean } = {}) {
        // Error code
        if (typeof url === 'number') {
            const currentRequest = this.context.request;
            if (!isClientRequest<this>(currentRequest))
                throw new Error(`Client router cannot resolve an error page from a non-client request.`);

            this.createResponse(this.errors[url], currentRequest, data).then((page) => {
                this.navigate(page, data);
            });
            return;
        }

        url = this.url(url, data, false);

        if (opt.newTab) window.open(url);
        // Same domain = history url replacement
        else if (url[0] === '/') history?.replace(url);
        // Different domain = hard navigation
        else window.location.href = url;
    }

    /*----------------------------------
    - REGISTRATION
    ----------------------------------*/

    public routes: Array<TClientPageRoute<ClientRouter<TApplication, TConfig>> | TUnresolvedNormalRoute> = [];
    public errors: {
        [code: number]: TClientPageErrorRoute<ClientRouter<TApplication, TConfig>> | TUnresolvedErrorRoute;
    } = {};

    public async registerRoutes() {
        const loaders = appRoutes as TRoutesLoaders;
        let currentRoute: TUnresolvedRoute | undefined;
        debug && console.log(LogPrefix, `Indexing routes and finding the current route from ssr data:`, this.context);

        // Associe la liste des routes (obtenue via ssr) à leur loader
        for (let routeIndex = 0; routeIndex < this.ssrRoutes.length; routeIndex++) {
            const ssrRoute = this.ssrRoutes[routeIndex];

            if (loaders[ssrRoute.chunk] === undefined) {
                console.error('Chunk id not found for ssr route:', ssrRoute, 'Searched in:', loaders);
                continue;
            }

            // TODO: Fix types
            const loader = loaders[ssrRoute.chunk];

            // Register the route
            let route: TUnresolvedRoute;
            if ('code' in ssrRoute)
                route = this.errors[ssrRoute.code] = {
                    index: routeIndex,
                    code: ssrRoute.code,
                    chunk: ssrRoute.chunk,
                    load: loader as TRouteLoader<TClientPageErrorRoute>,
                };
            else
                route = this.routes[routeIndex] = {
                    index: routeIndex,
                    chunk: ssrRoute.chunk,
                    regex: new RegExp(ssrRoute.regex),
                    keys: ssrRoute.keys,
                    load: loader as TRouteLoader<TClientPageRoute>,
                };

            debug && console.log(LogPrefix, `${route.chunk}`, route);

            // Detect if it's the current route
            if (currentRoute === undefined) {
                const isCurrentRoute = this.ssrContext !== undefined && route.chunk === this.ssrContext.page.chunkId;

                if (isCurrentRoute) {
                    currentRoute = route;
                    continue;
                }
            }
        }

        return currentRoute;
    }

    public page<TProvidedData extends {} = {}>(
        path: string,
        renderer: TFrontRenderer<TProvidedData>,
    ): TClientPageRoute<this>;

    public page<TProvidedData extends {} = {}>(
        path: string,
        setup: TPageSetup<TProvidedData>,
        renderer: TFrontRenderer<TProvidedData>,
    ): TClientPageRoute<this>;

    public page<TProvidedData extends {} = {}>(
        path: string,
        options: Partial<TRouteOptions>,
        renderer: TFrontRenderer<TProvidedData>,
    ): TClientPageRoute<this>;

    public page<TProvidedData extends {} = {}>(
        path: string,
        options: Partial<TRouteOptions>,
        setup: TPageSetup<TProvidedData>,
        renderer: TFrontRenderer<TProvidedData>,
    ): TClientPageRoute<this>;

    public page(...args: TRegisterPageArgs<any, TRouteOptions>): TClientPageRoute<this> {
        const { path, options, setup, renderer, layout } = getRegisterPageArgs(...args);

        // Page ids are injected by the generated route wrapper modules.
        const id = options.id;
        if (id === undefined) throw new Error(`Page route ${path} is missing its generated id metadata.`);

        const { regex, keys } = buildRegex(path);

        const route: TClientPageRoute<this> = {
            method: 'GET',
            path,
            regex,
            keys,
            options: { ...defaultOptions, setup, ...options },
            controller: (context) => new ClientPage(route, renderer, context as any, layout),
        };

        this.routes.push(route);

        return route;
    }

    public error(
        code: number,
        options: Partial<TRouteOptions>,
        renderer: TFrontRenderer<{}, { message: string }>,
    ): TClientPageErrorRoute<this> {
        const finalOptions = { ...defaultOptions, ...options };

        // Automatic layout form the nearest _layout folder
        const layout = getLayout('Error ' + code, finalOptions);

        const route: TClientPageErrorRoute<this> = {
            code,
            controller: (context) => new ClientPage(route, renderer, context as any, layout),
            options: finalOptions,
        };

        this.errors[code] = route;

        return route;
    }

    /*----------------------------------
    - RESOLUTION
    ----------------------------------*/
    public async resolve(request: ClientRequest<this>): Promise<ClientPage<this>> {
        debug && console.log(LogPrefix, 'Resolving request', request.path, Object.keys(request.data));

        for (let iRoute = 0; iRoute < this.routes.length; iRoute++) {
            let route = this.routes[iRoute];
            if (!('regex' in route) || !(route.regex instanceof RegExp) || !('keys' in route) || !Array.isArray(route.keys))
                continue;

            const isMatching = matchRoute({ regex: route.regex, keys: route.keys }, request);
            if (!isMatching) continue;

            // Create response
            debug && console.log(LogPrefix, 'Resolved request', request.path, '| Route:', route);
            const page = await this.createResponse(route, request);

            return page;
        }

        const notFoundRoute = this.errors[404];
        return await this.createResponse(notFoundRoute, request, { error: new Error('Page not found') });
    }

    private async load(route: TUnresolvedNormalRoute): Promise<TClientPageRoute<this>>;
    private async load(route: TUnresolvedErrorRoute): Promise<TClientPageErrorRoute<this>>;
    private async load(
        route: TUnresolvedNormalRoute | TUnresolvedErrorRoute,
    ): Promise<TClientPageRoute<this> | TClientPageErrorRoute<this>> {
        //throw new Error(`Failed to load route: ${route.chunk}`);

        debug && console.log(`Fetching route ${route.chunk} ...`, route);
        try {
            const loaded = await route.load();
            const fetched = loaded.__register(this.app);

            debug && console.log(`Route fetched: ${route.chunk}`, fetched);

            if ('code' in route) return fetched as TClientPageErrorRoute<this>;

            return { ...(fetched as TClientPageRoute<this>), regex: route.regex, keys: route.keys };
        } catch (e) {
            console.error(`Failed to fetch the route ${route.chunk}`, e);
            try {
                this.app.handleUpdate();
            } catch (error) {}
            throw new Error('A new version of the website is available. Please refresh the page.');
        }
    }

    public set(data: TObjetDonnees) {
        throw new Error(`router.set was not attached to the router component.`);
    }

    private async initialRender(route: TUnresolvedRoute | undefined) {
        debug && console.log(LogPrefix, `Initial render route`, route);

        if (!location) throw new Error(`Unable to retrieve current location.`);

        if (!route) throw new Error(`Unable to resolve route.`);

        const request = new ClientRequest(location, this);

        // Restituate SSR response
        let apiData: {} = {};
        if (this.ssrContext) {
            request.user = this.ssrContext.user || null;

            request.data = this.ssrContext.request.data;

            apiData = this.ssrContext.page.data || {};
        }

        // Replacer api data par ssr data

        const response = await this.createResponse(route, request, apiData);

        ReactDOM.hydrate(<App context={response.context as AppPropsContext} />, document.body, () => {
            console.log(`Render complete`);

            this.runHook('page.rendered', request);
        });
    }

    private async createResponse(
        route: TUnresolvedRoute | TClientPageErrorRoute<this> | TClientPageRoute<this>,
        request: ClientRequest<this>,
        pageData: {} = {},
    ): Promise<ClientPage<this>> {
        // Load the route if not done before
        if ('load' in route) {
            if ('code' in route) {
                const loadedRoute = await this.load(route);
                this.errors[route.code] = loadedRoute;
                route = loadedRoute;
            } else {
                const loadedRoute = await this.load(route);
                this.routes[route.index] = loadedRoute;
                route = loadedRoute;
            }
        }

        // Run controller
        // TODO: tell that ruController on the client side always returns pages
        try {
            const response = new ClientResponse<this, ClientPage<this>>(request, route);
            return await response.runController(pageData);
        } catch (error) {
            return await this.createErrorResponse(error, request);
        }
    }

    private async createErrorResponse(
        e: any,
        request: ClientRequest<this>,
        pageData: {} = {},
    ): Promise<ClientPage<this>> {
        const code = 'http' in e ? e.http : 500;
        console.log(`Loading error page ` + code);
        let route = this.errors[code];

        // Nor page configurated for this error
        if (route === undefined) {
            console.error(`Error page for http error code ${code} not found.`, this.errors, this.routes);
            e.http = 404;
            this.app.handleError(e);
            throw new Error(`Error page for http error code ${code} not found.`);
        }

        // Load if not done before
        if ('load' in route) route = this.errors[code] = await this.load(route);

        const response = new ClientResponse<this, ClientPage<this>>(request, route);
        return await response.runController(pageData);
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/
    private hooks: { [hookname in THookName]?: (THookCallback<this> | null)[] } = {};

    public on(hookName: THookName, callback: THookCallback<this>) {
        debug && console.info(LogPrefix, `Register hook ${hookName}`);

        let cbIndex: number;
        let callbacks = this.hooks[hookName];
        if (!callbacks) {
            cbIndex = 0;
            callbacks = this.hooks[hookName] = [callback];
        } else {
            cbIndex = callbacks.length;
            callbacks.push(callback);
        }

        // Listener remover
        return () => {
            debug && console.info(LogPrefix, `De-register hook ${hookName} (index ${cbIndex})`);
            this.hooks[hookName] = this.hooks[hookName]?.filter((_, index) => index !== cbIndex);
        };
    }

    public runHook(hookName: THookName, request: ClientRequest<this>) {
        const callbacks = this.hooks[hookName];
        if (callbacks)
            // callback can be null since we use delete to unregister
            for (const callback of callbacks) callback && callback(request);
    }
}
