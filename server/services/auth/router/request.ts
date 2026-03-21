/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import jwt from "jsonwebtoken";

// Core
import type {
  default as Router,
  Request as ServerRequest,
  TAnyRouter,
} from "@server/services/router";
import RequestService from "@server/services/router/request/service";

// Specific
import type AuthenticationRouterService from ".";
import type { default as UsersManagementService, TUserRole } from "..";

// Types
import type { TBasicUser } from "@server/services/auth";

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- MODULE
----------------------------------*/
export default class UsersRequestService<
  TRouter extends TAnyRouter,
  TUser extends TBasicUser,
> extends RequestService {
  public constructor(
    request: ServerRequest<TRouter>,
    public auth: AuthenticationRouterService,
    public users = auth.users,
  ) {
    super(request);
  }

  public login(email: string) {
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

  public check(
    role: TUserRole | false = "USER",
    feature?: FeatureKeys | null,
    action?: string,
  ) {
    return this.users.check(this.request, role, feature, action) as any;
  }
}
