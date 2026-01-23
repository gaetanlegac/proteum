/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Libs 
import type ServerRouter from '@server/services/router';
import type ServerResponse from '@server/services/router/response';

import type { TAnyRoute, TErrorRoute } from '@common/router';
import BaseResponse, { TResponseData } from '@common/router/response';

import type ClientApplication from '@client/app';
import type { default as ClientRouter } from '@client/services/router'
import type ClientResponse from '@client/services/router/response'
import ClientRequest from '@client/services/router/request'
import ClientPage from '@client/services/router/response/page'
import { history } from '@client/services/router/request/history';

/*----------------------------------
- TYPES
----------------------------------*/

export type TPageResponse<TRouter extends ClientRouter> = (
    ClientResponse<TRouter, ClientPage>
    |
    ServerResponse<ServerRouter, ClientPage>
);

export type TRouterContext<
    TRouter extends ClientRouter = ClientRouter, 
    TApplication extends ClientApplication = ClientApplication
> = (
    // ClientPage context
    {
        app: TApplication,
        request: ClientRequest<TRouter>,
        route: TAnyRoute<TRouterContext>,
        api: ClientRequest<TRouter>["api"],
        page: ClientPage<TRouter>,
        data: TObjetDonnees
    }
    // Expose client application services (api, socket, ...)
    //TRouter["app"] 
    & TApplication
    & ReturnType<TRouter["config"]["context"]>
)

/*----------------------------------
- ROUTER
----------------------------------*/
export default class ClientPageResponse<
    TRouter extends ClientRouter,
    TData extends TResponseData = TResponseData
> extends BaseResponse<TData> {

    public context: TRouterContext<TRouter, TRouter["app"]>;

    public constructor(
        public request: ClientRequest<TRouter>,
        public route: TAnyRoute | TErrorRoute,

        public app = request.app,
    ) {

        super(request);

        request.response = this;

        // Create response context for controllers
        this.context = this.createContext();
    }

    private createContext(): TRouterContext<TRouter, TRouter["app"]> {

        const basicContext: TRouterContext<TRouter, TRouter["app"]> = {

            // App services (TODO: expose only services)
            ...this.request.app,

            // Router context
            app: this.app,
            request: this.request,
            route: this.route,
            api: this.request.api,
            // Will be assigned when the controller will be runned
            page: undefined as unknown as ClientPage<TRouter>, 
            data: {},
        }

        const newContext: TRouterContext<TRouter, TRouter["app"]> = {
            ...basicContext,
            // Custom context
            ...this.request.router.config.context( basicContext, this.request.router )
        }

        newContext.context = newContext;

        // Update context object if already exists
        // NOTE: we don't create a nex instance of context because we don't want to rereder the full page (inc layout) to update the context given by thr react context provider
        const existingContext = this.request.router.context;
        if (existingContext === undefined) {

            this.request.router.context = newContext

        } else for(const key in newContext)
            existingContext[ key ] = newContext[ key ];

        return newContext
    }

    public async runController( additionnalData: {} = {} ): Promise<ClientPage> {

        // Run contoller
        const result = this.route.controller(this.context);

        // Default data type for `return <raw data>`
        if (result instanceof ClientPage)
            await result.preRender(additionnalData);
        else
            throw new Error(`Unsupported response format: ${result.constructor?.name}`);

        return result;
    }

    public redirect(url: string) {
        history?.replace(url);
    }
}