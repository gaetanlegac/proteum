/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { ComponentChild } from 'preact';

// Core
import type { Layout, TErrorRoute, TRoute } from '@common/router';
import type { TFetcherList } from '@common/router/request/api';
import PageResponse, { type TPageNavigation, type TPageRenderer } from '@common/router/response/page';
import { isClientRequest } from '../request';
import { shouldDeferNavigation } from '../navigation';

// Specific
import type ClientRouter from '..';
import type { TRouterContext } from '../response';

/*----------------------------------
- TYPES
----------------------------------*/

type TClientPageRouteLike<TRouter extends ClientRouter<any, any>> =
    | TRoute<TRouterContext<TRouter, TRouter['app']>>
    | TErrorRoute<TRouterContext<TRouter, TRouter['app']>>;

/*----------------------------------
- CLASS
----------------------------------*/

export default class ClientPage<TRouter extends ClientRouter<any, any> = ClientRouter<any, any>> extends PageResponse<
    TRouter,
    TClientPageRouteLike<TRouter>,
    TRouterContext<TRouter, TRouter['app']>
> {
    public scrollToId?: string;

    public constructor(
        public route: TClientPageRouteLike<TRouter>,
        public component: TPageRenderer,
        public context: TRouterContext<TRouter, TRouter['app']>,
        public layout?: Layout,
    ) {
        super(route, component, context);

        this.bodyId = context.route.options.bodyId;
        this.scrollToId = isClientRequest(context.request) ? context.request.hash : undefined;
    }

    // `fetchers`: the result of an earlier prepareFetchers() call, so the data providers do not run twice
    public async preRender(data?: TObjetDonnees, fetchers?: TFetcherList) {
        // Add the page to the context
        this.context.page = this;

        // Data succesfully loaded
        this.context.data = this.data = data || (await this.fetchData(fetchers));

        return this;
    }

    // The page swaps in before its data: deferred router mode, deferred page option and a data loader
    public isDeferred() {
        return shouldDeferNavigation(this.context.Router.config.navigation?.mode, this.route);
    }

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/
    // Should be called AFTER rendering the page
    public updateClient() {
        document.body.id = this.bodyId || this.chunkId || '';
        document.title = this.title || APP_NAME;
        document.body.className = [...this.bodyClass].join(' ');
    }

    public setAllData(callback: (data: { [k: string]: any }) => void) {
        console.warn(`page.setAllData not yet attached to the page Reatc component.`);
    }
    // Re-renders the page with this.navigation. Bound by the Page component, like setAllData
    public setNavigation(navigation: TPageNavigation) {}

    // Re-runs the data step of a deferred page (see createNavigationSequencer)
    public navigationRetry() {
        this.navigation.retry();
    }

    public setData(key: string, value: ((value: any) => void) | any) {
        this.setAllData((old) => ({ ...old, [key]: typeof value === 'function' ? value(old[key]) : value }));
    }

    public setLoading(state: boolean) {
        if (state === true) {
            if (!document.body.classList.contains('loading')) document.body.classList.add('loading');
        } else {
            document.body.classList.remove('loading');
        }
    }
}
