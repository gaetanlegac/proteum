/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { TFetcherList } from './request/api';
import type { TFrontRenderer } from './response/page';

/*----------------------------------
- TYPES
----------------------------------*/

export type TRegisterPageArgs<
    TProvidedData extends TFetcherList = TFetcherList,
    TRouteOptions extends {} = {}
> = ([
    path: string,
    renderer: TFrontRenderer<TProvidedData>
] | [
    path: string,
    options: Partial<TRouteOptions>,
    renderer: TFrontRenderer<TProvidedData>
])

export type TSsrUnresolvedRoute<TKey = number | string> = {
    chunk: string,
} & ({
    regex: string,
    keys: TKey[]
} | {
    code: number
})
