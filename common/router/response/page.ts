/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { VNode } from 'preact';
import type { Thing } from 'schema-dts';

// Core libs
import { ClientOrServerRouter, TClientOrServerContextForPage, TRoute, TErrorRoute } from '@common/router';
import { TFetcherList, TDataReturnedByFetchers } from '@common/router/request/api';

/*----------------------------------
- TYPES
----------------------------------*/

// The function that fetch data from the api before to pass them as context to the renderer
export type TDataProvider<TProvidedData extends TFetcherList = TFetcherList> = (
    context: TClientOrServerContextForPage & {
        // URL query parameters
        // TODO: typings
        data: {[key: string]: string | number}
    }
) => TProvidedData

// The function that renders routes
export type TFrontRenderer<
    TProvidedData extends TFetcherList = TFetcherList, 
    TAdditionnalData extends {} = {},
    TRouter = ClientOrServerRouter,
> = ( 
    context: (
        TClientOrServerContextForPage 
        &
        TAdditionnalData
        &
        {
            context: TClientOrServerContextForPage,
            data: {[key: string]: PrimitiveValue}
        }
    )
) => VNode<any> | null

// Script or CSS resource
export type TPageResource = {
    id: string,
    attrs?: TObjetDonnees
} & ({
    inline: string
} | {
    url: string,
    preload?: boolean
    })

type TMetasDict = {
    [key: string]: string | Date | undefined | null
}

type TMetasList = ({ $: string } & TMetasDict)[]

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
        public context: TClientOrServerContextForPage
    ) {

        this.chunkId = context.route.options["id"];

        this.url = context.request.url;

        this.fetchers = this.createFetchers(route.options.data);
       
    }

    private createFetchers( dataProvider?: TDataProvider ) {

        // Load the fetchers list to load data if needed
        if (dataProvider)
            return dataProvider({
                ...this.context,
                data: this.context.request.data
            });
        else
            return {}

    }
    
    public async fetchData() {

        // Fetch layout data
        if (this.layout?.data) {
            const fetchers = this.createFetchers(this.layout.data);
            this.fetchers = { ...this.fetchers, ...fetchers };
        }

        // Fetch page data
        debug && console.log(`[router][page] Fetching api data:` + Object.keys(this.fetchers));
        this.data = await this.context.request.api.fetchSync( this.fetchers, this.data );

        return this.data;
    }
}