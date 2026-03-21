/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from "zod";

// Core
import {
  default as Router,
  TServerRouter,
  Request as ServerRequest,
} from "@server/services/router";

// Ap
import {
  preprocessSchema,
  schema,
} from "@server/services/router/request/validation/zod";

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

const LogPrefix = `[router][validation]`;

export type TConfig = {
  debug?: boolean;
};

type TValidationSchema = zod.ZodTypeAny;
type TValidationShape = zod.ZodRawShape;

const isZodSchema = (fields: unknown): fields is TValidationSchema => {
  return (
    typeof fields === "object" &&
    fields !== null &&
    "safeParse" in fields &&
    typeof (fields as TValidationSchema).safeParse === "function"
  );
};

/*----------------------------------
- SERVICE
----------------------------------*/
export default (
  request: ServerRequest<TServerRouter>,
  config: TConfig,
  router = request.router,
  app = router.app,
) => {
  function validate<TSchema extends TValidationSchema>(
    fields: TSchema,
  ): zod.output<TSchema>;
  function validate<TShape extends TValidationShape>(
    fields: TShape,
  ): zod.output<zod.ZodObject<TShape>>;
  function validate(fields: TValidationSchema | TValidationShape) {
    config.debug &&
      console.log(LogPrefix, "Validate request data:", request.data);

    const validationSchema = isZodSchema(fields) ? fields : zod.object(fields);

    //const preprocessedSchema = preprocessSchema(validationSchema);

    return validationSchema.parse(request.data);
  }

  return {
    ...schema,

    validate,
  };
};
