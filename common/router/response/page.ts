/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { VNode } from 'preact';
import type { Thing } from 'schema-dts';

// Core libs
import type { ClientContext } from '@/client/context';
import { ClientOrServerRouter, TErrorRoute, TPageErrorRoute, TPageRoute, TRoute, TRouteOptions } from '@common/router';
import type { TFetcher, TFetcherList } from '@common/router/request/api';
import { validateDeferredDataKeys, validatePageDataResult } from '@common/router/pageData';

/*----------------------------------
- TYPES
----------------------------------*/

export type TPageDataContext = ClientContext;

export type TPageRenderContext = With<ClientContext, 'page'>;

type TPageResponseContext = {
    route: { options: Partial<TRouteOptions> };
    request: {
        url: string;
        data: TObjetDonnees;
        api: {
            fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees>;
        };
    };
};

export type TResolvedPageData<TProvidedData extends {} = {}> = {
    [Property in keyof TProvidedData]: TProvidedData[Property] extends TFetcher<infer TData>
        ? TData
        : Awaited<TProvidedData[Property]>;
};

// The function that prepares SSR data before rendering.
export type TPageDataProvider<TProvidedData extends {} = {}> = (
    context: TPageDataContext & {
        // URL query parameters
        // TODO: typings
        data: { [key: string]: string | number };
    },
) => TProvidedData;

export type TDataProvider<TProvidedData extends {} = TFetcherList> = (
    context: TPageDataContext & { data: { [key: string]: PrimitiveValue } },
) => TProvidedData;

// The function that renders routes
export type TFrontRenderer<
    TProvidedData extends {} = {},
    TAdditionnalData extends {} = {},
    TRouter = ClientOrServerRouter,
> = (
    context: TPageRenderContext &
        TResolvedPageData<TProvidedData> &
        TAdditionnalData & { context: TPageRenderContext; data: { [key: string]: PrimitiveValue } },
) => VNode<any> | null;

// Navigation state of a page that declares navigation: 'deferred'.
// `since` is the Date.now() timestamp of the last status change; `stale` means the previous data is still on screen.
// `reloading` means the data step runs again for a navigation whose data already reached the screen (api.reload,
//  or retry() after ready): the stale data is this page's own, never a previous page's under the new URL.
type TPageNavigationBase = { since: number; retry: () => void };

export type TPageNavigation =
    | (TPageNavigationBase & { status: 'ready'; pending: false; stale: false; reloading: false; error: null })
    | (TPageNavigationBase & { status: 'pending'; pending: true; stale: boolean; reloading: boolean; error: null })
    | (TPageNavigationBase & { status: 'error'; pending: false; stale: boolean; reloading: boolean; error: Error });

export type TPageNavigationState =
    | { status: 'ready' }
    | { status: 'pending'; stale: boolean; reloading?: boolean }
    | { status: 'error'; stale: boolean; reloading?: boolean; error: Error };

export const createPageNavigation = (state: TPageNavigationState, retry: () => void = () => {}): TPageNavigation => {
    const base = { since: Date.now(), retry };

    if (state.status === 'ready')
        return { ...base, status: 'ready', pending: false, stale: false, reloading: false, error: null };
    if (state.status === 'pending')
        return {
            ...base,
            status: 'pending',
            pending: true,
            stale: state.stale,
            reloading: state.reloading === true,
            error: null,
        };
    return {
        ...base,
        status: 'error',
        pending: false,
        stale: state.stale,
        reloading: state.reloading === true,
        error: state.error,
    };
};

// Page data as a deferred page sees it: every key is undefined until the navigation is ready
export type TDeferredPageData<TProvidedData extends {} = {}> = {
    [Property in keyof TResolvedPageData<TProvidedData>]: TResolvedPageData<TProvidedData>[Property] | undefined;
};

// The renderer of a page that declares navigation: 'deferred'
export type TDeferredFrontRenderer<TProvidedData extends {} = {}> = (
    context: TPageRenderContext &
        TDeferredPageData<TProvidedData> & {
            context: TPageRenderContext;
            data: { [key: string]: PrimitiveValue };
            navigation: TPageNavigation;
        },
) => VNode<any> | null;

export type TPageRenderer<TProvidedData extends {} = {}> =
    | TFrontRenderer<TProvidedData>
    | TDeferredFrontRenderer<TProvidedData>;

// Script or CSS resource
export type TPageResource = { id: string; attrs?: TObjetDonnees } & (
    | { inline: string }
    | { url: string; preload?: boolean }
);

type TMetasDict = { [key: string]: string | Date | undefined | null };

type TMetasList = ({ $: string } & TMetasDict)[];

const debug = false;

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class PageResponse<
    TRouter extends ClientOrServerRouter = ClientOrServerRouter,
    TRouteLike extends TRoute | TErrorRoute = TPageRoute | TPageErrorRoute,
    TContext extends TPageResponseContext = TPageResponseContext,
> {
    // Metadata
    public chunkId?: string;
    public title?: string;
    public description?: string;
    public bodyClass: Set<string> = new Set<string>();
    public bodyId?: string;
    public url: string;

    // Resources
    public head: TMetasList = [];
    public metas: TMetasDict = {};
    public jsonld: Thing[] = [];
    public scripts: TPageResource[] = [];
    public style: TPageResource[] = [];
    public layout?: { data?: TDataProvider };

    // Data
    public fetchers: TFetcherList = {};
    public data: TObjetDonnees = {};
    public navigation: TPageNavigation = createPageNavigation({ status: 'ready' });

    public constructor(
        public route: TRouteLike,
        public renderer: TPageRenderer,
        public context: TContext,
    ) {
        this.chunkId = context.route.options.id;

        this.url = context.request.url;
    }

    private resolveDataProviderResult() {
        const dataProvider = 'data' in this.route ? this.route.data : undefined;
        if (!dataProvider) return {};

        const dataContext = { ...this.context, data: this.context.request.data } as unknown as Parameters<
            typeof dataProvider
        >[0];

        return validatePageDataResult(this.route, dataProvider(dataContext));
    }

    private createFetchers() {
        const data = this.resolveDataProviderResult();
        this.chunkId = this.route.options.id;

        return data as TFetcherList;
    }

    // Runs the page and layout data providers without fetching anything
    public prepareFetchers() {
        this.fetchers = this.createFetchers();
        this.bodyId = this.route.options.bodyId;

        // Layout data
        if (this.layout?.data) {
            const layoutContext = {
                ...this.context,
                data: this.context.request.data,
            } as unknown as Parameters<typeof this.layout.data>[0];
            const fetchers = this.layout.data(layoutContext);
            validateDeferredDataKeys(this.route, fetchers, 'Layout data');
            this.fetchers = { ...this.fetchers, ...fetchers };
        }

        return this.fetchers;
    }

    // Pass the fetchers of an earlier prepareFetchers() call to skip running the providers again
    public async fetchData(fetchers: TFetcherList = this.prepareFetchers()) {
        debug && console.log(`[router][page] Fetching api data:` + Object.keys(fetchers));
        this.data = await this.context.request.api.fetchSync(fetchers, this.data);

        return this.data;
    }
}
