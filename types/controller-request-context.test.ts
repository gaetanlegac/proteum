import type { Application } from '@server/app';
import Controller from '@server/app/controller';
import type { TServerRouter } from '@server/services/router';
import type { TServiceModelsClient, TServiceRequestContext } from '@server/app/service';

type Assert<T extends true> = T;

type Equals<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
        ? true
        : false
    : false;

type TTypedAuthRequestService = {
    check(): 'typed-user';
};

type TTestRouter = TServerRouter & {
    app: TTestApp;
    config: TServerRouter['config'] & {
        plugins: TServerRouter['config']['plugins'] & {
            auth: {
                requestService(request: any): TTypedAuthRequestService;
            };
        };
        context: () => {};
    };
};

interface TTestApp extends Application {
    Router: TTestRouter;
    Models: {
        client: {
            post: {
                findMany(): 'posts';
            };
        };
    };
}

class TypedRequestController extends Controller<TTestApp> {
    public useAuth() {
        return this.request.auth.check();
    }
}

type TRequestAuth = TypedRequestController['request']['auth'];
type TAuthCheckResult = ReturnType<TypedRequestController['useAuth']>;
type TServiceContextAuth = TServiceRequestContext<TTestApp>['auth'];
type TModelsClient = TServiceModelsClient<TTestApp>;

type _AssertTypedRequestService = Assert<Equals<TRequestAuth['check'], TTypedAuthRequestService['check']>>;
type _AssertTypedAuthCheckResult = Assert<Equals<TAuthCheckResult, 'typed-user'>>;
type _AssertTypedServiceRequestContext = Assert<Equals<TServiceContextAuth['check'], TTypedAuthRequestService['check']>>;
type _AssertTypedModelsClient = Assert<Equals<ReturnType<TModelsClient['post']['findMany']>, 'posts'>>;
