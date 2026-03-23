/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Request as ServerRequest, TAnyRouter } from '@server/services/router';
import RequestService from '@server/services/router/request/service';

// Specific
import type AuthenticationRouterService from '.';
import type { TAuthCheckConditions, TAuthTrackingContext, TUserRole } from '..';

// Types
import type { TBasicUser } from '@server/services/auth';

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- MODULE
----------------------------------*/
export default class UsersRequestService<
    TRouter extends TAnyRouter,
    TUser extends TBasicUser,
    TRequest extends ServerRequest<TRouter> = ServerRequest<TRouter>,
> extends RequestService<TRequest> {
    public constructor(
        request: TRequest,
        public auth: AuthenticationRouterService<TRouter['app'], TUser, TRouter, TRequest>,
        public users = auth.users,
    ) {
        super(request);
    }

    public login(email: string) {
        if (!this.users.login) throw new Error('The current auth service does not implement login().');
        return this.users.login(this.request, email);
    }

    public logout() {
        return this.users.logout(this.request);
    }

    private isCheckConditions(value: TUserRole | true | false | TAuthCheckConditions | null): value is TAuthCheckConditions {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    public check(): TUser;

    public check(conditions: null, tracking?: TAuthTrackingContext): TUser;

    public check(conditions: TAuthCheckConditions, tracking?: TAuthTrackingContext): TUser;

    public check(conditions: false, tracking?: TAuthTrackingContext): null;

    // TODO: return user type according to entity
    public check(role: TUserRole, feature: null): TUser;

    public check(role: false): null;

    public check(role: TUserRole | true, feature: FeatureKeys, action?: string): TUser;

    public check(role: false, feature: FeatureKeys, action?: string): null;

    public check(
        roleOrConditions: TUserRole | true | false | TAuthCheckConditions | null = null,
        featureOrTracking?: FeatureKeys | null | TAuthTrackingContext,
        action?: string,
    ) {
        if (roleOrConditions === null) {
            return this.users.check(this.request, null, (featureOrTracking ?? null) as TAuthTrackingContext);
        }

        if (this.isCheckConditions(roleOrConditions)) {
            return this.users.check(this.request, roleOrConditions, (featureOrTracking ?? null) as TAuthTrackingContext);
        }

        if (roleOrConditions === false) {
            if (
                featureOrTracking === undefined ||
                featureOrTracking === null ||
                typeof featureOrTracking === 'object'
            ) {
                return this.users.check(this.request, false, (featureOrTracking ?? null) as TAuthTrackingContext);
            }

            return this.users.check(this.request, false, featureOrTracking, action);
        }

        if (featureOrTracking === null || featureOrTracking === undefined || typeof featureOrTracking === 'object')
            return this.users.check(this.request, roleOrConditions);
        return this.users.check(this.request, roleOrConditions, featureOrTracking, action);
    }
}
