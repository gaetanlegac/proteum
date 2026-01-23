/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core

import RequestService from './service';

import ApiClientService, { 
    TApiFetchOptions, TFetcherList, TFetcherArgs, TFetcher,
    TDataReturnedByFetchers
} from '@common/router/request/api';

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- SERVICE
----------------------------------*/
export default class ApiClientRequest extends RequestService implements ApiClientService {

    /*----------------------------------
    - HIGH LEVEL
    ----------------------------------*/

    public fetch<TProvidedData extends TFetcherList = TFetcherList>( 
        fetchers: TFetcherList 
    ): TDataReturnedByFetchers<TProvidedData> {
        throw new Error("api.fetch shouldn't be called here.");
    }

    /*----------------------------------
    - PLACEHOLDERS
    ----------------------------------*/

    public set( newData: TObjetDonnees ) {
        throw new Error("api.set is not available on server side.");
    }

    public reload( ids?: string | string[], params?: TObjetDonnees ) {
        throw new Error("api.set is not available on server side.");
    }

    /*----------------------------------
    - API CALLS FROM SERVER
    ----------------------------------*/

    public createFetcher<TData extends unknown = unknown>(...[method, path, data, options]: TFetcherArgs): TFetcher<TData> {
        return { 
            method, path, data, options,
            // We don't put the then and catch methods so the api consumer on server side will know it's a fetcher and not a promize to wait
        } as TFetcher<TData>;
    }

    public async fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees> {

        const fetchedData: TObjetDonnees = { ...alreadyLoadedData };

        for (const id in fetchers) {

            const fetcher = fetchers[id]
            if (!fetcher)
                continue;

            // Promise Fetcher (direct call from service method)
            if ('then' in fetcher) {
                fetchedData[id] = await fetcher;
                continue;
            }

            const { method, path, data, options } = fetcher;
            //this.router.config.debug && console.log(`[api] Resolving from internal api`, method, path, data);

            // We don't fetch the already given data
            if (id in fetchedData)
                continue;

            // Create a children request to resolve the api data
            const request = this.request.children(method, path, data);
            fetchedData[id] = await request.router.resolve(request).then(res => res.data);
        }

        return fetchedData;
    } 
}