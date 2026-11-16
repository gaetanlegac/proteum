import path from 'path';
import hInterval from 'human-interval';

import type { TRouteOptions } from '@common/router';

export type THttpCacheHeadersConfig = {
    cacheControl?: string;
    surrogateControl?: string | false;
};

export type TPublicAssetsCacheConfig = {
    dev?: string;
    versioned?: string;
    unversioned?: string;
    etag?: boolean;
    lastModified?: boolean;
};

export type THttpCacheConfig = {
    html?: {
        dynamic?: THttpCacheHeadersConfig;
        static?: THttpCacheHeadersConfig;
    };
    publicAssets?: TPublicAssetsCacheConfig;
};

export type TResolvedHttpCacheHeadersConfig = {
    cacheControl: string;
    surrogateControl: string | false;
};

export type TResolvedPublicAssetsCacheConfig = {
    dev: string;
    versioned: string;
    unversioned: string;
    etag?: boolean;
    lastModified?: boolean;
};

export type TResolvedHttpCacheConfig = {
    html: {
        dynamic: TResolvedHttpCacheHeadersConfig;
        static: TResolvedHttpCacheHeadersConfig;
    };
    publicAssets: TResolvedPublicAssetsCacheConfig;
};

export const defaultHttpCacheConfig = {
    html: {
        dynamic: {
            cacheControl: 'no-store, no-cache, must-revalidate, proxy-revalidate',
            surrogateControl: 'no-store',
        },
        static: {
            cacheControl: 'public, max-age=0, must-revalidate',
            surrogateControl: false,
        },
    },
    publicAssets: {
        dev: 'no-store',
        versioned: 'public, max-age=31536000, immutable',
        unversioned: 'public, max-age=0, must-revalidate',
    },
} satisfies TResolvedHttpCacheConfig;

type TPublicAssetRequest = {
    originalUrl?: string;
    url?: string;
};

type TPublicAssetResponse = {
    req?: TPublicAssetRequest;
};

// `name.<hex hash>.ext`: async chunks, and since 2.6.1 the production entry files, CSS and fonts too
// (cli/compiler/client/outputNames.ts), so every file the HTML names is served immutable.
// `<hex hash>-<width>.ext` is responsive-loader's default name for each image size: hashed as well.
const hashedPublicAssetPattern = /(^|[-_.])[a-f0-9]{6,}(-\d+)?(?=(\.[^.]+)+$)/i;

export const resolveHttpCacheConfig = (config?: THttpCacheConfig): TResolvedHttpCacheConfig => ({
    html: {
        dynamic: {
            ...defaultHttpCacheConfig.html.dynamic,
            ...(config?.html?.dynamic || {}),
        },
        static: {
            ...defaultHttpCacheConfig.html.static,
            ...(config?.html?.static || {}),
        },
    },
    publicAssets: {
        ...defaultHttpCacheConfig.publicAssets,
        ...(config?.publicAssets || {}),
    },
});

export const isVersionedPublicAssetRequest = (
    res: undefined | TPublicAssetResponse,
    filePath: string,
) => {
    const requestUrl = res?.req?.originalUrl || res?.req?.url || '';
    const searchParams = new URL(requestUrl, 'http://proteum.local').searchParams;
    if (searchParams.has('v')) return true;

    return hashedPublicAssetPattern.test(path.basename(filePath));
};

export const resolvePublicAssetCacheControl = ({
    res,
    filePath,
    profile,
    cache,
}: {
    res: undefined | TPublicAssetResponse;
    filePath: string;
    profile: string;
    cache: TResolvedPublicAssetsCacheConfig;
}) => {
    if (profile === 'dev') return cache.dev;

    return isVersionedPublicAssetRequest(res, filePath) ? cache.versioned : cache.unversioned;
};

/*----------------------------------
- EDGE CACHE OF HTML ANSWERS
----------------------------------*/

export type TRouteEdgeCacheConfig = NonNullable<TRouteOptions['edgeCache']>;

/** Whole seconds from a number of seconds or a duration such as '10 minutes'; throws on anything else. */
const toSeconds = (value: number | string, label: string) => {
    const seconds = typeof value === 'number' ? value : (hInterval(value) ?? NaN) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0)
        throw new Error(`edgeCache.${label} must be a number of seconds or a duration such as '1 hour'. Received ${JSON.stringify(value)}.`);

    return Math.round(seconds);
};

/** `public, max-age=0, s-maxage=<n>[, stale-while-revalidate=<m>]`: browsers revalidate, the CDN keeps the page. */
export const buildEdgeCacheControl = (config: TRouteEdgeCacheConfig) =>
    [
        'public',
        'max-age=0',
        `s-maxage=${toSeconds(config.maxAge, 'maxAge')}`,
        ...(config.staleWhileRevalidate === undefined
            ? []
            : [`stale-while-revalidate=${toSeconds(config.staleWhileRevalidate, 'staleWhileRevalidate')}`]),
    ].join(', ');

type TEdgeCacheResponse = {
    getHeader(name: string): unknown;
    setHeader(name: string, value: string): unknown;
    removeHeader(name: string): unknown;
};

export type TEdgeCacheDecision = 'applied' | 'refused-cookie' | 'not-cacheable';

/**
 * Gives a route's answer its CDN policy, at send time, when every header is known. Only a 200 answer
 * to GET or HEAD qualifies. An answer that sets a cookie is refused: a CDN would store the cookie with
 * the page and hand one visitor's cookie to the next. It keeps the default HTML policy (`no-store`).
 */
export const applyEdgeCachePolicy = (
    res: TEdgeCacheResponse,
    config: TRouteEdgeCacheConfig | undefined,
    { method, statusCode }: { method: string; statusCode: number },
): TEdgeCacheDecision => {
    if (!config || statusCode !== 200 || (method !== 'GET' && method !== 'HEAD')) return 'not-cacheable';

    const setCookie = res.getHeader('Set-Cookie');
    if (setCookie !== undefined && !(Array.isArray(setCookie) && setCookie.length === 0)) return 'refused-cookie';

    res.setHeader('Cache-Control', buildEdgeCacheControl(config));
    res.removeHeader('Surrogate-Control');
    // `Expires: 0` (set by every page render) would read as "already stale" to an HTTP/1.0 cache.
    res.removeHeader('Expires');
    return 'applied';
};

/** The names of the cookies an answer sets, for the log line of a refused edge cache. */
export const setCookieNames = (setCookie: unknown) =>
    (Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie]).map((cookie) =>
        String(cookie).split('=')[0].trim(),
    );
