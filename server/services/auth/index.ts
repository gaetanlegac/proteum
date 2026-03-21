/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import jwt from "jsonwebtoken";
import type express from "express";
import type http from "http";

// Core
import { Application } from "@server/app";
import Service from "@server/app/service";
import type { TAnyRouter } from "@server/services/router";
import {
  default as Router,
  Request as ServerRequest,
} from "@server/services/router";
import { InputError, AuthRequired, Forbidden } from "@common/errors";

/*----------------------------------
- TYPES
----------------------------------*/

declare global {
  /**
   * Optional app-level role registry.
   *
   * Apps can add their own roles (keys are role ids):
   * `interface ProteumAuthRoleCatalog { GOD: true }`
   */
  interface ProteumAuthRoleCatalog {}

  /**
   * App-level feature catalog consumed by auth permission checks.
   *
   * Apps can augment this interface with their own feature map:
   * `interface ProteumAuthFeatureCatalog extends MyFeatures {}`
   */
  interface ProteumAuthFeatureCatalog {}

  /**
   * Canonical feature keys union used across app + framework.
   *
   * Notes:
   * - If the app does not define a feature catalog, this defaults to `string`.
   * - Otherwise it becomes the string keys of `ProteumAuthFeatureCatalog`.
   */
  type FeatureKeys = keyof ProteumAuthFeatureCatalog extends never
    ? string
    : Extract<keyof ProteumAuthFeatureCatalog, string>;
}

export type TUserRole =
  | (typeof UserRoles)[number]
  | Extract<keyof ProteumAuthRoleCatalog, string>;

export type THttpRequest = express.Request | http.IncomingMessage;

export type TFeatureKey = FeatureKeys;

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = "[auth]";

export const UserRoles = ["USER", "ADMIN", "TEST", "DEV"] as const;

/*----------------------------------
- SERVICE CONVIG
----------------------------------*/

export type TConfig = {
  debug: boolean;
  logoutUrl: string;
  jwt: {
    // 2048 bits
    key: string;
    expiration: number;
  };
};

export type THooks = {};

export type TBasicUser = {
  type: string;
  name: string | null;
  email: string;
  roles: string[];
};

export type TBasicJwtSession = { apiKey: string } | { email: string };

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class AuthService<
  TUser extends TBasicUser,
  TApplication extends Application,
  TJwtSession extends TBasicJwtSession = TBasicJwtSession,
  TRequest extends ServerRequest<TAnyRouter> = ServerRequest<TAnyRouter>,
> extends Service<TConfig, THooks, TApplication, TApplication> {
  //public abstract login( ...args: any[] ): Promise<{ user: TUser, token: string }>;
  public abstract decodeSession(
    jwt: TJwtSession,
    req: THttpRequest,
  ): Promise<TUser | null>;

  // https://beeceptor.com/docs/concepts/authorization-header/#examples
  public async decode(req: THttpRequest, withData: true): Promise<TUser | null>;
  public async decode(
    req: THttpRequest,
    withData?: false,
  ): Promise<TJwtSession | null>;
  public async decode(
    req: THttpRequest,
    withData: boolean = false,
  ): Promise<TJwtSession | TUser | null> {
    this.config.debug &&
      console.log(LogPrefix, "Decode:", {
        cookie: req.cookies["authorization"],
      });

    // Get auth token
    const authMethod = this.getAuthMethod(req);
    if (authMethod === null) return null;
    const { tokenType, token } = authMethod;

    // Get auth session
    const session = this.getAuthSession(tokenType, token);
    if (session === null) return null;

    // Return email only
    if (!withData) {
      this.config.debug &&
        console.log(LogPrefix, `Auth user successfull. Return email only`);
      return session;
    }

    // Deserialize full user data
    this.config.debug && console.log(LogPrefix, `Deserialize user`, session);
    const user = await this.decodeSession(session, req);
    if (user === null) return null;

    this.config.debug &&
      console.log(LogPrefix, `Deserialized user:`, user.name);

    return {
      ...user,
      _token: token,
    };
  }

  private getAuthMethod(
    req: THttpRequest,
  ): null | { token: string; tokenType?: string } {
    let token: string | undefined;
    let tokenType: string | undefined;
    if (typeof req.headers["authorization"] === "string") {
      [tokenType, token] = req.headers["authorization"].split(" ");
    } else if (
      "cookies" in req &&
      typeof req.cookies["authorization"] === "string"
    ) {
      token = req.cookies["authorization"];
      tokenType = "Bearer";
    } else return null;

    if (token === undefined) return null;

    return { tokenType, token };
  }

  private getAuthSession(
    tokenType: string | undefined,
    token: string,
  ): TJwtSession | null {
    let session: TJwtSession;

    // API Key
    if (tokenType === "Apikey") {
      const [accountType] = token.split("-");

      this.config.debug && console.log(LogPrefix, `Auth via API Key`, token);
      session = { accountType, apiKey: token } as TJwtSession;

      // JWT
    } else if (tokenType === "Bearer") {
      this.config.debug && console.log(LogPrefix, `Auth via JWT token`, token);
      try {
        session = jwt.verify(token, this.config.jwt.key, {
          maxAge: this.config.jwt.expiration,
        });
      } catch (error) {
        console.warn(LogPrefix, "Failed to decode jwt token:", token);
        return null;
        //throw new Forbidden(`The JWT token provided in the Authorization header is invalid`);
      }
    } else return null;
    //throw new InputError(`The authorization scheme provided in the Authorization header is unsupported.`);

    return session;
  }

  public createSession(session: TJwtSession, request2: TRequest): string {
    this.config.debug &&
      console.info(LogPrefix, `Creating new session:`, session);

    const token = jwt.sign(session, this.config.jwt.key);

    this.config.debug &&
      console.info(LogPrefix, `Generated JWT token for session:` + token);

    request2.res.cookie("authorization", token, {
      maxAge: this.config.jwt.expiration,
    });

    return token;
  }

  public logout(request: TRequest) {
    const user = request.user;
    if (!user) return;

    this.config.debug && console.info(LogPrefix, `Logout ${user.name}`);
    request.res.clearCookie("authorization");
  }

  public check(request: TRequest, role?: TUserRole | false): TUser | null;

  public check(
    request: TRequest,
    role: TUserRole | false,
    feature: FeatureKeys,
    action?: string,
  ): TUser | null;

  public check(
    request: TRequest,
    role: TUserRole | false = "USER",
    feature?: FeatureKeys,
    action?: string,
  ): TUser | null {
    const user = request.user;

    this.config.debug &&
      console.warn(
        LogPrefix,
        `Check auth, role = ${role}. Current user =`,
        user?.name,
        feature,
      );

    if (user === undefined) {
      throw new Error(`request.user has not been decoded.`);

      // Shoudln't be logged
    } else if (role === false) {
      return user as TUser;

      // Not connected
    } else if (user === null) {
      console.warn(LogPrefix, "Refusé pour anonyme (" + request.ip + ")");
      throw new AuthRequired(
        "Please login to continue",
        feature as any,
        action as any,
      );

      // Insufficient permissions
    } else if (!user.roles.includes(role)) {
      console.warn(
        LogPrefix,
        "Refusé: " +
          role +
          " pour " +
          user.name +
          " (" +
          (user.roles || "role inconnu") +
          ")",
      );

      throw new Forbidden(
        "You do not have sufficient permissions to access this resource.",
      );
    } else {
      this.config.debug &&
        console.warn(
          LogPrefix,
          "Autorisé " + role + " pour " + user.name + " (" + user.roles + ")",
        );
    }

    return user as TUser;
  }
}
