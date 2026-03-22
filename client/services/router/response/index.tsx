/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Libs
import type { TAnyRouter } from '@server/services/router';
import type ServerResponse from '@server/services/router/response';

import type { TAnyRoute, TErrorRoute } from '@common/router';
import BaseResponse, { TResponseData } from '@common/router/response';

import type ClientApplication from '@client/app';
import type { default as ClientRouter } from '@client/services/router';
import type ClientResponse from '@client/services/router/response';
import ClientRequest from '@client/services/router/request';
import ClientPage from '@client/services/router/response/page';
import { history } from '@client/services/router/request/history';
import createControllers from '@generated/common/controllers';
import type { TControllers } from '@generated/common/controllers';

/*----------------------------------
- TYPES
----------------------------------*/

export type TPageResponse<TRouter extends ClientRouter<any, any>> =
    | ClientResponse<TRouter, ClientPage<TRouter>>
    | ServerResponse<TAnyRouter>;

type TRouterContextBase<
    TRouter extends ClientRouter<any, any> = ClientRouter<any, any>,
    TApplication extends ClientApplication = ClientApplication,
> = {
    app: TApplication;
    request: ClientRequest<TRouter>;
    route: TAnyRoute<TRouterContext<TRouter, TApplication>>;
    api: ClientRequest<TRouter>['api'];
    Router: TRouter;
    page: ClientPage<TRouter>;
    data: TObjetDonnees;
};

type TContextOwnState<TValue> = {
    [TKey in keyof TValue as TValue[TKey] extends (...args: any[]) => any ? never : TKey]: TValue[TKey];
};

type TRouterRuntimeContext<
    TRouter extends ClientRouter<any, any> = ClientRouter<any, any>,
    TApplication extends ClientApplication = ClientApplication,
> = TRouterContextBase<TRouter, TApplication> &
    TContextOwnState<TApplication> &
    TControllers;

const createRuntimeContextBase = <
    TRouter extends ClientRouter<any, any> = ClientRouter<any, any>,
    TApplication extends ClientApplication = ClientApplication,
>(
    app: TApplication,
    controllers: TControllers,
    fields: TRouterContextBase<TRouter, TApplication>,
): TRouterRuntimeContext<TRouter, TApplication> => Object.assign({}, app, controllers, fields);

export type TRouterContext<
    TRouter extends ClientRouter<any, any> = ClientRouter<any, any>,
    TApplication extends ClientApplication = ClientApplication,
> = TRouterRuntimeContext<TRouter, TApplication> &
    ReturnType<TRouter['config']['context']> & { context: TRouterContext<TRouter, TApplication> };

/*----------------------------------
- ROUTER
----------------------------------*/
export default class ClientPageResponse<
    TRouter extends ClientRouter,
    TData extends TResponseData = TResponseData,
> extends BaseResponse<TData> {
    public context: TRouterContext<TRouter, TRouter['app']>;

    public constructor(
        public request: ClientRequest<TRouter>,
        public route: TAnyRoute<TRouterContext<TRouter, TRouter['app']>>,

        public app = request.app,
    ) {
        super(request);

        request.response = this;

        // Create response context for controllers
        this.context = this.createContext();
    }

    private createContext(): TRouterContext<TRouter, TRouter['app']> {
        const basicContext = createRuntimeContextBase(this.request.app, createControllers(this.request.api), {
            // Router context
            app: this.app,
            request: this.request,
            route: this.route,
            api: this.request.api,
            Router: this.request.router,
            // Will be assigned when the controller will be runned
            page: undefined!,
            data: {},
        });
        const customContext = this.request.router.config.context(basicContext, this.request.router);

        const newContext: TRouterContext<TRouter, TRouter['app']> = Object.create(Object.prototype);
        Object.assign(newContext, basicContext, customContext);
        newContext.context = newContext;

        // Update context object if already exists
        // NOTE: we don't create a nex instance of context because we don't want to rereder the full page (inc layout) to update the context given by thr react context provider
        const existingContext = this.request.router.context;
        if (existingContext === undefined) {
            this.request.router.context = newContext;
        } else {
            Object.assign(existingContext, newContext);
        }

        return newContext;
    }

    public async runController(additionnalData: {} = {}): Promise<ClientPage<TRouter>> {
        // Run contoller
        const result = this.route.controller(this.context);

        // Default data type for `return <raw data>`
        if (result instanceof ClientPage) await result.preRender(additionnalData);
        else throw new Error(`Unsupported response format: ${result.constructor?.name}`);

        return result;
    }

    public redirect(url: string) {
        history?.replace(url);
    }
}
