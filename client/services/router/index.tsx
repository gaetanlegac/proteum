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
    type TRouteDefinition,
    type TRouteMetadata,
    matchRoute,
    buildUrl,
    withRouteMetadata,
} from '@common/router';
import type { TRegisterPageArgs, TSsrUnresolvedRoute } from '@common/router/contracts';
import { getLayout } from '@common/router/layouts';
import { getRegisterPageArgs, buildRegex } from '@common/router/register';
import { TFetcherList } from '@common/router/request/api';
import type { TFrontRenderer, TPageDataProvider, TPageRenderer } from '@common/router/response/page';

import App from '@client/app/component';
import type ClientApplication from '@client/app';
import Service from '@client/app/service';

// Specific
import ClientRequest, { isClientRequest } from './request';
import { location, history } from './request/history';
import ClientResponse, { type TRouterContext } from './response';
import ClientPage from './response/page';
import type { TNavigationMode } from './navigation';

type AppPropsContext = Parameters<typeof App>[0]['context'];

// Routes (import __register)
import appRoutes from '@generated/client/routes';

/*----------------------------------
- CONFIG
----------------------------------*/

const debug = false;
const LogPrefix = '[router]';
const browserWindow = window as Window & { routes?: TSsrUnresolvedRoute[]; ssr?: TBasicSSrData };

// Where requestIdleCallback is missing (Safari, iOS), the prefetch waits this long after hydration instead, so the
//  page's own requests, images and fonts go first rather than ten chunk downloads
const PREFETCH_IDLE_FALLBACK_MS = 2000;

// The Network Information API, Chromium only and missing from the DOM typings
type TNavigatorConnection = { connection?: { saveData?: boolean } };
const withProfiler = <T,>(callback: (runtime: (typeof import('@client/dev/profiler/runtime'))['profilerRuntime']) => T) => {
    if (!__DEV__) return undefined as T | undefined;
    const profilerModule = require('@client/dev/profiler/runtime') as typeof import('@client/dev/profiler/runtime');
    return callback(profilerModule.profilerRuntime);
};

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

type TLoadedRoute<TRouter extends TAnyClientRouter> = TClientPageRoute<TRouter> | TClientPageErrorRoute<TRouter>;

export type TRoutesLoaders = { [chunkId: string]: TRouteLoader<TClientPageRoute | TClientPageErrorRoute> };

/*----------------------------------
- SERVICE TYPES
----------------------------------*/

export type THookCallback<TRouter extends TAnyClientRouter> = (request: ClientRequest<TRouter>) => void;

// page.ready: the page shows its data. After hydration on the first load, then after every navigation
//  (with the swap on a blocking page, when the data arrives on a deferred one).
type THookName = 'page.change' | 'page.changed' | 'page.rendered' | 'page.ready';

type Config = {
    preload: string[]; // List of globs
    // Route paths whose chunks load at idle after the first render
    prefetch?: string[];
    // 'deferred' lets pages declaring navigation: 'deferred' swap in before their data. Default 'blocking'.
    navigation?: { mode: TNavigationMode };
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
    public currentDomain = browserWindow.ssr?.currentDomain || window.location.origin;
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
        buildUrl(path, params, this.currentDomain, absolute);

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

    // One load per chunk: a navigation joins a prefetch already in flight
    private routeLoads: {
        [chunk: string]: Promise<TLoadedRoute<ClientRouter<TApplication, TConfig>>> | undefined;
    } = {};

    public async registerRoutes() {
        const loaders = appRoutes as unknown as TRoutesLoaders;
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

    public registerRouteDefinition(definition: TRouteDefinition, metadata: TRouteMetadata = {}) {
        if (definition.kind === 'page') {
            return this.page(
                definition.path,
                withRouteMetadata(definition.options, metadata),
                definition.data,
                definition.render,
            );
        }

        if (definition.kind === 'error') {
            return this.error(definition.code, withRouteMetadata(definition.options, metadata), definition.render);
        }

        throw new Error(`Client router cannot register server route definition: ${definition.method} ${definition.path}`);
    }

    protected page<TProvidedData extends {} = {}>(
        path: string,
        options: Partial<TRouteOptions>,
        data: TPageDataProvider<TProvidedData> | null,
        renderer: TPageRenderer<TProvidedData>,
    ): TClientPageRoute<this>;

    protected page(...args: TRegisterPageArgs<any, TRouteOptions>): TClientPageRoute<this> {
        const { path, options, data, renderer, layout } = getRegisterPageArgs(...args);

        // Page ids are injected by the generated route wrapper modules.
        const id = options.id;
        if (id === undefined) throw new Error(`Page route ${path} is missing its generated id metadata.`);

        const { regex, keys } = buildRegex(path);

        const route: TClientPageRoute<this> = {
            method: 'GET',
            path,
            regex,
            keys,
            data,
            options: { ...defaultOptions, ...options },
            controller: (context) => new ClientPage(route, renderer, context as any, layout),
        };

        this.routes.push(route);

        return route;
    }

    protected error(
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
    // `isCurrent`: the caller's navigation is still the latest. Null when it is not anymore once the chunk loaded.
    public async resolve(request: ClientRequest<this>, isCurrent?: () => boolean): Promise<ClientPage<this> | null> {
        debug && console.log(LogPrefix, 'Resolving request', request.path, Object.keys(request.data));

        for (let iRoute = 0; iRoute < this.routes.length; iRoute++) {
            let route = this.routes[iRoute];
            if (!('regex' in route) || !(route.regex instanceof RegExp) || !('keys' in route) || !Array.isArray(route.keys))
                continue;

            const isMatching = matchRoute({ regex: route.regex, keys: route.keys }, request);
            if (!isMatching) continue;

            // Create response
            debug && console.log(LogPrefix, 'Resolved request', request.path, '| Route:', route);
            withProfiler((runtime) =>
                runtime.completeResolveStep({
                    chunkId: 'chunk' in route ? route.chunk : route.options.id,
                    routeLabel: request.path,
                }),
            );
            const page = await this.createResponse(route, request, {}, isCurrent);

            return page;
        }

        const notFoundRoute = this.errors[404];
        withProfiler((runtime) => runtime.completeResolveStep({ routeLabel: '404' }));
        return await this.createResponse(notFoundRoute, request, { error: new Error('Page not found') }, isCurrent);
    }

    private async load(route: TUnresolvedNormalRoute): Promise<TClientPageRoute<this>>;
    private async load(route: TUnresolvedErrorRoute): Promise<TClientPageErrorRoute<this>>;
    private async load(
        route: TUnresolvedNormalRoute | TUnresolvedErrorRoute,
    ): Promise<TClientPageRoute<this> | TClientPageErrorRoute<this>> {
        //throw new Error(`Failed to load route: ${route.chunk}`);

        debug && console.log(`Fetching route ${route.chunk} ...`, route);
        const stepId = withProfiler((runtime) => runtime.startChunkStep(route.chunk));
        try {
            const fetched = await this.loadRoute(route);

            debug && console.log(`Route fetched: ${route.chunk}`, fetched);
            withProfiler((runtime) => runtime.finishStep(stepId));

            return fetched;
        } catch (e) {
            withProfiler((runtime) =>
                runtime.finishStep(stepId, 'error', e instanceof Error ? e.message : String(e)),
            );
            console.error(`Failed to fetch the route ${route.chunk}`, e);
            try {
                this.app.handleUpdate();
            } catch (error) {}
            throw new Error('A new version of the website is available. Please refresh the page.');
        }
    }

    private loadRoute(route: TUnresolvedNormalRoute | TUnresolvedErrorRoute): Promise<TLoadedRoute<this>> {
        const pending = this.routeLoads[route.chunk];
        if (pending) return pending;

        const load = route
            .load()
            .then((loaded) => {
                const fetched = loaded.__register(this.app);
                if ('code' in route) return fetched as TClientPageErrorRoute<this>;

                return { ...(fetched as TClientPageRoute<this>), regex: route.regex, keys: route.keys };
            })
            .finally(() => {
                delete this.routeLoads[route.chunk];
            });

        this.routeLoads[route.chunk] = load;
        return load;
    }

    /*----------------------------------
    - PREFETCH
    ----------------------------------*/

    // Loads the route chunk of a path ahead of the navigation. Best effort: a failure is left to the navigation.
    public async prefetch(path: string) {
        const pathname = path.split(/[?#]/)[0];
        const route = this.routes.find(
            (candidate) =>
                candidate !== undefined &&
                'regex' in candidate &&
                candidate.regex instanceof RegExp &&
                candidate.regex.test(pathname),
        );
        if (route === undefined || !('load' in route)) return;

        try {
            const loaded = await this.loadRoute(route);
            if ('load' in this.routes[route.index]) this.routes[route.index] = loaded as TClientPageRoute<this>;
        } catch (error) {
            debug && console.warn(LogPrefix, `Unable to prefetch ${path}`, error);
        }
    }

    private prefetchAtIdle() {
        const paths = this.config.prefetch || [];
        if (paths.length === 0) return;

        // Data saver: the visitor asked for fewer bytes, and a prefetched chunk is bytes they may never use
        const { connection } = window.navigator as Navigator & TNavigatorConnection;
        if (connection?.saveData === true) return;

        const whenIdle =
            window.requestIdleCallback ||
            ((callback: () => void) => window.setTimeout(callback, PREFETCH_IDLE_FALLBACK_MS));
        whenIdle(() => {
            // One chunk at a time, so prefetching never competes with itself
            void paths.reduce<Promise<void>>((chain, path) => chain.then(() => this.prefetch(path)), Promise.resolve());
        });
    }

    public set(data: TObjetDonnees) {
        throw new Error(`router.set was not attached to the router component.`);
    }

    private async initialRender(route: TUnresolvedRoute | undefined) {
        debug && console.log(LogPrefix, `Initial render route`, route);

        if (!location) throw new Error(`Unable to retrieve current location.`);

        if (!route) throw new Error(`Unable to resolve route.`);

        const request = new ClientRequest(location, this);
        withProfiler((runtime) =>
            runtime.ensureInitialSession({
                path: request.path,
                requestId: this.ssrContext?.request.id,
                url: request.url,
            }),
        );

        // Restituate SSR response
        let apiData: {} = {};
        if (this.ssrContext) {
            request.user = this.ssrContext.user || null;

            request.data = this.ssrContext.request.data;

            apiData = this.ssrContext.page.data || {};
        }

        // Replacer api data par ssr data

        const response = await this.createResponse(route, request, apiData);

        ReactDOM.hydrate(<App context={response.context as unknown as AppPropsContext} />, document.body, () => {
            console.log(`Render complete`);
            withProfiler((runtime) => runtime.markInitialHydrated({ chunkId: response.chunkId, title: response.title }));

            this.runHook('page.rendered', request);
            this.prefetchAtIdle();
        });
    }

    private createResponse(
        route: TUnresolvedRoute | TClientPageErrorRoute<this> | TClientPageRoute<this>,
        request: ClientRequest<this>,
        pageData?: {},
    ): Promise<ClientPage<this>>;
    private createResponse(
        route: TUnresolvedRoute | TClientPageErrorRoute<this> | TClientPageRoute<this>,
        request: ClientRequest<this>,
        pageData: {},
        isCurrent: (() => boolean) | undefined,
    ): Promise<ClientPage<this> | null>;
    private async createResponse(
        route: TUnresolvedRoute | TClientPageErrorRoute<this> | TClientPageRoute<this>,
        request: ClientRequest<this>,
        pageData: {} = {},
        isCurrent?: () => boolean,
    ): Promise<ClientPage<this> | null> {
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

            // A newer navigation started during the load: building the response would overwrite its context
            if (isCurrent && !isCurrent()) return null;
        }

        // Run controller
        // TODO: tell that ruController on the client side always returns pages
        try {
            const response = new ClientResponse<this, ClientPage<this>>(request, route);
            return await response.runController(pageData);
        } catch (error) {
            return await this.createErrorResponse(error, request, {}, isCurrent);
        }
    }

    private async createErrorResponse(
        e: any,
        request: ClientRequest<this>,
        pageData: {} = {},
        isCurrent?: () => boolean,
    ): Promise<ClientPage<this> | null> {
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
        if ('load' in route) {
            route = this.errors[code] = await this.load(route);
            // Same guard as createResponse: a newer navigation owns the router context now
            if (isCurrent && !isCurrent()) return null;
        }

        const response = new ClientResponse<this, ClientPage<this>>(request, route);
        return await response.runController(pageData);
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/
    private hooks: { [hookname in THookName]?: THookCallback<this>[] } = {};

    public on(hookName: THookName, callback: THookCallback<this>) {
        debug && console.info(LogPrefix, `Register hook ${hookName}`);

        this.hooks[hookName] = [...(this.hooks[hookName] || []), callback];

        // Listener remover: by reference, since an index shifts once an earlier listener is removed
        return () => {
            debug && console.info(LogPrefix, `De-register hook ${hookName}`);
            this.hooks[hookName] = this.hooks[hookName]?.filter((registered) => registered !== callback);
        };
    }

    public runHook(hookName: THookName, request: ClientRequest<this>) {
        const callbacks = this.hooks[hookName];
        if (callbacks) for (const callback of callbacks) callback(request);
    }
}
