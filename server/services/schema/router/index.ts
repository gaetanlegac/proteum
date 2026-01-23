/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import { 
    default as Router, Request as ServerRequest, Config as RouterConfig,
    RouterService, TAnyRouter
} from '@server/services/router';

import makeRequestValidators from '../request';

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- SERVICE
----------------------------------*/
export default class SchemaRouterService<
    TUser extends {} = {}
> extends RouterService<{}, TAnyRouter> {

    public requestService( request: ServerRequest ) {
        return makeRequestValidators( request, this.config );
    }
}