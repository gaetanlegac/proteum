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
import type { TTraceCaptureMode, TTraceEventType } from '@common/dev/requestTrace';

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

    private traceRequestById(
        requestId: string | undefined,
        type: TTraceEventType,
        details: Record<string, any>,
        minimumCapture: TTraceCaptureMode = 'summary',
    ) {
        if (!requestId) return;
        this.app.container.Trace.record(requestId, type, details, minimumCapture);
    }

    private traceRequest(
        request: Pick<TRequest, 'id'> | undefined,
        type: TTraceEventType,
        details: Record<string, any>,
        minimumCapture: TTraceCaptureMode = 'summary',
    ) {
        this.traceRequestById(request?.id, type, details, minimumCapture);
    }

    private inspectRequestAuth(req: THttpRequest): {
        source: 'header' | 'cookie' | 'none';
        scheme: string | null;
    } {
        const authorizationHeader = typeof req.headers['authorization'] === 'string' ? req.headers['authorization'].trim() : '';
        if (authorizationHeader) {
            const [scheme] = authorizationHeader.split(/\s+/, 1);
            return { source: 'header', scheme: scheme || null };
        }

        const authorizationCookie =
            'cookies' in req && typeof req.cookies['authorization'] === 'string' ? req.cookies['authorization'].trim() : '';
        if (authorizationCookie) return { source: 'cookie', scheme: 'Bearer' };

        return { source: 'none', scheme: null };
    }

    private describeSessionPayload(session: TJwtSession) {
        if ('apiKey' in session) {
            return {
                payloadKind: 'api-key',
                payloadAccountType:
                    'accountType' in session && typeof session.accountType === 'string' ? session.accountType : null,
            };
        }

        return {
            payloadKind: 'email',
            payloadAccountType: null,
        };
    }

    private describeTraceError(error: Error) {
        const details = error as Error & {
            action?: string;
            feature?: string;
            http?: number;
            title?: string;
        };

        return {
            name: error.name,
            message: error.message,
            http: typeof details.http === 'number' ? details.http : null,
            title: typeof details.title === 'string' ? details.title : null,
            feature: typeof details.feature === 'string' ? details.feature : null,
            action: typeof details.action === 'string' ? details.action : null,
        };
    }

    // https://beeceptor.com/docs/concepts/authorization-header/#examples
    public async decode(req: THttpRequest, withData: true, traceRequestId?: string): Promise<TUser | null>;
    public async decode(req: THttpRequest, withData?: false, traceRequestId?: string): Promise<TJwtSession | null>;
    public async decode(
        req: THttpRequest,
        withData: boolean = false,
        traceRequestId?: string,
    ): Promise<TJwtSession | TUser | null> {
        const authInput = this.inspectRequestAuth(req);

        this.traceRequestById(
            traceRequestId,
            'auth.decode',
            {
                phase: 'start',
                withData,
                source: authInput.source,
                scheme: authInput.scheme,
            },
            'resolve',
        );

        // Get auth token
        const authMethod = this.getAuthMethod(req);
        if (authMethod === null) {
            this.traceRequestById(
                traceRequestId,
                'auth.decode',
                {
                    phase: 'result',
                    withData,
                    source: authInput.source,
                    scheme: authInput.scheme,
                    outcome: authInput.source === 'none' ? 'anonymous' : 'malformed-credentials',
                },
                'resolve',
            );
            return null;
        }
        const { tokenType, token, source } = authMethod;

        // Get auth session
        const session = this.getAuthSession(tokenType, token, traceRequestId);
        if (session === null) {
            this.traceRequestById(
                traceRequestId,
                'auth.decode',
                {
                    phase: 'result',
                    withData,
                    source,
                    scheme: tokenType ?? authInput.scheme,
                    outcome: 'rejected',
                },
                'resolve',
            );
            return null;
        }

        const payload = this.describeSessionPayload(session);

        // Return email only
        if (!withData) {
            this.traceRequestById(
                traceRequestId,
                'auth.decode',
                {
                    phase: 'result',
                    withData,
                    source,
                    scheme: tokenType ?? authInput.scheme,
                    outcome: 'session',
                    ...payload,
                },
                'resolve',
            );
            return session;
        }

        // Deserialize full user data
        const user = await this.decodeSession(session, req);
        if (user === null) {
            this.traceRequestById(
                traceRequestId,
                'auth.decode',
                {
                    phase: 'result',
                    withData,
                    source,
                    scheme: tokenType ?? authInput.scheme,
                    outcome: 'user-missing',
                    ...payload,
                },
                'resolve',
            );
            return null;
        }

        this.traceRequestById(
            traceRequestId,
            'auth.decode',
            {
                phase: 'result',
                withData,
                source,
                scheme: tokenType ?? authInput.scheme,
                outcome: 'user',
                ...payload,
                userType: user.type,
                userRoles: user.roles,
            },
            'resolve',
        );

        return { ...user, _token: token };
    }

    private getAuthMethod(req: THttpRequest): null | { source: 'header' | 'cookie'; token: string; tokenType?: string } {
        let token: string | undefined;
        let tokenType: string | undefined;
        if (typeof req.headers['authorization'] === 'string') {
            [tokenType, token] = req.headers['authorization'].split(' ');
            if (token === undefined) return null;
            return { source: 'header', tokenType, token };
        } else if ('cookies' in req && typeof req.cookies['authorization'] === 'string') {
            token = req.cookies['authorization'];
            tokenType = 'Bearer';
            if (token === undefined) return null;
            return { source: 'cookie', tokenType, token };
        } else return null;

        return null;
    }

    private getAuthSession(tokenType: string | undefined, token: string, traceRequestId?: string): TJwtSession | null {
        let session: TJwtSession;

        // API Key
        if (tokenType === 'Apikey') {
            const [accountType] = token.split('-');
            const apiKeySession = { accountType, apiKey: token } satisfies TApiKeySession;

            session = apiKeySession as TJwtSession & TApiKeySession;
            this.traceRequestById(
                traceRequestId,
                'auth.decode',
                {
                    phase: 'session',
                    scheme: tokenType,
                    outcome: 'accepted',
                    payloadKind: 'api-key',
                    payloadAccountType: accountType || null,
                },
                'resolve',
            );

            // JWT
        } else if (tokenType === 'Bearer') {
            try {
                session = jwt.verify(token, this.config.jwt.key, {
                    maxAge: this.config.jwt.expiration,
                }) as TJwtSession;
                this.traceRequestById(
                    traceRequestId,
                    'auth.decode',
                    {
                        phase: 'session',
                        scheme: tokenType,
                        outcome: 'accepted',
                        ...this.describeSessionPayload(session),
                    },
                    'resolve',
                );
            } catch (error) {
                this.traceRequestById(
                    traceRequestId,
                    'auth.decode',
                    {
                        phase: 'session',
                        scheme: tokenType,
                        outcome: 'invalid-bearer',
                        error:
                            error instanceof Error
                                ? this.describeTraceError(error)
                                : this.describeTraceError(
                                      new Error(typeof error === 'string' ? error : 'Invalid bearer token'),
                                  ),
                    },
                    'resolve',
                );
                return null;
                //throw new Forbidden(`The JWT token provided in the Authorization header is invalid`);
            }
        } else {
            this.traceRequestById(
                traceRequestId,
                'auth.decode',
                {
                    phase: 'session',
                    scheme: tokenType ?? null,
                    outcome: 'unsupported-scheme',
                },
                'resolve',
            );
            return null;
        }
        //throw new InputError(`The authorization scheme provided in the Authorization header is unsupported.`);

        return session;
    }

    public createSession(session: TJwtSession, request2: TRequest): string {
        const token = jwt.sign(session, this.config.jwt.key);

        request2.res.cookie('authorization', token, { maxAge: this.config.jwt.expiration });

        this.traceRequest(
            request2,
            'auth.session',
            {
                action: 'create',
                ...this.describeSessionPayload(session),
                maxAgeMs: this.config.jwt.expiration,
            },
            'resolve',
        );

        return token;
    }

    public logout(request: TRequest) {
        const user = request.user;
        if (!user) {
            this.traceRequest(request, 'auth.session', { action: 'clear-noop', userPresent: false }, 'summary');
            return;
        }

        request.res.clearCookie('authorization');
        this.traceRequest(request, 'auth.session', { action: 'clear', userPresent: true }, 'summary');
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
        request: TRequest,
        ruleName: TRuleName,
        rule: TAuthConfiguredRules[TRuleName],
        input: TAuthCheckConditions[TRuleName],
    ): TAuthRuleOutcome {
        if (typeof rule !== 'function') {
            const error = new AuthErrors.InputError(`Unknown auth rule "${ruleName}".`);
            this.traceRequest(
                request,
                'auth.check.rule',
                {
                    rule: ruleName,
                    input,
                    result: 'configuration-error',
                    error: this.describeTraceError(error),
                },
                'resolve',
            );
            throw error;
        }

        try {
            const callable = rule as Function;
            const outcome =
                callable.length === 0
                    ? (callable() as TAuthRuleOutcome)
                    : Array.isArray(input)
                      ? (Reflect.apply(callable, undefined, input) as TAuthRuleOutcome)
                      : (Reflect.apply(callable, undefined, [input]) as TAuthRuleOutcome);

            this.traceRequest(
                request,
                'auth.check.rule',
                {
                    rule: ruleName,
                    input,
                    result: outcome === true ? 'allow' : outcome === false ? 'deny' : 'error',
                    error: outcome instanceof Error ? this.describeTraceError(outcome) : null,
                },
                'resolve',
            );

            return outcome;
        } catch (error) {
            const typedError = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown auth rule error');

            this.traceRequest(
                request,
                'auth.check.rule',
                {
                    rule: ruleName,
                    input,
                    result: 'threw',
                    error: this.describeTraceError(typedError),
                },
                'resolve',
            );
            throw error;
        }
    }

    private checkWithConditions(
        request: TRequest,
        conditions: TAuthCheckConditions | null | false,
        tracking: TAuthTrackingContext,
    ): TUser | null {
        const user = this.getDecodedUser(request);
        const conditionRuleNames =
            conditions && conditions !== false
                ? (Object.keys(conditions) as Array<Extract<keyof TAuthConfiguredRules, string>>)
                : [];

        this.traceRequest(
            request,
            'auth.check.start',
            {
                phase: 'evaluate',
                strategy: 'conditions',
                evaluationMode: conditions === false ? 'guest-only' : conditions === null ? 'authenticated' : 'rules',
                userPresent: user !== null,
                userRoles: user?.roles || [],
                ruleNames: conditionRuleNames,
                tracking,
            },
            'resolve',
        );

        if (conditions === false) {
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'conditions',
                    evaluationMode: 'guest-only',
                    outcome: 'guest-pass',
                    userPresent: user !== null,
                },
                'resolve',
            );
            return user;
        }

        if (user === null) {
            const error = this.buildUnauthenticatedError(request, tracking);
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'conditions',
                    evaluationMode: conditions === null ? 'authenticated' : 'rules',
                    outcome: 'unauthenticated',
                    ruleNames: conditionRuleNames,
                    tracking,
                    error: this.describeTraceError(error),
                },
                'resolve',
            );
            throw error;
        }

        if (!conditions) {
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'conditions',
                    evaluationMode: 'authenticated',
                    outcome: 'allowed',
                    userRoles: user.roles,
                },
                'resolve',
            );
            return user;
        }

        if (!this.config.rules) {
            const error = new AuthErrors.InputError(`Auth rules are not configured for this application.`);
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'conditions',
                    evaluationMode: 'rules',
                    outcome: 'configuration-error',
                    ruleNames: conditionRuleNames,
                    error: this.describeTraceError(error),
                },
                'resolve',
            );
            throw error;
        }

        const rules = this.config.rules(user, tracking, request);
        const configuredRuleNames = Object.keys(rules) as Array<Extract<keyof TAuthConfiguredRules, string>>;

        this.traceRequest(
            request,
            'auth.check.start',
            {
                phase: 'rules-ready',
                strategy: 'conditions',
                evaluationMode: 'rules',
                userRoles: user.roles,
                ruleNames: conditionRuleNames,
                configuredRuleNames,
                tracking,
            },
            'resolve',
        );

        for (const ruleName of conditionRuleNames) {
            const input = conditions[ruleName];
            if (input === undefined) continue;

            const outcome = this.invokeConfiguredRule(request, ruleName, rules[ruleName], input);
            if (outcome === true) continue;
            if (outcome === false) {
                const error = new AuthErrors.Forbidden('You do not have sufficient permissions to access this resource.');
                this.traceRequest(
                    request,
                    'auth.check.result',
                    {
                        strategy: 'conditions',
                        evaluationMode: 'rules',
                        outcome: 'forbidden',
                        failedRule: ruleName,
                        ruleNames: conditionRuleNames,
                        userRoles: user.roles,
                        error: this.describeTraceError(error),
                    },
                    'resolve',
                );
                throw error;
            }

            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'conditions',
                    evaluationMode: 'rules',
                    outcome: 'error',
                    failedRule: ruleName,
                    ruleNames: conditionRuleNames,
                    userRoles: user.roles,
                    error: this.describeTraceError(outcome),
                },
                'resolve',
            );
            throw outcome;
        }

        this.traceRequest(
            request,
            'auth.check.result',
            {
                strategy: 'conditions',
                evaluationMode: 'rules',
                outcome: 'allowed',
                ruleNames: conditionRuleNames,
                userRoles: user.roles,
            },
            'resolve',
        );
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

        this.traceRequest(
            request,
            'auth.check.start',
            {
                phase: 'evaluate',
                strategy: 'legacy-role',
                normalizedRole,
                feature: feature ?? null,
                action: action ?? null,
                userPresent: user !== null,
                userRoles: user?.roles || [],
            },
            'resolve',
        );

        if (normalizedRole === false) {
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'legacy-role',
                    outcome: 'guest-pass',
                    normalizedRole,
                    userPresent: user !== null,
                },
                'resolve',
            );
            return user as TUser;

            // Not connected
        } else if (user === null) {
            const error = new AuthErrors.AuthRequired(
                'Please login to continue',
                feature && feature !== null ? feature : ('auth' as FeatureKeys),
                action || 'view',
            );
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'legacy-role',
                    outcome: 'unauthenticated',
                    normalizedRole,
                    feature: feature ?? null,
                    action: action || 'view',
                    error: this.describeTraceError(error),
                },
                'resolve',
            );
            throw error;

            // Insufficient permissions
        } else if (!user.roles.includes(normalizedRole)) {
            const error = new AuthErrors.Forbidden('You do not have sufficient permissions to access this resource.');
            this.traceRequest(
                request,
                'auth.check.result',
                {
                    strategy: 'legacy-role',
                    outcome: 'forbidden',
                    normalizedRole,
                    userRoles: user.roles,
                    error: this.describeTraceError(error),
                },
                'resolve',
            );
            throw error;
        }

        this.traceRequest(
            request,
            'auth.check.result',
            {
                strategy: 'legacy-role',
                outcome: 'allowed',
                normalizedRole,
                userRoles: user.roles,
            },
            'resolve',
        );
        return user as TUser;
    }

    /**
     * @deprecated Use `check(request, null, tracking)` to make the authenticated-user requirement explicit.
     */
    public check(request: TRequest): TUser;

    public check(request: TRequest, conditions: null, tracking?: TAuthTrackingContext): TUser;

    public check(request: TRequest, conditions: TAuthCheckConditions, tracking?: TAuthTrackingContext): TUser;

    public check(request: TRequest, conditions: false, tracking?: TAuthTrackingContext): null;

    /**
     * @deprecated Use `check(request, { role }, tracking)` or another explicit conditions object instead.
     */
    public check(request: TRequest, role?: TUserRole | boolean): TUser | null;

    /**
     * @deprecated Use `check(request, { role, ...rules }, tracking)` with app-defined auth rules instead of legacy feature/action arguments.
     */
    public check(request: TRequest, role: TUserRole | boolean, feature: FeatureKeys, action?: string): TUser | null;

    public check(
        request: TRequest,
        roleOrConditions: TUserRole | boolean | TAuthCheckConditions | null = null,
        featureOrTracking?: FeatureKeys | null | TAuthTrackingContext,
        action?: string,
    ): TUser | null {
        const dispatch =
            roleOrConditions === null
                ? 'authenticated'
                : this.isCheckConditions(roleOrConditions)
                  ? 'conditions'
                  : roleOrConditions === false &&
                      (featureOrTracking === undefined || featureOrTracking === null || typeof featureOrTracking === 'object')
                    ? 'guest-only'
                    : (roleOrConditions === true || typeof roleOrConditions === 'string') && this.config.rules
                      ? 'role-via-rules'
                      : 'legacy-role';

        this.traceRequest(
            request,
            'auth.check.start',
            {
                phase: 'dispatch',
                dispatch,
                roleOrConditions,
                featureOrTracking: featureOrTracking ?? null,
                action: action ?? null,
                hasConfiguredRules: Boolean(this.config.rules),
            },
            'resolve',
        );

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
