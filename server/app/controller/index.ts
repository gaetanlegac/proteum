/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from 'zod';

// Core
import context from '@server/context';
import {
    toValidationSchema,
    type TValidationSchema,
    type TValidationShape,
} from '@server/services/router/request/validation/zod';
import type {
    Request as ServerRequest,
    Response as ServerResponse,
    TAnyRouter,
    TRouterContextServices,
} from '@server/services/router';

export { schema } from '@server/services/router/request/validation/zod';
export type {
    z,
    TInferValidationSchema,
    TTypedValidationSchema,
    TValidationSchema,
    TValidationShape,
} from '@server/services/router/request/validation/zod';

/*----------------------------------
- TYPES
----------------------------------*/

type TControllerModelsClient<TApplication extends object = object> = TApplication extends {
    Models: { client: infer TModels };
}
    ? TModels
    : TApplication extends {
            models: { client: infer TModels };
        }
      ? TModels
      : object;

type TControllerRouter<TRouter> = TRouter extends TAnyRouter ? TRouter : TAnyRouter;
type TControllerApplicationRouter<TApplication extends object> = TApplication extends { Router: infer TRouter }
    ? TControllerRouter<TRouter>
    : TAnyRouter;

export type TControllerRequestContext<
    TApplication extends object = object,
    TRouter extends object = object,
    TRequestServices extends object = {},
> = {
    app: TApplication;
    context: object;
    request: ServerRequest<TControllerRouter<TRouter>>;
    api: ServerRequest<TControllerRouter<TRouter>>['api'];
    response: ServerResponse<TControllerRouter<TRouter>>;
    route: object;
    page?: object;
    Router: TControllerRouter<TRouter>;
} & (TRouter extends TAnyRouter ? TRouterContextServices<TControllerRouter<TRouter>> : {}) &
    TRequestServices;

type TControllerBaseContext<TApplication extends object> = {
    app: TApplication;
    request: { data: TObjetDonnees };
};

type TControllerDefaultContext<TApplication extends object, TRequestServices extends object> = {
    app: TApplication;
    context: object;
    request: ServerRequest<TControllerApplicationRouter<TApplication>>;
    api: ServerRequest<TControllerApplicationRouter<TApplication>>['api'];
    response: ServerResponse<TControllerApplicationRouter<TApplication>>;
    route: object;
    page?: object;
    Router: TControllerApplicationRouter<TApplication>;
} & TRouterContextServices<TControllerApplicationRouter<TApplication>> &
    TRequestServices;

/*----------------------------------
- CLASS
----------------------------------*/

export default abstract class Controller<
    TApplication extends object = object,
    TRouter extends object = object,
    TRequestServices extends object = {},
    TContext extends TControllerBaseContext<TApplication> = TControllerDefaultContext<TApplication, TRequestServices>,
> {
    public constructor(public request: TContext) {}

    public get app(): TApplication {
        return this.request.app as TApplication;
    }

    public get services(): TApplication {
        return this.app;
    }

    public get models(): TControllerModelsClient<TApplication> {
        const app = this.app as {
            models?: { client?: TControllerModelsClient<TApplication> };
            Models?: { client?: TControllerModelsClient<TApplication> };
        };
        return (app.models?.client ?? app.Models?.client) as TControllerModelsClient<TApplication>;
    }

    public input<TSchema extends TValidationSchema>(schema: TSchema): zod.output<TSchema>;
    public input<TShape extends TValidationShape>(schema: TShape): zod.output<zod.ZodObject<TShape>>;
    public input(schema: TValidationSchema | TValidationShape) {
        const store = context.getStore() as { inputSchemaUsed?: boolean } | undefined;

        if (store?.inputSchemaUsed) throw new Error('Controller.input() can only be called once per request handler.');

        if (store) store.inputSchemaUsed = true;

        return toValidationSchema(schema).parse(this.request.request.data);
    }
}
