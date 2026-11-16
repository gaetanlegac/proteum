/*----------------------------------
- DEPENDANCES
----------------------------------*/

import hInterval from 'human-interval';

import type { TRouteOptions } from '@common/router';
import { buildPreloadLinkHeader } from './response/page/preloads';
import type { TPagePreload } from '@common/router/response/page';

/*----------------------------------
- TYPES
----------------------------------*/

export type TStaticRouteOptions = NonNullable<TRouteOptions['static']>;

/**
 * One stored page. The store stays a plain object keyed by path (`router.cache`): apps read its keys and
 * delete entries to evict them. Key order is the LRU order, least recently served first.
 */
export type TPageCacheEntry = {
    rendered: any;
    expire: number | undefined;
    options: TRouteOptions['static'];
    // The preloads of the stored document, sent again as the `Link` header of every hit.
    link?: string;
};

export type TPageCache = { [path: string]: TPageCacheEntry };

/*----------------------------------
- RULES
----------------------------------*/

/** How long a stored page is served before a request re-renders it in the background, when `refresh` is not set. */
export const defaultStaticRefreshMs = 60 * 60 * 1000;

/**
 * Paths a route with `urls: ['*']` holds when it sets no `maxEntries`. Each stored page is a full document
 * (100 to 500 KB on the website), so the default stays small; a route that serves more paths raises it.
 */
export const defaultWildcardMaxEntries = 100;

export const staticRefreshMs = (options: TRouteOptions['static']) => {
    const refresh = options?.refresh ? hInterval(options.refresh) : undefined;
    return typeof refresh === 'number' && refresh > 0 ? refresh : defaultStaticRefreshMs;
};

/** The cap of a route that holds any matched path, `undefined` for a route that lists its paths. */
export const wildcardMaxEntries = (options: TRouteOptions['static']) =>
    options?.urls.includes('*') ? options.maxEntries ?? defaultWildcardMaxEntries : undefined;

export const isPageCacheEntryStale = (entry: TPageCacheEntry, now = Date.now()) =>
    entry.expire !== undefined && entry.expire <= now;

/*----------------------------------
- STORE
----------------------------------*/

/** Marks a page as just served: it moves to the end of the key order, the last one an eviction takes. */
export const touchPageCacheEntry = (cache: TPageCache, path: string) => {
    const entry = cache[path];
    if (entry === undefined) return undefined;

    delete cache[path];
    cache[path] = entry;
    return entry;
};

/**
 * Stores a page, then evicts the least recently served pages of the same route (same `static` options)
 * beyond its cap. Returns the evicted paths.
 */
export const writePageCacheEntry = (cache: TPageCache, path: string, entry: TPageCacheEntry) => {
    delete cache[path];
    cache[path] = entry;

    const cap = wildcardMaxEntries(entry.options);
    if (cap === undefined) return [];

    const sameRoute = Object.keys(cache).filter((key) => cache[key].options === entry.options);
    const evicted = sameRoute.slice(0, Math.max(0, sameRoute.length - cap));
    for (const key of evicted) delete cache[key];

    return evicted;
};

/*----------------------------------
- LINK HEADER OF A STORED PAGE
----------------------------------*/

const decodeEntities = (value: string) =>
    value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

/**
 * The `Link` header of a stored document, read back from its `<link rel="preload">` tags. A page stored by
 * an app's own renderer arrives as HTML only, so its preloads are read from the HTML Proteum wrote
 * (server/services/router/response/page/document.tsx).
 */
export const readPreloadLinkHeader = (html: unknown) => {
    if (typeof html !== 'string') return undefined;

    const headEnd = html.indexOf('</head>');
    const head = headEnd === -1 ? html : html.slice(0, headEnd);
    const preloads: TPagePreload[] = [];

    for (const [tag] of head.matchAll(/<link rel="preload"[^>]*>/g)) {
        const attributes: Record<string, string> = {};
        for (const [, name, value] of tag.matchAll(/([a-z-]+)="([^"]*)"/g)) attributes[name] = decodeEntities(value);
        if (!attributes.href || !attributes.as) continue;

        preloads.push({
            href: attributes.href,
            as: attributes.as as TPagePreload['as'],
            type: attributes.type,
            crossorigin: attributes.crossorigin as TPagePreload['crossorigin'],
            imagesrcset: attributes.imagesrcset,
            imagesizes: attributes.imagesizes,
            fetchpriority: attributes.fetchpriority as TPagePreload['fetchpriority'],
            media: attributes.media,
        });
    }

    return buildPreloadLinkHeader(preloads) || undefined;
};
