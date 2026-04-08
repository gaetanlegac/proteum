/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import { pathToRegexp, Key } from 'path-to-regexp';

// Core
import { getLayout } from './layouts';
import type { TRegisterPageArgs } from './contracts';

// types
import type { TRouteOptions } from '.';
import type { TPageDataProvider } from './response/page';

/*----------------------------------
- UTILS
----------------------------------*/

export const getRegisterPageArgs = (...args: TRegisterPageArgs<any, TRouteOptions>) => {
    const [path, options, data, renderer] = args;

    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error(`Router.page(${JSON.stringify(path)}) requires an explicit options object as its second argument.`);
    }

    if (data !== null && typeof data !== 'function') {
        throw new Error(
            `Router.page(${JSON.stringify(path)}) requires a data function or null as its third argument.`,
        );
    }

    // Automatic layout form the nearest _layout folder using static options only.
    const layout = getLayout(path, options);

    return { path, options, data: data as TPageDataProvider | null, renderer, layout };
};

export const buildRegex = (path: string) => {
    // pathToRegexp ne supporte plus les wildcards depuis 4.0
    if (path.endsWith('*')) path = path.substring(0, path.length - 1) + '(.*)';

    // path => regex
    const keys: Key[] = [];
    const regex = pathToRegexp(path, keys, { sensitive: true });

    return { keys: keys.map((k) => k.name), regex };
};
