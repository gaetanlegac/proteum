/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { TFrontRenderer, TPageDataProvider } from './response/page';
import type { TRouteOptions } from '.';

/*----------------------------------
- PUBLIC API
----------------------------------*/

// Supported `Router.page(...)` registration signature shared by client and compiler code.
export type TRegisterPageArgs<TProvidedData extends {} = {}, TPageOptions extends {} = TRouteOptions> =
    [
        path: string,
        options: Partial<TPageOptions>,
        data: TPageDataProvider<TProvidedData> | null,
        renderer: TFrontRenderer<TProvidedData>,
    ];

// Serialized SSR route description exchanged between build output and runtime.
export type TSsrUnresolvedRoute<TKey = number | string> = { chunk: string } & (
    | { regex: string; keys: TKey[] }
    | { code: number }
);
