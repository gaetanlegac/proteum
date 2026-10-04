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
    'navigation',
    'TESTING',
    'logging',
] as const satisfies (keyof TRouteOptions)[];

export const reservedRouteOptionKeys = ['id', 'filepath', 'sourceLocation', 'data'] as const;

// `navigation` stays a legal data key on blocking pages, where apps already return one.
// A deferred page reserves it for its navigation render prop (see validateDeferredDataKeys).
const dataReservedRouteOptionKeys = routeOptionKeys.filter((key) => key !== 'navigation');

const routeOptionKeysSet = new Set<string>(routeOptionKeys);
const reservedRouteOptionKeysSet = new Set<string>(reservedRouteOptionKeys);
const reservedPageDataKeys = new Set<string>([
    ...dataReservedRouteOptionKeys,
    ...reservedRouteOptionKeys,
    ...dataReservedRouteOptionKeys.map((key) => `_${key}`),
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
    if (reservedRouteOptionKeysSet.has(key)) throw new Error(`"${key}" is a reserved route option key.`);

    return routeOptionKeysSet.has(key) ? (key as keyof TRouteOptions) : null;
};

// Page and layout data both reach the render props, where a deferred page reads `navigation`
export const validateDeferredDataKeys = (route: TAnyRoute, result: object, source: string) => {
    if (route.options.navigation !== 'deferred' || !result || !('navigation' in result)) return;

    throw new Error(
        `${source} for ${formatRouteTarget(route)} in ${formatRouteSource(route)} ` +
            `cannot return key "navigation": a page declaring navigation: 'deferred' receives its ` +
            `navigation state under that render prop. Rename the data key.`,
    );
};

export const validatePageDataResult = (route: TAnyRoute, result: unknown) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(
            `definePageRoute data for ${formatRouteTarget(route)} in ${formatRouteSource(route)} must return an object. ` +
                `If the page has no data loader, set data to null.`,
        );
    }

    validateDeferredDataKeys(route, result, 'definePageRoute data');

    for (const key of Object.keys(result)) {
        if (!reservedPageDataKeys.has(key)) continue;

        throw new Error(
            `definePageRoute data for ${formatRouteTarget(route)} in ${formatRouteSource(route)} cannot return reserved key "${key}". ` +
                `Move route behavior into definePageRoute({ path, options, data, render }).options.`,
        );
    }

    return result as TObjetDonnees;
};
