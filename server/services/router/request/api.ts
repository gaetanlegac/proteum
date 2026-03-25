/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core

import RequestService from './service';

import ApiClientService, {
    TFetcherList,
    TFetcherArgs,
    TFetcher,
    TDataReturnedByFetchers,
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
        _fetchers: TFetcherList,
    ): TDataReturnedByFetchers<TProvidedData> {
        throw new Error("api.fetch shouldn't be called here.");
    }

    /*----------------------------------
    - PLACEHOLDERS
    ----------------------------------*/

    public set(_newData: TObjetDonnees) {
        throw new Error('api.set is not available on server side.');
    }

    public reload(_ids?: string | string[], _params?: TObjetDonnees) {
        throw new Error('api.set is not available on server side.');
    }

    /*----------------------------------
    - API CALLS FROM SERVER
    ----------------------------------*/

    public createFetcher<TData extends unknown = unknown>(
        ...[method, path, data, options]: TFetcherArgs
    ): TFetcher<TData> {
        return {
            method,
            path,
            data,
            options,
            // We don't put the then and catch methods so the api consumer on server side will know it's a fetcher and not a promize to wait
        } as TFetcher<TData>;
    }

    public async fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees> {
        const fetchedData: TObjetDonnees = { ...alreadyLoadedData };

        for (const id in fetchers) {
            const fetcher = fetchers[id];
            if (!fetcher) continue;

            // Promise Fetcher (direct call from service method)
            if ('then' in fetcher) {
                fetchedData[id] = await fetcher;
                continue;
            }

            const { method, path, data } = fetcher;
            //this.router.config.debug && console.log(`[api] Resolving from internal api`, method, path, data);

            // We don't fetch the already given data
            if (id in fetchedData) continue;

            // Create a children request to resolve the api data
            const request = this.request.children(method, path, data);
            const callId = this.request.router.app.container.Trace.startCall(this.request.id, {
                origin: 'ssr-fetcher',
                label: id,
                method,
                path,
                fetcherId: id,
                requestDataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
                requestData: data,
            });

            try {
                const response = await request.router.resolve(request);
                fetchedData[id] = response.data;
                this.request.router.app.container.Trace.finishCall(this.request.id, callId, {
                    statusCode: response.statusCode,
                    resultKeys:
                        response.data && typeof response.data === 'object' && !Array.isArray(response.data)
                            ? Object.keys(response.data as Record<string, unknown>)
                            : [],
                    result: response.data,
                });
            } catch (error) {
                const typedError = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
                const statusCode = 'http' in typedError ? Number((typedError as Error & { http?: number }).http) : undefined;
                this.request.router.app.container.Trace.finishCall(this.request.id, callId, {
                    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
                    errorMessage: typedError.message,
                });
                throw error;
            }
        }

        return fetchedData;
    }
}
