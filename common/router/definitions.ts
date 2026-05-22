/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { Request, Response, NextFunction } from 'express';

// Core
import type { TAnyRouter, TRouterContext, TRouteHttpMethod } from '@server/services/router';
import type { TFrontRenderer, TPageDataProvider } from './response/page';
import type { TRouteOptions } from '.';

/*----------------------------------
- TYPES
----------------------------------*/

export type TRouteMetadata = {
    filepath?: string;
    sourceLocation?: { line: number; column: number };
    id?: string;
};

export type TRouteDefinitionHttpMethod = TRouteHttpMethod | Lowercase<Exclude<TRouteHttpMethod, '*'>>;

export type TPageRouteDefinition<TProvidedData extends {} = {}> = {
    kind: 'page';
    path: string;
    options: Partial<TRouteOptions>;
    data: TPageDataProvider<TProvidedData> | null;
    render: TFrontRenderer<TProvidedData>;
};

export type TErrorRouteDefinition = {
    kind: 'error';
    code: number;
    options: Partial<TRouteOptions>;
    render: TFrontRenderer<{}, { message: string }>;
};

export type TServerRouteDefinition<TRouter extends TAnyRouter = TAnyRouter> = {
    kind: 'server';
    method: TRouteDefinitionHttpMethod;
    path: string;
    options: Partial<TRouteOptions>;
    handler: (context: TRouterContext<TRouter>) => any;
};

export type TRouteDefinition =
    | TPageRouteDefinition
    | TErrorRouteDefinition
    | TServerRouteDefinition;

export type TServerRouteDefinitionsFactory<TApplication extends object = object> = (
    app: TApplication,
) => TServerRouteDefinition[];

export type TRouteDefinitionExport =
    | TRouteDefinition
    | TRouteDefinition[]
    | TServerRouteDefinitionsFactory<any>
    | { default: TRouteDefinition | TRouteDefinition[] | TServerRouteDefinitionsFactory<any> };

export type TExpressRouteHandler<TRouter extends TAnyRouter = TAnyRouter> = (
    req: Request,
    res: Response,
    next: NextFunction,
    requestContext: TRouterContext<TRouter>,
) => void | Promise<void>;

export type TRouteDefinitionRegistrar = {
    registerRouteDefinition: (definition: TRouteDefinition, metadata?: TRouteMetadata) => unknown;
};

/*----------------------------------
- HELPERS
----------------------------------*/

export const definePageRoute = <TProvidedData extends {} = {}>({
    path,
    options,
    data,
    render,
}: Omit<TPageRouteDefinition<TProvidedData>, 'kind'>): TPageRouteDefinition<TProvidedData> => ({
    kind: 'page',
    path,
    options,
    data,
    render,
});

export const defineErrorRoute = ({
    code,
    options,
    render,
}: Omit<TErrorRouteDefinition, 'kind'>): TErrorRouteDefinition => ({
    kind: 'error',
    code,
    options,
    render,
});

export const defineServerRoute = <TRouter extends TAnyRouter = TAnyRouter>({
    method,
    path,
    options,
    handler,
}: Omit<TServerRouteDefinition<TRouter>, 'kind'>): TServerRouteDefinition<TRouter> => ({
    kind: 'server',
    method,
    path,
    options,
    handler,
});

export const defineServerRoutes = <
    TRouter extends TAnyRouter = TAnyRouter,
    TApplication extends object = object,
>(
    routes: TServerRouteDefinition<TRouter>[] | TServerRouteDefinitionsFactory<TApplication>,
) => routes;

export const expressHandler = <TRouter extends TAnyRouter = TAnyRouter>(
    middleware: TExpressRouteHandler<TRouter>,
) => {
    return (requestContext: TRouterContext<TRouter>) =>
        new Promise((resolve, reject) => {
            requestContext.request.res.on('finish', function () {
                resolve(true);
            });

            try {
                const result = middleware(
                    requestContext.request.req,
                    requestContext.request.res,
                    () => {
                        resolve(true);
                    },
                    requestContext,
                );

                if (result && typeof (result as Promise<void>).then === 'function') {
                    (result as Promise<void>).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
};

export const normalizeRouteDefinitions = (
    value: TRouteDefinition | TRouteDefinition[] | TServerRouteDefinitionsFactory<any>,
    app?: object,
) => {
    const definitions = typeof value === 'function' ? value(app || {}) : value;

    return Array.isArray(definitions) ? definitions : [definitions];
};

export const withRouteMetadata = <TOptions extends Partial<TRouteOptions>>(
    options: TOptions,
    metadata: TRouteMetadata,
): TOptions & TRouteMetadata => ({
    ...options,
    ...metadata,
});

export const registerRouteDefinition = (
    router: TRouteDefinitionRegistrar,
    definition: TRouteDefinition,
    metadata: TRouteMetadata = {},
) => {
    if (!router || typeof router.registerRouteDefinition !== 'function') {
        throw new Error('Proteum route definitions require a router with registerRouteDefinition(definition, metadata).');
    }

    return router.registerRouteDefinition(definition, metadata);
};
