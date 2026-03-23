/* INSPIRATION:
    https://laravel.com/docs/8.x/responses
    https://docs.adonisjs.com/guides/response
*/

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import express from 'express';

// Core
import context from '@server/context';
import type { AnyRouterService, default as ServerRouter, TServerRouter, TAnyRouter } from '@server/services/router';
import ServerRequest from '@server/services/router/request';
import { TMatchedRoute, TRoute, TAnyRoute, TDomainsList } from '@common/router';
import { NotFound, Forbidden, Anomaly } from '@common/errors';
import BaseResponse, { TResponseData } from '@common/router/response';
import { splitRouteSetupResult } from '@common/router/pageSetup';
import Page from './page';
import createControllers from '@generated/common/controllers';
import type { TControllers } from '@generated/common/controllers';

// To move into a new npm module: json-mask
import jsonMask from './mask';

// Types
import type { TBasicUser } from '@server/services/auth';

/*----------------------------------
- TYPES
----------------------------------*/

const debug = true;

export type TBasicSSrData = {
    request: { data: TObjetDonnees; id: string };
    page: { chunkId: string; data?: TObjetDonnees };
    user: TBasicUser | null;
    domains: TDomainsList;
};

type TServerRouterApplication<TRouter extends TServerRouter> =
    TRouter extends ServerRouter<infer TApplication, any, any> ? TApplication : never;

type TServerRouterPlugins<TRouter extends TServerRouter> =
    TRouter extends ServerRouter<any, any, infer TConfig>
        ? TConfig extends { plugins: infer TPlugins }
            ? TPlugins
            : {}
        : {};

type TServerRouterCustomContext<TRouter extends TServerRouter> =
    TRouter extends ServerRouter<any, any, infer TConfig>
        ? TConfig extends { context: (...args: any[]) => infer TContext }
            ? TContext
            : {}
        : {};

export type TRouterContext<TRouter extends TServerRouter> =
    // Request context
    {
        app: TServerRouterApplication<TRouter>;
        context: TRouterContext<TRouter>; // = this
        request: ServerRequest<TRouter>;
        api: ServerRequest<TRouter>['api'];
        response: ServerResponse<TRouter>;
        route: TAnyRoute<TRouterContext<TRouter>>;
        page?: Page;

        Router: TRouter;
    } & TRouterContextServices<TRouter> &
        TControllers &
        TServerRouterCustomContext<TRouter>;

export type TRouterContextServices<
    TRouter extends TServerRouter,
    TPlugins extends object = TServerRouterPlugins<TRouter>,
> =
    // Custom context via servuces
    // For each roiuter service, return the request service (returned by roiuterService.requestService() )
    {
        [serviceName in keyof TPlugins]: TPlugins[serviceName] extends AnyRouterService
            ? Exclude<ReturnType<TPlugins[serviceName]['requestService']>, null | undefined>
            : TPlugins[serviceName];
    };

export type TRouterRequestContext<TRouter extends TServerRouter> = TServerRouterCustomContext<TRouter>;

/*----------------------------------
- CLASSE
----------------------------------*/
export default class ServerResponse<
    TRouter extends TAnyRouter,
    TRequestContext extends TRouterContext<TRouter> = TRouterContext<TRouter>,
    TData extends TResponseData = TResponseData,
> extends BaseResponse<TData, ServerRequest<TRouter>> {
    // Services
    public app: TRouter['app'];
    public router: TRouter;

    // Response metadata
    public statusCode: number = 200;
    public headers: { [cle: string]: string } = {};
    public cookie: express.Response['cookie'];
    public clearCookie: express.Response['clearCookie'];
    public canonicalUrl: URL;

    // If data was provided by at lead one controller
    public wasProvided = false;

    public constructor(request: ServerRequest<TRouter>) {
        super(request);

        this.cookie = this.request.res.cookie.bind(this.request.res);
        this.clearCookie = this.request.res.clearCookie.bind(this.request.res);

        this.router = request.router;
        this.app = this.router.app;

        this.canonicalUrl = new URL(request.url);
        this.canonicalUrl.search = '';
    }

    public async runController(route: TAnyRoute<TRouterContext<TRouter>>, additionnalData: {} = {}) {
        this.route = route;

        // Update canonical url
        this.updateCanonicalUrl(route);

        // Create response context for controllers
        const requestContext = await this.createContext(route);
        const contextStore = context.getStore() as
            | { requestContext?: TRouterContext<TAnyRouter>; inputSchemaUsed?: boolean }
            | undefined;
        if (contextStore) {
            contextStore.requestContext = requestContext;
            contextStore.inputSchemaUsed = false;
        }

        // Run controller
        const content = await this.route.controller(requestContext);
        if (content === undefined) return;

        // No need to process the content
        if (content instanceof ServerResponse) return;
        // Render react page to html
        else if (content instanceof Page) await this.render(content, requestContext, additionnalData);
        // Return HTML
        else if (typeof content === 'string' && this.route.options.accept === 'html') await this.html(content);
        // Return JSON
        else await this.json(content);
    }

    private updateCanonicalUrl(route: TAnyRoute<TRouterContext<TRouter>>) {
        if (!route.options.canonicalParams) return;

        for (const key of route.options.canonicalParams) {
            const paramValue = this.request.data[key];
            if (paramValue !== undefined) this.canonicalUrl.searchParams.set(key, paramValue);
        }
    }

    /*----------------------------------
    - INTERNAL
    ----------------------------------*/

    public async resolveRouteOptions(
        route: TMatchedRoute<TRouterContext<TRouter>>,
    ): Promise<TMatchedRoute<TRouterContext<TRouter>>> {
        const setup = route.options.setup;
        if (!setup) return route;

        const requestContext = await this.createContext(route);
        const { options } = splitRouteSetupResult(((setup as any)({ ...requestContext, data: this.request.data }) as {}) || {});

        return { ...route, options: { ...route.options, ...options } };
    }

    // Start controller services
    private async createContext(route: TAnyRoute<TRouterContext<TRouter>>): Promise<TRequestContext> {
        const contextServices = this.router.createContextServices(this.request);

        const customSsrData = this.router.config.context(this.request, this.app) as TRouterRequestContext<TRouter>;

        // TODO: transmiss safe data (especially for Router), as Router info could be printed on client side
        const requestContext = {
            // Router context
            app: this.app,
            context: undefined!,
            request: this.request,
            response: this,
            route: route,
            api: this.request.api,

            Router: this.router,
            ...(this.app as {}),
            ...createControllers(this.request.api),

            // Router services
            ...(contextServices as TRouterContextServices<TRouter>),
            ...customSsrData,
        } as TRequestContext;

        requestContext.context = requestContext;

        return requestContext;
    }

    public forSsr(page: Page<TRouter>): TBasicSSrData {
        const customSsrData = this.router.config.context(this.request, this.app);

        return {
            request: { id: this.request.id, data: this.request.data },
            page: { chunkId: page.chunkId || '', data: page.data },
            user: this.request.user,
            domains: this.router.config.domains,
            ...customSsrData,
        };
    }

    public status(code: number) {
        this.statusCode = code;
        return this;
    }

    public setHeaders(headers: { [cle: string]: string }) {
        this.headers = { ...this.headers, ...headers };
        return this;
    }

    /*----------------------------------
    - DATA RESPONSE
    ----------------------------------*/

    public type(mimetype: string) {
        this.headers['Content-Type'] = mimetype;
        return this;
    }

    public async render(page: Page, context: TRouterContext<TRouter>, additionnalData: {}) {
        // Set page in context for the client side
        context.page = page;

        // Prepare page & fetch data
        page.data = await page.fetchData();
        if (additionnalData !== undefined)
            // Example: error message for error pages
            page.data = { ...page.data, ...additionnalData };

        // Render page
        await this.router.runHook('render', page);
        const document = await page.render();
        this.html(document);

        // Never put html in the cache
        // Because assets urls need to be updated when their hash has been changed by a release
        this.request.res.setHeader('Expires', '0');
    }

    public async json(data?: any, mask?: string) {
        // RAPPEL: On jsonMask aussi les requetes internes, car leurs données seront imprimées au SSR pour le contexte client
        // filtreApi vérifie systèmatiquement si la donnée a été filtrée
        // NOTE: On évite le filtrage sans masque spécifié (performances + risques erreurs)
        if (mask !== undefined) data = await jsonMask(data, mask);

        this.headers['Content-Type'] = 'application/json';
        this.data = (this.request.isVirtual ? data : JSON.stringify(data)) as TData;
        return this.end();
    }

    public html(html: string) {
        this.headers['Content-Type'] = 'text/html';
        this.data = html as TData;
        return this.end();
    }

    public xml(xml: string) {
        this.headers['Content-Type'] = 'text/xml';
        this.data = xml as TData;
        return this.end();
    }

    public text(text: string, mimetype: string = 'text/plain') {
        this.headers['Content-Type'] = mimetype;
        this.data = text as TData;
        return this.end();
    }

    // TODO: https://github.com/adonisjs/http-server/blob/develop/src/Response/index.ts#L430
    public async file(filename: string, mimetype?: string) {
        // Securité
        if (filename.includes('..')) throw new Forbidden('Disallowed');

        // // Force absolute path
        // if (!filename.startsWith( this.app.path.root ))
        //     filename = filename[0] === '/'
        //         ? this.app.path.root + '/bin' + filename
        //         : this.app.path.data + '/' + filename;
        // Disk not provided = file response disabled
        if (this.router.disks === undefined)
            throw new Anomaly(
                'Router: Unable to return file response in router, because no disk has been given in the router config.',
            );

        // Retirve disk driver
        const disk = this.router.disks.get('default');

        // Verif existance
        const fileExists = await disk.exists('data', filename);
        if (!fileExists) {
            console.log('File ' + filename + ' was not found.');
            throw new NotFound();
        }

        // envoi filename
        const file = await disk.readFile('data', filename, { encoding: 'buffer' });
        this.data = file as TData;

        // Mimetype
        if (mimetype !== undefined) this.headers['Content-Type'] = mimetype;

        return this.end();
    }

    public redirect(url: string, code: number = 302, absolute: boolean = false) {
        debug && console.log('[routeur][response] Redirect', url);
        this.statusCode = code;
        this.headers['Location'] = this.router.url(url, {}, absolute);
        return this.end();
    }

    public end() {
        this.wasProvided = true;
        return this;
    }

    public next() {
        this.wasProvided = false;
        return this;
    }
}
