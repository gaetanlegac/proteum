/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type ClientApplication from '@client/app';
import { fromJson as errorFromJson, NetworkError } from '@common/errors';
import ApiClientService, { 
    TPostData, TPostDataWithoutFile,
    TApiFetchOptions, TFetcherList, TFetcherArgs, TFetcher,
    TDataReturnedByFetchers
} from '@common/router/request/api';


// Specific
import type { default as Router, Request } from '..';
import { toMultipart } from './multipart';

/*----------------------------------
- TYPES
----------------------------------*/

const debug = false;

export type Config = {

}

/*----------------------------------
- FUNCTION
----------------------------------*/
export default class ApiClient implements ApiClientService {

    // APO Client needs to know the current request so we can monitor which api request is made from which page
    public constructor( 
        public app: ClientApplication, 
        public request: Request,
        public router = request.router,
    ) {

    }

    /*----------------------------------
    - HIGH LEVEL
    ----------------------------------*/

    public fetch<FetchersList extends TFetcherList = TFetcherList>( 
        fetchers: FetchersList 
    ): TDataReturnedByFetchers<FetchersList> {
        throw new Error("api.fetch shouldn't be called here.");
    }

    public post = <TData extends unknown = unknown>(path: string, data?: TPostData, opts?: TApiFetchOptions) => 
        this.createFetcher<TData>('POST', path, data, opts);

    public set( newData: TObjetDonnees ) {

        if (!('context' in this.router))
            throw new Error("api.set is not available on server side.");

        if (this.router.context.page)
            this.router.context.page.setAllData(curData => ({ ...curData, ...newData }));
        else
            throw new Error(`[api] this.router.context.page undefined`)
    }

    public reload( ids?: string | string[], params?: TObjetDonnees ) {

        if (!('context' in this.router))
            throw new Error("api.reload is not available on server side.");
        
        const page = this.router.context.page;

        if (ids === undefined)
            ids = Object.keys(page.fetchers);
        else if (typeof ids === 'string')   
            ids = [ids];

        debug && console.log("[api] Reload data", ids, params, page.fetchers);

        for (const id of ids) {

            const fetcher = page.fetchers[id];
            if (fetcher === undefined)
                return console.error(`Unable to reload ${id}: Request not found in fetchers list.`);

            if (params !== undefined)
                fetcher.data = { ...(fetcher.data || {}), ...params };

            debug && console.log("[api][reload]", id, fetcher.method, fetcher.path, fetcher.data);

            this.fetchAsync(fetcher.method, fetcher.path, fetcher.data).then((data) => {

                this.set({ [id]: data });

            })
        }
    }

    /*----------------------------------
    - LOW LEVEL
    ----------------------------------*/
    public createFetcher<TData extends unknown = unknown>(...args: TFetcherArgs): TFetcher<TData> {
        const [method, path, data, options] = args;

        // Lazily create (and cache) the underlying promise so the fetcher behaves like a real promise instance.
        let promise: Promise<TData> | undefined;

        const fetcher = {
            method, path, data, options,
        } as TFetcher<TData>;

        const getPromise = () => {
            if (!promise)
                promise = this.fetchAsync<TData>(fetcher.method, fetcher.path, fetcher.data, fetcher.options);

            return promise;
        };

        // For async calls: api.post(...).then((data) => ...)
        fetcher.then = (onfulfilled?: any, onrejected?: any) =>
            getPromise().then(onfulfilled, onrejected) as any;

        fetcher.catch = (onrejected?: any) =>
            getPromise().catch(onrejected) as any;

        fetcher.finally = (onfinally?: any) =>
            getPromise().finally(onfinally) as any;

        fetcher.run = () => getPromise();

        return fetcher;
    }

    public async fetchAsync<TData extends unknown = unknown>(...[
        method, path, data, options
    ]: TFetcherArgs): Promise<TData> {

        /*if (options?.captcha !== undefined)
            await this.gui.captcha.check(options?.captcha);*/

        return await this.execute<TData>(method, path, data, options);
    }

    public async fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees> {

        // Pick the fetchers where the data is needed
        const fetchersToRun: TFetcherList = {};
        let fetchersCount: number = 0;
        for (const fetcherId in fetchers) 
            // The fetcher can be undefined
            if (!( fetcherId in alreadyLoadedData ) && fetchers[ fetcherId ]) {
                fetchersToRun[ fetcherId ] = fetchers[ fetcherId ]
                fetchersCount++;
            }

        // Fetch all the api data thanks to one http request
        const fetchedData = fetchersCount === 0
            ? 0
            : await this.execute("POST", "/api", { 
                fetchers: fetchersToRun 
            }).then((res) => {

                const data: TObjetDonnees = {};
                for (const id in res) 
                    data[id] = res[id];

                return data;

            }).catch(e => {

                // API Error hook
                this.app.handleError(e);

                throw e;
            })

        // Errors will be catched in the caller

        return { ...alreadyLoadedData, ...fetchedData }
    }

    public configure = (...[method, path, data, options = {}]: TFetcherArgs) => {
    
        let url = this.router.url(path, {}, false);
    
        debug && console.log(`[api] Sending request`, method, url, data);
    
        // Create Fetch config
        const config: With<RequestInit, 'headers'> = {
            method: method,
            headers: {
                'Accept': "application/json",
            }
        };
    
        // Update options depending on data
        if (data) {

            // If file included in data, need to use multipart
            // TODO: deep check
            const hasFile = Object.values(data).some((value) => value instanceof File);
            if (hasFile) {
                // GET request = Can't send files
                if (method === "GET")
                    throw new Error("Cannot send file in GET request");
                // Auto switch to multiplart
                else if (options.encoding === undefined)
                    options.encoding = 'multipart';
                else if (options.encoding !== 'multipart')
                // Encoding set to JSON = Can't send files
                    throw new Error("Cannot send file in non-multipart request");
            }

            // Data encoding
            if (method === "GET") {

                const params = new URLSearchParams( data as unknown as TPostDataWithoutFile ).toString();
                url = `${url}?${params}`;

            } else if (options.encoding === 'multipart') {

                debug && console.log("[api] Multipart request", data);
                // Browser will automatically choose the right headers
                config.body = toMultipart(data);

            } else {
                config.headers["Content-Type"] = "application/json";
                config.body = JSON.stringify(data);
            }
        }
    
        return { url, config };
    }
    
    public execute<TData = unknown>(...args: TFetcherArgs): Promise<TData> {
        const { url, config } = this.configure(...args);

        console.log(`[api] Fetching`, url, config);
    
        return fetch(url, config)
            .then(async (response) => {
                if (!response.ok) {

                    const errorData = await response.json();
                    console.warn(`[api] Failure:`, response.status, errorData);
                    const error = errorFromJson(errorData);
                    throw error;
                }
                const json = await response.json() as TData;
                debug && console.log(`[api] Success:`, json);
                return json;
            })
            .catch((error) => {
                if (error instanceof TypeError) {
                    // Network error
                    console.warn(`[api] Network Failure:`, error);
                    const networkError = new NetworkError(error.message);
                    this.app.handleError(networkError);
                    throw networkError;
                } else {
                    throw error;
                }
            });
    }
    
}
