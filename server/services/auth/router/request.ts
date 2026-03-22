/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import jwt from 'jsonwebtoken';

// Core
import type { Request as ServerRequest, TAnyRouter } from '@server/services/router';
import RequestService from '@server/services/router/request/service';

// Specific
import type AuthenticationRouterService from '.';
import type { default as UsersManagementService, TUserRole } from '..';

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

    public check(): TUser;

    // TODO: return user type according to entity
    public check(role: TUserRole, feature: null): TUser;

    public check(role: false): null;

    public check(role: TUserRole, feature: FeatureKeys, action?: string): TUser;

    public check(role: false, feature: FeatureKeys, action?: string): null;

    public check(role: TUserRole | false = 'USER', feature?: FeatureKeys | null, action?: string) {
        if (feature === null || feature === undefined) return this.users.check(this.request, role);
        return this.users.check(this.request, role, feature, action);
    }
}
