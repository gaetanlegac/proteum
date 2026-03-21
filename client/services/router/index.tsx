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
    TClientOrServerContextForPage,
    TRouteModule,
    matchRoute,
    buildUrl,
} from '@common/router';
import type { TRegisterPageArgs, TSsrUnresolvedRoute } from '@common/router/contracts';
import { getLayout } from '@common/router/layouts';
import { getRegisterPageArgs, buildRegex } from '@common/router/register';
import { TFetcherList } from '@common/router/request/api';
import type { TFrontRenderer } from '@common/router/response/page';

import App from '@client/app/component';
import type ClientApplication from '@client/app';
import Service from '@client/app/service';

// Specific
import type { ClientContext } from '@/client/context';
import ClientRequest from './request';
import { location, history } from './request/history';
import ClientResponse from './response';
import ClientPage from './response/page';

// Routes (import __register)
import appRoutes from '@/client/.generated/routes';

/*----------------------------------
- CONFIG
----------------------------------*/

const debug = false;
const LogPrefix = '[router]';

/*----------------------------------
- TYPES
----------------------------------*/

// Client router can handle Client requests AND Server requests (for pages only)
export type { default as ClientResponse, TRouterContext } from './response';

export type Router = ClientRouter | TAnyRouter;

export type Request = ClientRequest<ClientRouter> | ServerRequest<TAnyRouter>;

export type Response = ClientResponse<ClientRouter> | ServerResponse<TAnyRouter>;

/*----------------------------------
- TYPES: ROUTES LOADING
----------------------------------*/

// WARN: Keep this aligned with the generated route wrapper contract on both sides.
// Route definition without having loaded the controller
type TUnresolvedRoute = TUnresolvedErrorRoute | TUnresolvedNormalRoute;

export type TUnresolvedErrorRoute = { index: number; chunk: string; code: number; load: TRouteLoader<TErrorRoute> };

export type TUnresolvedNormalRoute = { index: number; chunk: string; code: number; load: TRouteLoader<TErrorRoute> };

type TRouteLoader<Route extends TRoute | TErrorRoute = TRoute | TErrorRoute> = () => Promise<TRouteModule<Route>>;

export type TFetchedRoute = Pick<TRoute, 'path' | 'options' | 'controller' | 'method'>;

export type TRoutesLoaders = {
    [chunkId: string]: () => Promise<
        /* Preloaded via require() */ TFetchedRoute | /* Loader via import() */ TRouteLoader /* | undefined*/
    >;
};

/*----------------------------------
- SERVICE TYPES
----------------------------------*/

export type THookCallback<TRouter extends ClientRouter> = (request: ClientRequest<TRouter>) => void;

type THookName = 'page.change' | 'page.changed' | 'page.rendered';

type Config<TAdditionnalContext extends {} = {}> = {
    preload: string[]; // List of globs
    context: (context: {}, router: ClientRouter) => TAdditionnalContext;
};

/*----------------------------------
- ROUTER
----------------------------------*/
export default class ClientRouter<
        TApplication extends ClientApplication = ClientApplication,
        TAdditionnalContext extends {} = {},
    >
    extends Service<Config<TAdditionnalContext>, ClientApplication>
    implements BaseRouter
{
    // Context data
    public ssrRoutes = window['routes'] as TSsrUnresolvedRoute[];
    public ssrContext = window['ssr'] as TBasicSSrData | undefined;
    public domains = window['ssr'].domains;
    public context!: ClientContext;

    public setLoading!: React.Dispatch<React.SetStateAction<boolean>>;
    public navigate!: (page: ClientPage, data?: {}) => void;

    public constructor(app: TApplication, config: Config<TAdditionnalContext>) {
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
            this.createResponse(this.errors[url], this.context.request, data).then((page) => {
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

    public routes: (TRoute | TUnresolvedNormalRoute)[] = [];
    public errors: { [code: number]: TErrorRoute | TUnresolvedErrorRoute } = {};

    public async registerRoutes() {
        const loaders: TRoutesLoaders = { ...appRoutes };
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
                route = this.errors[ssrRoute.code] = { code: ssrRoute.code, chunk: ssrRoute.chunk, load: loader };
            else
                route = this.routes[routeIndex] = {
                    index: routeIndex,
                    chunk: ssrRoute.chunk,
                    regex: new RegExp(ssrRoute.regex),
                    keys: ssrRoute.keys,
                    load: loader,
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

    public page<TProvidedData extends {} = {}>(path: string, renderer: TFrontRenderer<TProvidedData>): TRoute;

    public page<TProvidedData extends {} = {}>(
        path: string,
        setup: TRoute['options']['setup'],
        renderer: TFrontRenderer<TProvidedData>,
    ): TRoute;

    public page<TProvidedData extends {} = {}>(
        path: string,
        options: Partial<TRoute['options']>,
        renderer: TFrontRenderer<TProvidedData>,
    ): TRoute;

    public page<TProvidedData extends {} = {}>(
        path: string,
        options: Partial<TRoute['options']>,
        setup: TRoute['options']['setup'],
        renderer: TFrontRenderer<TProvidedData>,
    ): TRoute;

    public page(...args: TRegisterPageArgs<any, TRoute['options']>): TRoute {
        const { path, options, setup, renderer, layout } = getRegisterPageArgs(...args);

        // Page ids are injected by the generated route wrapper modules.
        const id = options['id'];
        if (id === undefined) throw new Error(`Page route ${path} is missing its generated id metadata.`);

        const { regex, keys } = buildRegex(path);

        const route: TRoute = {
            method: 'GET',
            path,
            regex,
            keys,
            options: { ...defaultOptions, setup, ...options },
            controller: (context: TClientOrServerContextForPage) => new ClientPage(route, renderer, context, layout),
        };

        this.routes.push(route);

        return route;
    }

    public error(code: number, options: Partial<TRoute['options']>, renderer: TFrontRenderer<{}, { message: string }>) {
        // Automatic layout form the nearest _layout folder
        const layout = getLayout('Error ' + code, options);

        const route: TErrorRoute = {
            code,
            controller: (context: TClientOrServerContextForPage) => new ClientPage(route, renderer, context, layout),
            options,
        };

        this.errors[code] = route;

        return route;
    }

    /*----------------------------------
    - RESOLUTION
    ----------------------------------*/
    public async resolve(request: ClientRequest<this>): Promise<ClientPage> {
        debug && console.log(LogPrefix, 'Resolving request', request.path, Object.keys(request.data));

        for (let iRoute = 0; iRoute < this.routes.length; iRoute++) {
            let route = this.routes[iRoute];
            if (!('regex' in route)) continue;

            const isMatching = matchRoute(route, request);
            if (!isMatching) continue;

            // Create response
            debug && console.log(LogPrefix, 'Resolved request', request.path, '| Route:', route);
            const page = await this.createResponse(route, request);

            return page;
        }

        const notFoundRoute = this.errors[404];
        return await this.createResponse(notFoundRoute, request, { error: new Error('Page not found') });
    }

    private async load(route: TUnresolvedNormalRoute): Promise<TRoute>;
    private async load(route: TUnresolvedErrorRoute): Promise<TErrorRoute>;
    private async load(route: TUnresolvedNormalRoute | TUnresolvedErrorRoute): Promise<TRoute | TErrorRoute> {
        //throw new Error(`Failed to load route: ${route.chunk}`);

        let fetched: TFetchedRoute;
        if (typeof route.load === 'function') {
            debug && console.log(`Fetching route ${route.chunk} ...`, route);
            try {
                const loaded = await route.load();

                fetched = loaded.__register(this.app);
            } catch (e) {
                console.error(`Failed to fetch the route ${route.chunk}`, e);
                try {
                    this.app.handleUpdate();
                } catch (error) {}
                throw new Error('A new version of the website is available. Please refresh the page.');
            }
        } else {
            debug && console.log(`Route already fetched: ${route.chunk}`, route.load);
            fetched = route.load;
        }

        debug && console.log(`Route fetched: ${route.chunk}`, fetched);
        return { ...fetched, regex: route.regex, keys: route.keys };
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

        ReactDOM.hydrate(<App context={response.context} />, document.body, () => {
            console.log(`Render complete`);

            this.runHook('page.rendered', request);
        });
    }

    private async createResponse(
        route: TUnresolvedRoute | TErrorRoute | TRoute,
        request: ClientRequest<this>,
        pageData: {} = {},
    ): Promise<ClientPage> {
        // Load the route if not done before
        if ('load' in route) route = this.routes[route.index] = await this.load(route);

        // Run controller
        // TODO: tell that ruController on the client side always returns pages
        try {
            const response = new ClientResponse<this, ClientPage>(request, route);
            return await response.runController(pageData);
        } catch (error) {
            return await this.createErrorResponse(error, request);
        }
    }

    private async createErrorResponse(e: any, request: ClientRequest<this>, pageData: {} = {}): Promise<ClientPage> {
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

        const response = new ClientResponse<this, ClientPage>(request, route);
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
