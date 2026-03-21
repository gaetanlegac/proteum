/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type zod from 'zod';

// types
import type {
    default as ClientRouter,
    TRouterContext as ClientRouterContext
} from '@client/services/router';
import type { TRegisterPageArgs } from './contracts';

import type { 
    TAnyRouter,
    TRouterContext as ServerRouterContext,
    TRouteHttpMethod 
} from '@server/services/router';

import type RouterRequest from './request';

import type { TUserRole } from '@server/services/auth';

import type { TAppArrowFunction } from '@common/app';

// Specfic
import type { default as Page, TFrontRenderer, TDataProvider } from './response/page';

/*----------------------------------
- TYPES: ROUTES
----------------------------------*/

export type { Layout } from './layouts';

export type { default as Request } from './request';
export type { default as Response } from './response';

export type ClientOrServerRouter = ClientRouter | TAnyRouter;

export type TRoute<RouterContext extends TClientOrServerContextForPage = TClientOrServerContextForPage> = {

    // Match
    method: TRouteHttpMethod,
    path: string,

    // Execute
    schema?: zod.ZodSchema,
    controller: TRouteController<RouterContext>,
    options: TRouteOptions
} & (
    // With regex
    {
        regex: RegExp,
        keys: (number | string)[],
    }
    // Without regex (for ex: controllers)
    | 
    {
        regex?: undefined,
        keys?: undefined,
    }
)

export type TErrorRoute<RouterContext extends TClientOrServerContextForPage = TClientOrServerContextForPage> = {
    code,
    controller: TRouteController<RouterContext>,
    options: TRouteOptions
}

export type TAnyRoute<RouterContext extends TClientOrServerContextForPage = TClientOrServerContextForPage> =
    TRoute<RouterContext> | TErrorRoute<RouterContext>

// ClientRouterContext already includes server context
export type TClientOrServerContext = ClientRouterContext;// | ServerRouterContext;

export type TClientOrServerContextForPage = With<TClientOrServerContext, 'page'>

export type TRouteController<RouterContext extends TClientOrServerContextForPage = TClientOrServerContextForPage> = 
    (context: RouterContext) => /* Page to render */Page | /* Any data (html, json) */Promise<any>

export type TRouteOptions = {

    // Injected by the page plugin
    filepath?: string,
    data?: TDataProvider

    // Indexing
    bodyId?: string,
    priority: number,
    preload?: boolean,

    // Resolving
    domain?: string,
    accept?: string,
    raw?: boolean, // true to return raw data
    auth?: TUserRole | boolean,
    redirectLogged?: string, // Redirect to this route if auth: false and user is logged

    // Rendering
    static?: { 
        refresh?: string, 
        urls: string[] 
    },
    whenStatic?: boolean, // If true, the route is only executed even if the page is cached
    canonicalParams?: string[], // For SEO + unique ID for static cache
    layout?: false | string, // The nale of the layout

    // To cleanup
    TESTING?: boolean,
    logging?: boolean,
}

export type TRouteModule<TRegisteredRoute = any> = { 
    // exporing __register is a way to know we axport a TAppArrowFunction
    __register?: TAppArrowFunction<TRegisteredRoute> 
}

export type TDomainsList = {
    [endpointId: string]: string
} & {
    current: string
}

export const defaultOptions = {
    priority: 0,
}

/*----------------------------------
- FUNCTIONS
----------------------------------*/
export const buildUrl = (
    path: string,
    params: {[key: string]: any},
    domains: {[alias: string]: string},
    absolute: boolean
) => {

    let prefix: string = '';

    // Relative to domain
    if (path[0] === '/' && absolute)
        prefix = domains.current;
    // Other domains of the project
    else if (path[0] === '@') {

        // Extract domain ID from path
        let domainId: string;
        let slackPos = path.indexOf('/');
        if (slackPos === -1)
            slackPos = path.length;
        domainId = path.substring(1, slackPos);
        path = path.substring(slackPos);

        // Get domain
        const domain = domains[ domainId ];
        if (domain === undefined)
            throw new Error("Unknown API endpoint ID: " + domainId);

        // Return full url
        prefix = domain;

    // Absolute URL
    }

    // Path parapeters
    const searchParams = new URLSearchParams();
    for (const key in params) {

        // Exclude undefined of empty
        if (!params[key])
            continue;
        // Path placeholder
        else if (path.includes(':' + key))
            path = path.replace(':' + key, params[key]);
        // Query string
        else 
            searchParams.set(key, params[key]);
    }

    // Return final url
    return prefix + path + (searchParams.toString() ? '?' + searchParams.toString() : '');
}

export const matchRoute = (route: TRoute, request: RouterRequest) => {

    // Match Path
    const match = route.regex.exec(request.path);
    if (!match)
        return false;

    // Extract URL params
    for (let iKey = 0; iKey < route.keys.length; iKey++) {
        const key = route.keys[iKey];
        const value =  match[iKey + 1];
        if (typeof key === 'string' && value) // number = sans nom
            request.data[key] = decodeURIComponent( value.replaceAll('+', '%20') );
    }

    return true;
}

/*----------------------------------
- BASE ROUTER
----------------------------------*/

export default abstract class RouterInterface {

    public abstract page<TControllerData extends TObjetDonnees = {}>(...args: TRegisterPageArgs<TControllerData, TRouteOptions>);

    public abstract error(code: number, options, renderer: TFrontRenderer<{}, { message: string }>);

}
