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

export type TControllerRequestContext<
    TApplication extends object = object,
    TRouter extends object = object,
    TRequestServices extends object = {},
> = {
    app: object;
    context: object;
    request: { data: TObjetDonnees; request: { data: TObjetDonnees }; user?: object | null };
    api: object;
    response: object;
    route: object;
    page?: object;
    Router: TRouter;
} & TRequestServices;

/*----------------------------------
- CLASS
----------------------------------*/

export default abstract class Controller<
    TApplication extends object = object,
    TRouter extends object = object,
    TRequestServices extends object = {},
    TContext extends TControllerRequestContext<TApplication, TRouter, TRequestServices> = TControllerRequestContext<
        TApplication,
        TRouter,
        TRequestServices
    >,
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
