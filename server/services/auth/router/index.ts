/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm

// Core
import { 
    default as Router, Request as ServerRequest, Response as ServerResponse, TAnyRoute,
    RouterService, TAnyRouter
} from '@server/services/router';

import type { Application } from '@server/app';

import type { TRouterServiceArgs } from '@server/services/router/service';

// Specific
import type { default as UsersService, TUserRole, TBasicUser } from '..';
import UsersRequestService from './request';

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = '[router][auth]';

/*----------------------------------
- SERVICE
----------------------------------*/
export default class AuthenticationRouterService<
    TApplication extends Application = Application,
    TUser extends TBasicUser = TApplication["app"]["userType"],
    TRouter extends TAnyRouter = TAnyRouter,
    TRequest extends ServerRequest<TRouter> = ServerRequest<TRouter>,
> extends RouterService<{}, TRouter> {

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public users: UsersService<TUser, Application>;

    public constructor( getConfig: TRouterServiceArgs[0], app: TApplication ) {
        super( getConfig, app );

        this.users = this.config.users;
    }

    protected async ready() {

        // Decode current user
        this.parent.on('request', async (request: TRequest) => {

            // TODO: Typings. (context.user ?)
            const decoded = await this.users.decode( request.req, true);

            request.user = decoded || null;
        })

        // Check route permissions
        this.parent.on('resolved', async (
            route: TAnyRoute, 
            request: TRequest, 
            response: ServerResponse<TRouter>
        ) => {

            if (route.options.auth !== undefined) {

                // Basic auth check
                this.users.check(request, route.options.auth);

                // Redirect to logged page
                if (route.options.auth === false && request.user && route.options.redirectLogged)
                    response.redirect(route.options.redirectLogged);
            }
        })
    }

    protected async shutdown() {

    }

    /*----------------------------------
    - ROUTER SERVICE LIFECYCLE
    ----------------------------------*/

    public requestService( request: TRequest ): UsersRequestService<TRouter, TUser> {
        return new UsersRequestService( request, this );
    }   
}