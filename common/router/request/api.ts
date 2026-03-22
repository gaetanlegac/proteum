/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type { HttpMethod } from '@server/services/router';

/*----------------------------------
- TYPES
----------------------------------*/

// The fetcher can be undefined if we put a condition on it
// By example if we want to fetch an api endpoint only if the url contains a certain url parameter
export type TFetcherList = { [id: string]: TFetcher<any> | Promise<any> | undefined };

export type TFetcher<TData extends any = unknown> = {
    // For async calls: api.post(...).then((data) => ...)
    then: <TResult1 = TData, TResult2 = never>(
        onfulfilled?: ((value: TData) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
    catch: <TResult = never>(
        onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ) => Promise<TData | TResult>;
    finally: (onfinally?: (() => void) | null) => Promise<TData>;
    run: () => Promise<TData>;

    method: HttpMethod;
    path: string;
    data?: TPostDataWithFile;
    options?: TApiFetchOptions;
};

export type TFetcherArgs = [method: HttpMethod, path: string, data?: TPostDataWithFile, options?: TApiFetchOptions];

export type TApiFetchOptions = {
    captcha?: string; // Action id (required by recaptcha)
    onProgress?: (percent: number) => void;
    // Default: json
    encoding?: 'json' | 'multipart';
};

export type TPostData = TPostDataWithFile;

export type TPostDataWithFile = { [key: string]: PrimitiveValue };

export type TPostDataWithoutFile = { [key: string]: PrimitiveValue };

export type TDataReturnedByFetchers<TProvidedData extends TFetcherList = {}> = {
    [Property in keyof TProvidedData]: ThenArg<TProvidedData[Property]>;
};

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class ApiClient {
    /*----------------------------------
    - TOP LEVEL
    ----------------------------------*/

    public abstract set(newData: TObjetDonnees): void;

    public abstract reload(ids?: string | string[], params?: TObjetDonnees): void;

    /*----------------------------------
    - LOW LEVEL
    ----------------------------------*/

    public abstract createFetcher<TData extends unknown = unknown>(...args: TFetcherArgs): TFetcher<TData>;

    public abstract fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees>;
}
