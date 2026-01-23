/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type { HttpMethod } from '@server/services/router';

/*----------------------------------
- TYPES
----------------------------------*/

// The fetcher can be undefined if we put a condition on it
// By example if we want to fetch an api endpoint only if the url contains a certain url parameter
export type TFetcherList = { [id: string]: /*TFetcher | */Promise<any> | undefined }

export type TFetcher<TData extends any = unknown> = {

    // For async calls: api.post(...).then((data) => ...)
    then: (callback: (data: TData) => void) => Promise<TData>,
    catch: (callback: (data: any) => false | void) => Promise<TData>,
    finally: (callback: () => void) => Promise<TData>,
    run: () => Promise<TData>,
    
    method: HttpMethod,
    path: string,
    data?: TPostDataWithFile,
    options?: TApiFetchOptions
}

export type TFetcherArgs = [
    method: HttpMethod,
    path: string,
    data?: TPostDataWithFile,
    options?: TApiFetchOptions
]

export type TApiFetchOptions = {
    captcha?: string, // Action id (required by recaptcha)
    onProgress?: (percent: number) => void,
    // Default: json
    encoding?: 'json' | 'multipart'
}

export type TPostData = TPostDataWithFile

export type TPostDataWithFile = { [key: string]: PrimitiveValue }

export type TPostDataWithoutFile = { [key: string]: PrimitiveValue }

// https://stackoverflow.com/questions/44851268/typescript-how-to-extract-the-generic-parameter-from-a-type
type TypeWithGeneric<T> = TFetcher<T>
type extractGeneric<Type> = Type extends TypeWithGeneric<infer X> ? X : never

export type TDataReturnedByFetchers<TProvidedData extends TFetcherList = {}> = {
    [Property in keyof TProvidedData]: ThenArg< TProvidedData[Property] >
}

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class ApiClient {

    /*----------------------------------
    - TOP LEVEL
    ----------------------------------*/

    public abstract set( newData: TObjetDonnees );

    public abstract reload( ids?: string | string[], params?: TObjetDonnees );

    /*----------------------------------
    - LOW LEVEL
    ----------------------------------*/

    public abstract createFetcher<TData extends unknown = unknown>(...args: TFetcherArgs): TFetcher<TData>;

    public abstract fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees>;
}