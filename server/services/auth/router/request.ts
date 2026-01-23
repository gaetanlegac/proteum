/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import jwt from 'jsonwebtoken';

// Core
import type { default as Router, Request as ServerRequest, TAnyRouter } from '@server/services/router';
import RequestService from '@server/services/router/request/service';
import { InputError, AuthRequired, Forbidden } from '@common/errors';

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
    TUser extends TBasicUser
> extends RequestService {

    public constructor( 
        request: ServerRequest<TRouter>,
        public auth: AuthenticationRouterService,
        public users = auth.users,
    ) {
        super(request);
    }

    public login( email: string ) {
        return this.users.login( this.request, email );
    }

    public logout() {
        return this.users.logout( this.request );
    }

    // TODO: return user type according to entity
    public check(role: TUserRole, motivation?: string, dataForDebug?: {}): TUser;
    public check(role: false, motivation?: string, dataForDebug?: {}): null;
    public check(role: TUserRole | boolean = 'USER', motivation?: string, dataForDebug?: {}): TUser | null {
        return this.users.check( this.request, role, motivation, dataForDebug );
    }
}