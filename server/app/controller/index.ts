/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from 'zod';

// Core
import context from '@server/context';
import type { Application } from '../index';
import type { TRouterContext, TAnyRouter } from '@server/services/router';
import {
    toValidationSchema,
    type TValidationSchema,
    type TValidationShape,
} from '@server/services/router/request/validation/zod';

export { schema } from '@server/services/router/request/validation/zod';
export type { z } from '@server/services/router/request/validation/zod';

/*----------------------------------
- TYPES
----------------------------------*/

type TControllerContext = TRouterContext<TAnyRouter>;

/*----------------------------------
- CLASS
----------------------------------*/

export default abstract class Controller<
    TApplication extends Application = Application,
    TContext extends TControllerContext = TControllerContext,
> {
    public constructor(public request: TContext) {}

    public get app(): TApplication {
        return this.request.app as TApplication;
    }

    public get services(): TApplication {
        return this.app;
    }

    public get models() {
        const app = this.app as { models?: { client?: unknown }; Models?: { client?: unknown } };
        return app.models?.client ?? app.Models?.client;
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
