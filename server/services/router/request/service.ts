/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type Router from '..';
import type ServerRequest from '.';

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class RequestService {

    public constructor(
        public request: ServerRequest<Router>,
        public router = request.router,
        public app = router.app
    ) {

    }

}