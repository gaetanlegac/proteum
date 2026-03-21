/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { TFrontRenderer, TPageSetup } from './response/page';
import type { TRouteOptions } from '.';

/*----------------------------------
- PUBLIC API
----------------------------------*/

// Supported `Router.page(...)` registration signatures shared by client and compiler code.
export type TRegisterPageArgs<TProvidedData extends {} = {}, TPageOptions extends {} = TRouteOptions> =
    | [path: string, renderer: TFrontRenderer<TProvidedData>]
    | [path: string, setup: TPageSetup<TProvidedData>, renderer: TFrontRenderer<TProvidedData>]
    | [path: string, options: Partial<TPageOptions>, renderer: TFrontRenderer<TProvidedData>]
    | [
          path: string,
          options: Partial<TPageOptions>,
          setup: TPageSetup<TProvidedData>,
          renderer: TFrontRenderer<TProvidedData>,
      ];

// Serialized SSR route description exchanged between build output and runtime.
export type TSsrUnresolvedRoute<TKey = number | string> = { chunk: string } & (
    | { regex: string; keys: TKey[] }
    | { code: number }
);
