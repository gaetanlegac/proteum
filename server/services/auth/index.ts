/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import jwt from 'jsonwebtoken';
import type express from 'express';
import type http from 'http';

// Core
import type { Application } from '@server/app/index';
import Service from '@server/app/service';
import { type TAnyRouter, Request as ServerRequest } from '@server/services/router';
import * as AuthErrors from '@common/errors';

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
     * App-level rule catalog consumed by `auth.check({ ... })`.
     *
     * Apps can extend this interface with their own condition inputs:
     * `interface ProteumAuthRuleCatalog { hasFeature: MyFeatureName }`
     */
    interface ProteumAuthRuleCatalog {
        role: TUserRole;
    }

    /**
     * Optional tracking context attached to auth / upgrade prompts.
     *
     * Apps can extend this interface with their own machine-readable payload:
     * `interface ProteumAuthTrackingContext extends Partial<BlockedAttempt> {}`
     */
    interface ProteumAuthTrackingContext {}

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

export type TUserRole = (typeof UserRoles)[number] | Extract<keyof ProteumAuthRoleCatalog, string>;

export type THttpRequest = express.Request | http.IncomingMessage;

export type TFeatureKey = FeatureKeys;

export type TAuthRuleOutcome = true | false | Error;

declare const ProteumAuthRuleNoInputBrand: unique symbol;

export type TAuthRuleNoInput = {
    readonly [ProteumAuthRuleNoInputBrand]: 'ProteumAuthRuleNoInput';
};

type TAuthRuleConditionValue<TValue> = TValue extends TAuthRuleNoInput ? true : TValue;

type TAuthRuleHandler<TValue> = TValue extends TAuthRuleNoInput
    ? () => TAuthRuleOutcome
    : TValue extends readonly [...infer TArgs]
      ? (...args: TArgs) => TAuthRuleOutcome
      : (input: TValue) => TAuthRuleOutcome;

export type TAuthCheckConditions = {
    [TRuleName in Extract<keyof ProteumAuthRuleCatalog, string>]?: TAuthRuleConditionValue<
        ProteumAuthRuleCatalog[TRuleName]
    >;
};

export type TAuthCheckInput = TUserRole | boolean | TAuthCheckConditions | null;

export type TAuthConfiguredRules = {
    [TRuleName in Extract<keyof ProteumAuthRuleCatalog, string>]?: TAuthRuleHandler<
        ProteumAuthRuleCatalog[TRuleName]
    >;
};

export type TAuthTrackingContext = ProteumAuthTrackingContext | null;

export type TAuthRulesFactory<TUser extends TBasicUser, TRequest extends ServerRequest<TAnyRouter>> = (
    user: TUser,
    tracking: TAuthTrackingContext,
    request: TRequest,
) => TAuthConfiguredRules;

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = '[auth]';

export const UserRoles = ['USER', 'ADMIN', 'TEST', 'DEV'] as const;

/*----------------------------------
- SERVICE CONVIG
----------------------------------*/

export type TConfig<
    TUser extends TBasicUser = TBasicUser,
    TRequest extends ServerRequest<TAnyRouter> = ServerRequest<TAnyRouter>,
> = {
    debug: boolean;
    logoutUrl: string;
    jwt: {
        // 2048 bits
        key: string;
        expiration: number;
    };
    unauthenticated?: (tracking: TAuthTrackingContext, request: TRequest) => Error;
    rules?: TAuthRulesFactory<TUser, TRequest>;
};

export type THooks = {};

export type TBasicUser = {
    type: string;
    name: string | null;
    email: string;
    roles: string[];
    locale?: string | null;
};

export type TBasicJwtSession = { apiKey: string } | { email: string };

type TApiKeySession = { apiKey: string; accountType?: string };

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class AuthService<
    TUser extends TBasicUser,
    TApplication extends Application,
    TJwtSession extends TBasicJwtSession = TBasicJwtSession,
    TRequest extends ServerRequest<TAnyRouter> = ServerRequest<TAnyRouter>,
> extends Service<TConfig<TUser, TRequest>, THooks, TApplication, TApplication> {
    public login?(request: TRequest, email: string): Promise<unknown>;
    public abstract decodeSession(jwt: TJwtSession, req: THttpRequest): Promise<TUser | null>;

    // https://beeceptor.com/docs/concepts/authorization-header/#examples
    public async decode(req: THttpRequest, withData: true): Promise<TUser | null>;
    public async decode(req: THttpRequest, withData?: false): Promise<TJwtSession | null>;
    public async decode(req: THttpRequest, withData: boolean = false): Promise<TJwtSession | TUser | null> {
        const requestCookies = 'cookies' in req ? req.cookies : undefined;
        this.config.debug && console.log(LogPrefix, 'Decode:', { cookie: requestCookies?.['authorization'] });

        // Get auth token
        const authMethod = this.getAuthMethod(req);
        if (authMethod === null) return null;
        const { tokenType, token } = authMethod;

        // Get auth session
        const session = this.getAuthSession(tokenType, token);
        if (session === null) return null;

        // Return email only
        if (!withData) {
            this.config.debug && console.log(LogPrefix, `Auth user successfull. Return email only`);
            return session;
        }

        // Deserialize full user data
        this.config.debug && console.log(LogPrefix, `Deserialize user`, session);
        const user = await this.decodeSession(session, req);
        if (user === null) return null;

        this.config.debug && console.log(LogPrefix, `Deserialized user:`, user.name);

        return { ...user, _token: token };
    }

    private getAuthMethod(req: THttpRequest): null | { token: string; tokenType?: string } {
        let token: string | undefined;
        let tokenType: string | undefined;
        if (typeof req.headers['authorization'] === 'string') {
            [tokenType, token] = req.headers['authorization'].split(' ');
        } else if ('cookies' in req && typeof req.cookies['authorization'] === 'string') {
            token = req.cookies['authorization'];
            tokenType = 'Bearer';
        } else return null;

        if (token === undefined) return null;

        return { tokenType, token };
    }

    private getAuthSession(tokenType: string | undefined, token: string): TJwtSession | null {
        let session: TJwtSession;

        // API Key
        if (tokenType === 'Apikey') {
            const [accountType] = token.split('-');
            const apiKeySession = { accountType, apiKey: token } satisfies TApiKeySession;

            this.config.debug && console.log(LogPrefix, `Auth via API Key`, token);
            session = apiKeySession as TJwtSession & TApiKeySession;

            // JWT
        } else if (tokenType === 'Bearer') {
            this.config.debug && console.log(LogPrefix, `Auth via JWT token`, token);
            try {
                session = jwt.verify(token, this.config.jwt.key, {
                    maxAge: this.config.jwt.expiration,
                }) as TJwtSession;
            } catch (error) {
                console.warn(LogPrefix, 'Failed to decode jwt token:', token);
                return null;
                //throw new Forbidden(`The JWT token provided in the Authorization header is invalid`);
            }
        } else return null;
        //throw new InputError(`The authorization scheme provided in the Authorization header is unsupported.`);

        return session;
    }

    public createSession(session: TJwtSession, request2: TRequest): string {
        this.config.debug && console.info(LogPrefix, `Creating new session:`, session);

        const token = jwt.sign(session, this.config.jwt.key);

        this.config.debug && console.info(LogPrefix, `Generated JWT token for session:` + token);

        request2.res.cookie('authorization', token, { maxAge: this.config.jwt.expiration });

        return token;
    }

    public logout(request: TRequest) {
        const user = request.user;
        if (!user) return;

        this.config.debug && console.info(LogPrefix, `Logout ${user.name}`);
        request.res.clearCookie('authorization');
    }

    protected getDecodedUser(request: TRequest): TUser | null {
        const user = request.user;

        if (user === undefined) throw new Error(`request.user has not been decoded.`);

        return user as TUser | null;
    }

    private resolveErrorTrackingContext(
        tracking: TAuthTrackingContext,
        fallbackFeature: FeatureKeys | null,
        fallbackAction: string,
    ): {
        feature: FeatureKeys;
        action: string;
        details?: {
            data: Exclude<TAuthTrackingContext, null>;
        };
    } {
        const trackingDetails = tracking
            ? (tracking as {
                  feature?: string | null;
                  action?: string | null;
              })
            : null;

        const feature =
            typeof trackingDetails?.feature === 'string' && trackingDetails.feature.trim()
                ? (trackingDetails.feature as FeatureKeys)
                : fallbackFeature;

        if (!feature) throw new AuthErrors.InputError(`This auth rule requires a tracking context with a feature.`);

        const action =
            typeof trackingDetails?.action === 'string' && trackingDetails.action.trim()
                ? trackingDetails.action
                : fallbackAction;

        return {
            feature,
            action,
            details: tracking ? { data: tracking as Exclude<TAuthTrackingContext, null> } : undefined,
        };
    }

    protected buildUnauthenticatedError(request: TRequest, tracking: TAuthTrackingContext): Error {
        if (this.config.unauthenticated) return this.config.unauthenticated(tracking, request);

        const resolved = this.resolveErrorTrackingContext(tracking, 'auth' as FeatureKeys, 'view');

        return new AuthErrors.AuthRequired(
            'Please login to continue',
            resolved.feature,
            resolved.action,
            resolved.details,
        );
    }

    private isCheckConditions(
        value: TUserRole | boolean | TAuthCheckConditions | null,
    ): value is TAuthCheckConditions {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private invokeConfiguredRule<TRuleName extends Extract<keyof TAuthConfiguredRules, string>>(
        ruleName: TRuleName,
        rule: TAuthConfiguredRules[TRuleName],
        input: TAuthCheckConditions[TRuleName],
    ): TAuthRuleOutcome {
        if (typeof rule !== 'function') throw new AuthErrors.InputError(`Unknown auth rule "${ruleName}".`);

        const callable = rule as Function;

        if (callable.length === 0) return callable() as TAuthRuleOutcome;
        if (Array.isArray(input)) return Reflect.apply(callable, undefined, input) as TAuthRuleOutcome;
        return Reflect.apply(callable, undefined, [input]) as TAuthRuleOutcome;
    }

    private checkWithConditions(
        request: TRequest,
        conditions: TAuthCheckConditions | null | false,
        tracking: TAuthTrackingContext,
    ): TUser | null {
        const user = this.getDecodedUser(request);

        this.config.debug && console.warn(LogPrefix, `Check auth with rules. Current user =`, user?.name, conditions);

        if (conditions === false) return user;

        if (user === null) {
            console.warn(LogPrefix, 'Refusé pour anonyme (' + request.ip + ')');
            throw this.buildUnauthenticatedError(request, tracking);
        }

        if (!conditions) return user;

        if (!this.config.rules) throw new AuthErrors.InputError(`Auth rules are not configured for this application.`);

        const rules = this.config.rules(user, tracking, request);
        const conditionRuleNames = Object.keys(conditions) as Array<Extract<keyof TAuthConfiguredRules, string>>;

        for (const ruleName of conditionRuleNames) {
            const input = conditions[ruleName];
            if (input === undefined) continue;

            const outcome = this.invokeConfiguredRule(ruleName, rules[ruleName], input);
            if (outcome === true) continue;
            if (outcome === false)
                throw new AuthErrors.Forbidden('You do not have sufficient permissions to access this resource.');
            throw outcome;
        }

        return user;
    }

    protected checkLegacyRole(
        request: TRequest,
        role: TUserRole | boolean = 'USER',
        feature?: FeatureKeys | null,
        action?: string,
    ): TUser | null {
        const normalizedRole = role === true ? 'USER' : role;
        const user = this.getDecodedUser(request);

        this.config.debug &&
            console.warn(LogPrefix, `Check auth, role = ${normalizedRole}. Current user =`, user?.name, feature);

        if (normalizedRole === false) {
            return user as TUser;

            // Not connected
        } else if (user === null) {
            console.warn(LogPrefix, 'Refusé pour anonyme (' + request.ip + ')');
            throw new AuthErrors.AuthRequired(
                'Please login to continue',
                feature && feature !== null ? feature : ('auth' as FeatureKeys),
                action || 'view',
            );

            // Insufficient permissions
        } else if (!user.roles.includes(normalizedRole)) {
            console.warn(
                LogPrefix,
                'Refusé: ' + normalizedRole + ' pour ' + user.name + ' (' + (user.roles || 'role inconnu') + ')',
            );

            throw new AuthErrors.Forbidden('You do not have sufficient permissions to access this resource.');
        } else {
            this.config.debug &&
                console.warn(
                    LogPrefix,
                    'Autorisé ' + normalizedRole + ' pour ' + user.name + ' (' + user.roles + ')',
                );
        }

        return user as TUser;
    }

    public check(request: TRequest): TUser;

    public check(request: TRequest, conditions: null, tracking?: TAuthTrackingContext): TUser;

    public check(request: TRequest, conditions: TAuthCheckConditions, tracking?: TAuthTrackingContext): TUser;

    public check(request: TRequest, conditions: false, tracking?: TAuthTrackingContext): null;

    public check(request: TRequest, role?: TUserRole | boolean): TUser | null;

    public check(request: TRequest, role: TUserRole | boolean, feature: FeatureKeys, action?: string): TUser | null;

    public check(
        request: TRequest,
        roleOrConditions: TUserRole | boolean | TAuthCheckConditions | null = null,
        featureOrTracking?: FeatureKeys | null | TAuthTrackingContext,
        action?: string,
    ): TUser | null {
        if (roleOrConditions === null || this.isCheckConditions(roleOrConditions)) {
            const tracking = (featureOrTracking ?? null) as TAuthTrackingContext;
            return this.checkWithConditions(request, roleOrConditions, tracking);
        }

        if (roleOrConditions === false) {
            if (
                featureOrTracking === undefined ||
                featureOrTracking === null ||
                typeof featureOrTracking === 'object'
            ) {
                const tracking = (featureOrTracking ?? null) as TAuthTrackingContext;
                return this.checkWithConditions(request, false, tracking);
            }

            return this.checkLegacyRole(request, false, featureOrTracking, action);
        }

        if ((roleOrConditions === true || typeof roleOrConditions === 'string') && this.config.rules) {
            return this.checkWithConditions(
                request,
                { role: roleOrConditions === true ? 'USER' : roleOrConditions },
                null,
            );
        }

        return this.checkLegacyRole(request, roleOrConditions, featureOrTracking as FeatureKeys | null | undefined, action);
    }
}
