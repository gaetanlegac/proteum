/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type { TAnyRouter } from '..';
import type ServerRequest from '.';

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class RequestService<TRequest extends ServerRequest<TAnyRouter> = ServerRequest<TAnyRouter>> {
    public constructor(
        public request: TRequest,
        public router: TRequest['router'] = request.router,
        public app: TRequest['router']['app'] = router.app,
    ) {}
}
