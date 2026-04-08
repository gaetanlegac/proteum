/*----------------------------------
- TYPES
----------------------------------*/

import type { TAnyRoute, TRouteOptions } from '.';

export const routeOptionKeys = [
    'bodyId',
    'priority',
    'preload',
    'domain',
    'accept',
    'raw',
    'auth',
    'authTracking',
    'redirectLogged',
    'static',
    'whenStatic',
    'canonicalParams',
    'layout',
    'TESTING',
    'logging',
] as const satisfies (keyof TRouteOptions)[];

export const reservedRouteOptionKeys = ['id', 'filepath', 'sourceLocation', 'data'] as const;

const routeOptionKeysSet = new Set<string>(routeOptionKeys);
const reservedRouteOptionKeysSet = new Set<string>(reservedRouteOptionKeys);
const reservedPageDataKeys = new Set<string>([
    ...routeOptionKeys,
    ...reservedRouteOptionKeys,
    ...routeOptionKeys.map((key) => `_${key}`),
    ...reservedRouteOptionKeys.map((key) => `_${key}`),
]);

const formatRouteTarget = (route: TAnyRoute) => ('code' in route ? String(route.code) : route.path || '(unknown route)');

const formatRouteSource = (route: TAnyRoute) => {
    const filepath = route.options.filepath || 'unknown file';
    const line = route.options.sourceLocation?.line;
    const column = route.options.sourceLocation?.column;

    if (!line) return filepath;
    if (!column) return `${filepath}:${line}`;
    return `${filepath}:${line}:${column}`;
};

export const getRouteOptionKey = (key: string) => {
    if (reservedRouteOptionKeysSet.has(key)) throw new Error(`"${key}" is a reserved Router.page option key.`);

    return routeOptionKeysSet.has(key) ? (key as keyof TRouteOptions) : null;
};

export const validatePageDataResult = (route: TAnyRoute, result: unknown) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(
            `Router.page data for ${formatRouteTarget(route)} in ${formatRouteSource(route)} must return an object. ` +
                `If the page has no data loader, pass null as the third argument.`,
        );
    }

    for (const key of Object.keys(result)) {
        if (!reservedPageDataKeys.has(key)) continue;

        throw new Error(
            `Router.page data for ${formatRouteTarget(route)} in ${formatRouteSource(route)} cannot return reserved key "${key}". ` +
                `Move route behavior into the explicit Router.page(path, options, data, render) options argument.`,
        );
    }

    return result as TObjetDonnees;
};
