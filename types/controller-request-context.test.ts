import type { Application } from '@server/app';
import type { TControllerActionContext } from '@server/app/controller';
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

type TControllerContext = TControllerActionContext<undefined, TTestApp>;
type TControllerContextAuth = TControllerContext['auth'];
type TControllerModelsClient = TControllerContext['models'];
type TServiceContextAuth = TServiceRequestContext<TTestApp>['auth'];
type TModelsClient = TServiceModelsClient<TTestApp>;

type _AssertTypedControllerRequestService = Assert<
    Equals<TControllerContextAuth['check'], TTypedAuthRequestService['check']>
>;
type _AssertTypedServiceRequestContext = Assert<Equals<TServiceContextAuth['check'], TTypedAuthRequestService['check']>>;
type _AssertTypedControllerModelsClient = Assert<
    Equals<ReturnType<TControllerModelsClient['post']['findMany']>, 'posts'>
>;
type _AssertTypedModelsClient = Assert<Equals<ReturnType<TModelsClient['post']['findMany']>, 'posts'>>;
