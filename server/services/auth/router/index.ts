/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm

// Core
import {
    Request as ServerRequest,
    Response as ServerResponse,
    TAnyRoute,
    RouterService,
    TAnyRouter,
} from '@server/services/router';

import type { Application } from '@server/app/index';

import type { TRouterServiceArgs } from '@server/services/router/service';

// Specific
import type { default as UsersService, TAuthCheckConditions, TBasicUser } from '..';
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
    TUser extends TBasicUser = TApplication['app']['userType'],
    TRouter extends TAnyRouter = TAnyRouter,
    TRequest extends ServerRequest<TRouter> = ServerRequest<TRouter>,
> extends RouterService<
    { users: UsersService<TUser, TApplication> },
    TRouter,
    UsersRequestService<TRouter, TUser, TRequest>
> {
    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public users: UsersService<TUser, TApplication>;

    public constructor(
        getConfig: TRouterServiceArgs<{ users: UsersService<TUser, TApplication> }, TRouter>[0],
        app: TApplication,
    ) {
        super(getConfig, app);

        this.users = this.config.users;
    }

    public async ready() {
        // Decode current user
        this.parent.on('request', async (request: TRequest) => {
            // TODO: Typings. (context.user ?)
            const decoded = await this.users.decode(request.req, true);

            request.user = decoded || null;
        });

        // Check route permissions
        this.parent.on('resolved', async (route: TAnyRoute, request: TRequest, response: ServerResponse<TRouter>) => {
            if (route.options.auth !== undefined) {
                const tracking = route.options.authTracking ?? null;

                // Guest-only routes can still redirect authenticated users away.
                if (route.options.auth === false) {
                    const currentUser = this.users.check(request, false, tracking);

                    if (route.options.redirectLogged && currentUser) response.redirect(route.options.redirectLogged);
                    return;
                }

                if (route.options.auth === null) {
                    this.users.check(request, null, tracking);
                    return;
                }

                if (typeof route.options.auth === 'object') {
                    this.users.check(request, route.options.auth as TAuthCheckConditions, tracking);
                    return;
                }

                // `true` keeps the historical "USER" meaning. Use `null` for "logged in only".
                if (route.options.auth === true) {
                    if (tracking !== null && this.users.config.rules) {
                        this.users.check(request, { role: 'USER' }, tracking);
                        return;
                    }

                    this.users.check(request, true);
                    return;
                }

                const requiredRole = route.options.auth;

                if (tracking !== null && this.users.config.rules) {
                    this.users.check(request, { role: requiredRole }, tracking);
                    return;
                }

                this.users.check(request, requiredRole);
            }
        });
    }

    public async shutdown() {}

    /*----------------------------------
    - ROUTER SERVICE LIFECYCLE
    ----------------------------------*/

    public requestService(request: TRequest): UsersRequestService<TRouter, TUser, TRequest> {
        return new UsersRequestService(request, this);
    }
}
