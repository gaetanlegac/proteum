import path from 'path';

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

const hashedPublicAssetPattern = /(^|[-_.])[a-f0-9]{6,}(?=(\.[^.]+)+$)/i;

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
