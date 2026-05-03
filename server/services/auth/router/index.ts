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
    TServerRouter,
} from '@server/services/router';

import type { Application } from '@server/app/index';
import AppContainer from '@server/app/container';

import type { TRouterServiceArgs } from '@server/services/router/service';

// Specific
import type { default as UsersService, TAuthCheckConditions, TBasicUser } from '..';
import { createUsersRequestService, type TUsersRequestContext } from './request';

/*----------------------------------
- SERVICE
----------------------------------*/
export default class AuthenticationRouterService<
    TApplication extends Application,
    TUser extends TBasicUser,
    TRouter extends TAnyRouter = TServerRouter,
    TRequest extends ServerRequest<TRouter> = ServerRequest<TRouter>,
> extends RouterService<
    { users: UsersService<TUser, TApplication> },
    TRouter,
    TUsersRequestContext<TUser>
> {
    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public users: UsersService<TUser, TApplication>;

    public constructor(
        getConfig: TRouterServiceArgs<{ users: UsersService<TUser, TApplication> }>[0],
        app: TApplication,
    ) {
        super(getConfig, app);

        this.users = this.config.users;
    }

    private traceRouteAuth(
        request: TRequest,
        route: TAnyRoute,
        details: Record<string, any>,
        minimumCapture: 'summary' | 'resolve' | 'deep' = 'resolve',
    ) {
        AppContainer.Trace.record(
            request.id,
            'auth.route',
            {
                routePath: 'path' in route ? route.path || '' : '',
                routeId: route.options.id || '',
                authInput: route.options.auth ?? null,
                tracking: route.options.authTracking ?? null,
                redirectLogged: route.options.redirectLogged ?? null,
                ...details,
            },
            minimumCapture,
        );
    }

    public async ready() {
        // Decode current user
        this.parent.on('request', async (request: TRequest) => {
            // TODO: Typings. (context.user ?)
            const decoded = await this.users.decode(request.req, true, request.id);

            request.user = decoded || null;
        });

        // Check route permissions
        this.parent.on('resolved', async (route: TAnyRoute, request: TRequest, response: ServerResponse<TRouter>) => {
            if (route.options.auth !== undefined) {
                const tracking = route.options.authTracking ?? null;
                const strategy =
                    route.options.auth === false
                        ? 'guest-only'
                        : route.options.auth === null
                          ? 'authenticated'
                          : typeof route.options.auth === 'object'
                            ? 'conditions'
                            : route.options.auth === true
                              ? tracking !== null && this.users.config.rules
                                  ? 'user-via-rules'
                                  : 'user'
                              : tracking !== null && this.users.config.rules
                                ? 'role-via-rules'
                                : 'role';

                this.traceRouteAuth(
                    request,
                    route,
                    {
                        phase: 'start',
                        strategy,
                    },
                    'resolve',
                );

                // Guest-only routes can still redirect authenticated users away.
                if (route.options.auth === false) {
                    const currentUser = this.users.check(request, false, tracking);
                    const redirected = Boolean(route.options.redirectLogged && currentUser);

                    this.traceRouteAuth(
                        request,
                        route,
                        {
                            phase: 'result',
                            strategy,
                            outcome: redirected ? 'redirected' : 'allowed',
                            userPresent: currentUser !== null,
                            redirectTo: redirected ? route.options.redirectLogged : null,
                        },
                        'resolve',
                    );

                    if (route.options.redirectLogged && currentUser) response.redirect(route.options.redirectLogged);
                    return;
                }

                if (route.options.auth === null) {
                    this.users.check(request, null, tracking);
                    this.traceRouteAuth(request, route, { phase: 'result', strategy, outcome: 'allowed' }, 'resolve');
                    return;
                }

                if (typeof route.options.auth === 'object') {
                    this.users.check(request, route.options.auth as TAuthCheckConditions, tracking);
                    this.traceRouteAuth(request, route, { phase: 'result', strategy, outcome: 'allowed' }, 'resolve');
                    return;
                }

                // `true` keeps the historical "USER" meaning. Use `null` for "logged in only".
                if (route.options.auth === true) {
                    if (tracking !== null && this.users.config.rules) {
                        this.users.check(request, { role: 'USER' }, tracking);
                        this.traceRouteAuth(
                            request,
                            route,
                            {
                                phase: 'result',
                                strategy,
                                outcome: 'allowed',
                                requiredRole: 'USER',
                            },
                            'resolve',
                        );
                        return;
                    }

                    this.users.check(request, true);
                    this.traceRouteAuth(
                        request,
                        route,
                        {
                            phase: 'result',
                            strategy,
                            outcome: 'allowed',
                            requiredRole: 'USER',
                        },
                        'resolve',
                    );
                    return;
                }

                const requiredRole = route.options.auth;

                if (tracking !== null && this.users.config.rules) {
                    this.users.check(request, { role: requiredRole }, tracking);
                    this.traceRouteAuth(
                        request,
                        route,
                        {
                            phase: 'result',
                            strategy,
                            outcome: 'allowed',
                            requiredRole,
                        },
                        'resolve',
                    );
                    return;
                }

                this.users.check(request, requiredRole);
                this.traceRouteAuth(
                    request,
                    route,
                    {
                        phase: 'result',
                        strategy,
                        outcome: 'allowed',
                        requiredRole,
                    },
                    'resolve',
                );
            }
        });
    }

    public async shutdown() {}

    /*----------------------------------
    - ROUTER SERVICE LIFECYCLE
    ----------------------------------*/

    public requestService(request: TRequest): TUsersRequestContext<TUser> {
        return createUsersRequestService(request, this.users);
    }
}
