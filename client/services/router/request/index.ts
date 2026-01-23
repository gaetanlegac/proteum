/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import { Location } from 'history'; 

// Core 
import BaseRequest from '@common/router/request';

// Specific
import type ClientRouter from '..';
import ApiClient from './api';
import type ClientResponse from '../response';

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- ROUTER
----------------------------------*/
// Since we do SSR, the server router can also be passed here
export default class ClientRequest<TRouter extends ClientRouter = ClientRouter> extends BaseRequest {

    public api: ApiClient;
    public response?: ClientResponse<TRouter>;

    public hash?: string;

    public constructor( 
        location: Location, 
        public router: TRouter,
        public app = router.app
    ) {

        super(location.pathname);

        this.host = window.location.host;
        this.url = window.location.protocol + '//' + window.location.host + this.path;
        this.hash = location.hash;

        // Extract search params
        if (location.search) {
            this.url += location.search;
            this.data = Object.fromEntries( new URLSearchParams( location.search ));
        }
    
        // Request services
        this.api = new ApiClient(this.app, this);
    }
}