/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from 'zod';

// Core
import { TServerRouter, Request as ServerRequest } from '@server/services/router';

// Ap
import {
    schema,
    toValidationSchema,
    type TValidationSchema,
    type TValidationShape,
} from '@server/services/router/request/validation/zod';

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

const LogPrefix = `[router][validation]`;

export type TConfig = { debug?: boolean };

/*----------------------------------
- SERVICE
----------------------------------*/
export default (
    request: ServerRequest<TServerRouter>,
    config: TConfig,
    router = request.router,
    _app = router.app,
) => {
    function validate<TSchema extends TValidationSchema>(fields: TSchema): zod.output<TSchema>;
    function validate<TShape extends TValidationShape>(fields: TShape): zod.output<zod.ZodObject<TShape>>;
    function validate(fields: TValidationSchema | TValidationShape) {
        config.debug && console.log(LogPrefix, 'Validate request data:', request.data);

        const validationSchema = toValidationSchema(fields);

        //const preprocessedSchema = preprocessSchema(validationSchema);

        return validationSchema.parse(request.data);
    }

    return {
        ...schema,

        validate,
    };
};
