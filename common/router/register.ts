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
import type { TFrontRenderer } from './response/page';

/*----------------------------------
- UTILS
----------------------------------*/

export const getRegisterPageArgs = (...args: TRegisterPageArgs<any, TRouteOptions>) => {

    let path: string;
    let options: Partial<TRouteOptions> = {};
    let renderer: TFrontRenderer;

    if (args.length === 2)
        ([path, renderer] = args)
    else
        ([path, options, renderer] = args)

    // Automatic layout form the nearest _layout folder
    const layout = getLayout(path, options);

    return { path, options, renderer, layout }

}

export const buildRegex = ( path: string ) => {

    // pathToRegexp ne supporte plus les wildcards depuis 4.0
    if (path.endsWith('*'))
        path = path.substring(0, path.length - 1) + '(.*)';

    // path => regex
    const keys: Key[] = []
    const regex = pathToRegexp(path, keys, {
        sensitive: true
    }); 

    return { 
        keys: keys.map(k => k.name), 
        regex 
    }

}
