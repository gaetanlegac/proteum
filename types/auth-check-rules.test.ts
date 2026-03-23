import type { TRouteOptions } from '@common/router';
import type {
    TAuthCheckConditions,
    TAuthRuleErrorConstructors,
    TAuthRuleNoInput,
    TAuthTrackingContext,
    TUserRole,
} from '@server/services/auth';

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

declare const errors: TAuthRuleErrorConstructors;

const authRequiredFromRule = new errors.AuthRequired({ feature: 'auth', action: 'view' });
const upgradeRequiredFromRule = new errors.UpgradeRequired({ feature: 'radar', action: 'view' });

type _AssertInjectedAuthRequired = Assert<typeof authRequiredFromRule extends Error ? true : false>;
type _AssertInjectedUpgradeRequired = Assert<typeof upgradeRequiredFromRule extends Error ? true : false>;
