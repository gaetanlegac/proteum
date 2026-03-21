/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { VNode } from 'preact';
import type { Thing } from 'schema-dts';

// Core libs
import { ClientOrServerRouter, TClientOrServerContextForPage, TRoute, TErrorRoute } from '@common/router';
import { TFetcherList, TDataReturnedByFetchers } from '@common/router/request/api';
import { splitRouteSetupResult } from '@common/router/pageSetup';

/*----------------------------------
- TYPES
----------------------------------*/

// The function that prepares route config and SSR data before rendering.
export type TPageSetup<TProvidedData extends {} = {}> = (
    context: TClientOrServerContextForPage & {
        // URL query parameters
        // TODO: typings
        data: { [key: string]: string | number };
    },
) => TProvidedData;

// The function that renders routes
export type TFrontRenderer<
    TProvidedData extends {} = {},
    TAdditionnalData extends {} = {},
    TRouter = ClientOrServerRouter,
> = (
    context: TClientOrServerContextForPage &
        TProvidedData &
        TAdditionnalData & { context: TClientOrServerContextForPage; data: { [key: string]: PrimitiveValue } },
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
export default abstract class PageResponse<TRouter extends ClientOrServerRouter = ClientOrServerRouter> {
    // Metadata
    public chunkId: string;
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

    // Data
    public fetchers: TFetcherList = {};
    public data: TObjetDonnees = {};

    public constructor(
        public route: TRoute | TErrorRoute,
        public renderer: TFrontRenderer,
        public context: TClientOrServerContextForPage,
    ) {
        this.chunkId = context.route.options['id'];

        this.url = context.request.url;
    }

    private resolveSetup() {
        const setup = this.route.options.setup;
        if (!setup) return { options: {}, data: {} };

        return splitRouteSetupResult(setup({ ...this.context, data: this.context.request.data }) || {});
    }

    private createFetchers() {
        const { options, data } = this.resolveSetup();
        this.route.options = { ...this.route.options, ...options };
        this.chunkId = this.route.options['id'];

        return data as TFetcherList;
    }

    public async fetchData() {
        this.fetchers = this.createFetchers();
        this.bodyId = this.route.options.bodyId;

        // Fetch layout data
        if (this.layout?.data) {
            const fetchers = this.layout.data({ ...this.context, data: this.context.request.data });
            this.fetchers = { ...this.fetchers, ...fetchers };
        }

        // Fetch page data
        debug && console.log(`[router][page] Fetching api data:` + Object.keys(this.fetchers));
        this.data = await this.context.request.api.fetchSync(this.fetchers, this.data);

        return this.data;
    }
}
