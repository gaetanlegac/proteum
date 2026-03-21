/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from "zod";

// Core
import context from "@server/context";
import type { Application } from "@server/app";
import type {
  TRouterContext,
  TAnyRouter,
} from "@server/services/router/response";

export { schema } from "@server/services/router/request/validation/zod";
export type { z } from "@server/services/router/request/validation/zod";

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
    return this.app.Models?.client;
  }

  public input<TSchema extends zod.ZodTypeAny>(
    schema: TSchema,
  ): zod.infer<TSchema> {
    const store = context.getStore() as
      | { inputSchemaUsed?: boolean }
      | undefined;

    if (store?.inputSchemaUsed)
      throw new Error(
        "Controller.input() can only be called once per request handler.",
      );

    if (store) store.inputSchemaUsed = true;

    return schema.parse(this.request.request.data);
  }
}
