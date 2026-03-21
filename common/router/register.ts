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
import type { TFrontRenderer, TPageSetup } from './response/page';

/*----------------------------------
- UTILS
----------------------------------*/

export const getRegisterPageArgs = (...args: TRegisterPageArgs<any, TRouteOptions>) => {
    let path: string;
    let options: Partial<TRouteOptions> = {};
    let setup: TPageSetup | undefined;
    let renderer: TFrontRenderer;

    if (args.length === 2) {
        [path, renderer] = args;
    } else if (args.length === 3) {
        const [pathArg, optionsOrSetupArg, rendererArg] = args;
        path = pathArg;
        renderer = rendererArg;

        if (typeof optionsOrSetupArg === 'function') setup = optionsOrSetupArg;
        else options = optionsOrSetupArg;
    } else {
        const [pathArg, optionsArg, setupArg, rendererArg] = args;
        path = pathArg;
        options = optionsArg;
        setup = setupArg;
        renderer = rendererArg;
    }

    // Automatic layout form the nearest _layout folder using static options only.
    const layout = getLayout(path, options);

    return { path, options, setup, renderer, layout };
};

export const getRegisterPageOptions = (...args: TRegisterPageArgs<any, TRouteOptions>) => {
    let path: string;
    let options: Partial<TRouteOptions> = {};
    let setup: TPageSetup | undefined;
    let renderer: TFrontRenderer;

    if (args.length === 2) {
        [path, renderer] = args;
    } else if (args.length === 3) {
        const [pathArg, optionsOrSetupArg, rendererArg] = args;
        path = pathArg;
        renderer = rendererArg;

        if (typeof optionsOrSetupArg === 'function') setup = optionsOrSetupArg;
        else options = optionsOrSetupArg;
    } else {
        const [pathArg, optionsArg, setupArg, rendererArg] = args;
        path = pathArg;
        options = optionsArg;
        setup = setupArg;
        renderer = rendererArg;
    }

    return { path, options, setup, renderer };
};

export const buildRegex = (path: string) => {
    // pathToRegexp ne supporte plus les wildcards depuis 4.0
    if (path.endsWith('*')) path = path.substring(0, path.length - 1) + '(.*)';

    // path => regex
    const keys: Key[] = [];
    const regex = pathToRegexp(path, keys, { sensitive: true });

    return { keys: keys.map((k) => k.name), regex };
};
