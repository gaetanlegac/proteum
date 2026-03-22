/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { ComponentChild } from 'preact';

// Core
import type { Layout, TErrorRoute, TRoute } from '@common/router';
import PageResponse, { TFrontRenderer } from '@common/router/response/page';
import { isClientRequest } from '../request';

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
        public component: TFrontRenderer,
        public context: TRouterContext<TRouter, TRouter['app']>,
        public layout?: Layout,
    ) {
        super(route, component, context);

        this.bodyId = context.route.options.bodyId;
        this.scrollToId = isClientRequest(context.request) ? context.request.hash : undefined;
    }

    public async preRender(data?: TObjetDonnees) {
        // Add the page to the context
        this.context.page = this;

        // Data succesfully loaded
        this.context.data = this.data = data || (await this.fetchData());

        return this;
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
