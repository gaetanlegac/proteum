const assert = require('node:assert/strict');
const test = require('node:test');

require('ts-node/register/transpile-only');

const {
    resolveHttpCacheConfig,
    resolvePublicAssetCacheControl,
} = require('../server/services/router/http/cache');

test('router cache config preserves current defaults', () => {
    const cache = resolveHttpCacheConfig();

    assert.equal(cache.html.dynamic.cacheControl, 'no-store, no-cache, must-revalidate, proxy-revalidate');
    assert.equal(cache.html.dynamic.surrogateControl, 'no-store');
    assert.equal(cache.html.static.cacheControl, 'public, max-age=0, must-revalidate');
    assert.equal(cache.html.static.surrogateControl, false);
    assert.equal(cache.publicAssets.dev, 'no-store');
    assert.equal(cache.publicAssets.versioned, 'public, max-age=31536000, immutable');
    assert.equal(cache.publicAssets.unversioned, 'public, max-age=0, must-revalidate');
    assert.equal(cache.publicAssets.etag, undefined);
    assert.equal(cache.publicAssets.lastModified, undefined);
});

test('router cache config resolves granular public asset policies', () => {
    const cache = resolveHttpCacheConfig({
        publicAssets: {
            dev: 'dev-cache',
            versioned: 'versioned-cache',
            unversioned: 'unversioned-cache',
            etag: false,
            lastModified: false,
        },
    });

    assert.equal(cache.publicAssets.etag, false);
    assert.equal(cache.publicAssets.lastModified, false);
    assert.equal(
        resolvePublicAssetCacheControl({
            res: undefined,
            filePath: '/app/public/client.abc123.js',
            profile: 'prod',
            cache: cache.publicAssets,
        }),
        'versioned-cache',
    );
    assert.equal(
        resolvePublicAssetCacheControl({
            res: { req: { originalUrl: '/public/client.js?v=123' } },
            filePath: '/app/public/client.js',
            profile: 'prod',
            cache: cache.publicAssets,
        }),
        'versioned-cache',
    );
    assert.equal(
        resolvePublicAssetCacheControl({
            res: { req: { originalUrl: '/public/client.js' } },
            filePath: '/app/public/client.js',
            profile: 'prod',
            cache: cache.publicAssets,
        }),
        'unversioned-cache',
    );
    assert.equal(
        resolvePublicAssetCacheControl({
            res: { req: { originalUrl: '/public/client.abc123.js' } },
            filePath: '/app/public/client.abc123.js',
            profile: 'dev',
            cache: cache.publicAssets,
        }),
        'dev-cache',
    );
});
