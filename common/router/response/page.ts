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
import { validatePageDataResult } from '@common/router/pageData';

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

    public constructor(
        public route: TRouteLike,
        public renderer: TFrontRenderer,
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

    public async fetchData() {
        this.fetchers = this.createFetchers();
        this.bodyId = this.route.options.bodyId;

        // Fetch layout data
        if (this.layout?.data) {
            const layoutContext = {
                ...this.context,
                data: this.context.request.data,
            } as unknown as Parameters<typeof this.layout.data>[0];
            const fetchers = this.layout.data(layoutContext);
            this.fetchers = { ...this.fetchers, ...fetchers };
        }

        // Fetch page data
        debug && console.log(`[router][page] Fetching api data:` + Object.keys(this.fetchers));
        this.data = await this.context.request.api.fetchSync(this.fetchers, this.data);

        return this.data;
    }
}
