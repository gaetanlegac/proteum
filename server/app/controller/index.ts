/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from 'zod';

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

export type TControllerActionContext<
    TInput = undefined,
    TApplication extends object = object,
    TRequestServices extends object = {},
> = TControllerDefaultContext<TApplication, TRequestServices> & {
    input: TInput;
    models: TControllerModelsClient<TApplication>;
    services: TApplication;
};

export type TControllerActionDefinition<
    TInput = undefined,
    TResult = unknown,
    TApplication extends object = object,
    TRequestServices extends object = {},
> = {
    input?: TValidationSchema | TValidationShape;
    handler: (context: TControllerActionContext<TInput, TApplication, TRequestServices>) => TResult;
};

export type TControllerDefinition<
    TActions extends Record<string, TControllerActionDefinition<any, any, any, any>>,
> = {
    kind: 'controller';
    path?: string;
    actions: TActions;
};

export type TControllerActionInput<TController, TMethod extends keyof any> = TController extends { actions: infer TActions }
    ? TMethod extends keyof TActions
        ? TActions[TMethod] extends TControllerActionDefinition<infer TInput, any, any, any>
            ? TInput
            : never
        : never
    : never;

export type TControllerActionResult<TController, TMethod extends keyof any> = TController extends {
    actions: infer TActions;
}
    ? TMethod extends keyof TActions
        ? TActions[TMethod] extends TControllerActionDefinition<any, infer TResult, any, any>
            ? Awaited<TResult>
            : never
        : never
    : never;

export function defineAction<TSchema extends TValidationSchema, TResult>(
    definition: {
        input: TSchema;
        handler: (context: TControllerActionContext<zod.output<TSchema>>) => TResult;
    },
): TControllerActionDefinition<zod.output<TSchema>, TResult>;
export function defineAction<TShape extends TValidationShape, TResult>(
    definition: {
        input: TShape;
        handler: (context: TControllerActionContext<zod.output<zod.ZodObject<TShape>>>) => TResult;
    },
): TControllerActionDefinition<zod.output<zod.ZodObject<TShape>>, TResult>;
export function defineAction<TResult>(
    definition: {
        handler: (context: TControllerActionContext<undefined>) => TResult;
    },
): TControllerActionDefinition<undefined, TResult>;
export function defineAction(definition: {
    input?: TValidationSchema | TValidationShape;
    handler: (context: TControllerActionContext<any>) => unknown;
}) {
    return definition;
}

export const defineController = <
    TActions extends Record<string, TControllerActionDefinition<any, any, any, any>>,
>({
    path,
    actions,
}: {
    path?: string;
    actions: TActions;
}): TControllerDefinition<TActions> => ({
    kind: 'controller',
    path,
    actions,
});

export const runControllerAction = (
    action: TControllerActionDefinition<any, any, any, any>,
    requestContext: TControllerDefaultContext<any, any>,
) => {
    const input = action.input === undefined ? undefined : toValidationSchema(action.input).parse(requestContext.request.data);
    const app = requestContext.app as {
        models?: { client?: object };
        Models?: { client?: object };
    };

    return action.handler({
        ...requestContext,
        input,
        models: app.models?.client ?? app.Models?.client ?? {},
        services: requestContext.app,
    });
};
