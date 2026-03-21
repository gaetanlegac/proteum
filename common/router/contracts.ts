/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { TFetcherList } from "./request/api";
import type { TFrontRenderer, TPageSetup } from "./response/page";
import type { TRouteOptions } from ".";

/*----------------------------------
- TYPES
----------------------------------*/

export type TRegisterPageArgs<
  TProvidedData extends {} = {},
  TPageOptions extends {} = TRouteOptions,
> =
  | [path: string, renderer: TFrontRenderer<TProvidedData>]
  | [
      path: string,
      setup: TPageSetup<TProvidedData>,
      renderer: TFrontRenderer<TProvidedData>,
    ]
  | [
      path: string,
      options: Partial<TPageOptions>,
      renderer: TFrontRenderer<TProvidedData>,
    ]
  | [
      path: string,
      options: Partial<TPageOptions>,
      setup: TPageSetup<TProvidedData>,
      renderer: TFrontRenderer<TProvidedData>,
    ];

export type TSsrUnresolvedRoute<TKey = number | string> = {
  chunk: string;
} & (
  | {
      regex: string;
      keys: TKey[];
    }
  | {
      code: number;
    }
);
