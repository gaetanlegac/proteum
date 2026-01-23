/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import zod from 'zod';
import { SomeType } from 'zod/v4/core';
 
// Core
import { 
    default as Router, TServerRouter, Request as ServerRequest
} from '@server/services/router';

// Ap
import { preprocessSchema, schema } from '@server/services/router/request/validation/zod';

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

const LogPrefix = `[router][validation]`;

export type TConfig = {
    debug?: boolean
}

/*----------------------------------
- SERVICE
----------------------------------*/
export default(
    request: ServerRequest< TServerRouter >,
    config: TConfig,
    router = request.router,
    app = router.app
) => ({

    ...schema,

    validate( fields: zod.ZodSchema | { [key: string]: zod.ZodSchema } ) {

        config.debug && console.log(LogPrefix, "Validate request data:", request.data);

        const schema = typeof fields === 'object' ? zod.object(fields) : fields;

        const preprocessedSchema = preprocessSchema(schema);

        return preprocessedSchema.parse(request.data);
    },
})