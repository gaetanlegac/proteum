import type { TRouteOptions } from '@common/router';
import { AuthRequired, UpgradeRequired } from '@common/errors';
import type {
    TAuthCheckConditions,
    TAuthRulesFactory,
    TAuthRuleNoInput,
    TAuthTrackingContext,
    TBasicUser,
    TUserRole,
} from '@server/services/auth';
import type { Request as ServerRequest, TAnyRouter } from '@server/services/router';

type Assert<T extends true> = T;

type Equals<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
        ? true
        : false
    : false;

declare global {
    interface ProteumAuthRuleCatalog {
        isPaid: TAuthRuleNoInput;
        hasFeature: 'radar' | 'api';
        matchesPlanWindow: [string, 'modal' | 'page'];
    }
}

type TResolvedConditions = TAuthCheckConditions;

type _AssertRoleCondition = Assert<Equals<TResolvedConditions['role'], TUserRole | undefined>>;
type _AssertZeroArgCondition = Assert<Equals<TResolvedConditions['isPaid'], true | undefined>>;
type _AssertSingleArgCondition = Assert<Equals<TResolvedConditions['hasFeature'], 'radar' | 'api' | undefined>>;
type _AssertTupleArgCondition = Assert<
    Equals<TResolvedConditions['matchesPlanWindow'], [string, 'modal' | 'page'] | undefined>
>;
type _AssertRouteAuthOptions = Assert<
    Equals<TRouteOptions['auth'], TAuthCheckConditions | TUserRole | boolean | null | undefined>
>;
type _AssertRouteAuthTracking = Assert<Equals<TRouteOptions['authTracking'], TAuthTrackingContext | undefined>>;

type TExampleRulesFactory = TAuthRulesFactory<TBasicUser, ServerRequest<TAnyRouter>>;
type _AssertRulesFactoryArgs = Assert<
    Equals<Parameters<TExampleRulesFactory>, [user: TBasicUser, tracking: TAuthTrackingContext, request: ServerRequest<TAnyRouter>]>
>;

const authRequiredFromRule = new AuthRequired('Please login to continue', 'auth', 'view');
const upgradeRequiredFromRule = new UpgradeRequired('Please upgrade to continue', 'radar', 'view');

type _AssertInjectedAuthRequired = Assert<typeof authRequiredFromRule extends Error ? true : false>;
type _AssertInjectedUpgradeRequired = Assert<typeof upgradeRequiredFromRule extends Error ? true : false>;
