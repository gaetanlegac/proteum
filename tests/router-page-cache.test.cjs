const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.join(__dirname, '..');
require('module-alias').addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
    react: path.join(coreRoot, 'node_modules/preact/compat'),
});
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');
require.extensions['.less'] = () => {};

globalThis.__DEV__ = false;
globalThis.APP_OUTPUT_DIR = 'bin';
globalThis.BUILD_ID = 'build1';

const express = require('express');

// The app container reads the app's config at import; the router only needs its root path here.
const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-page-cache-'));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@server/app/container') return { __esModule: true, default: { path: { root: appRoot } } };
    // App modules (`@/client/context`, generated files): the router reaches them only while rendering.
    if (request.startsWith('@/') || request.startsWith('@generated/')) {
        const stub = () => ({});
        return Object.assign(stub, { __esModule: true, default: stub });
    }
    return originalLoad.call(this, request, parent, isMain);
};
let ServerRouter;
let pageCache;
let edgeCache;
try {
    ({ default: ServerRouter } = require('../server/services/router/index.ts'));
    pageCache = require('../server/services/router/pageCache.ts');
    edgeCache = require('../server/services/router/http/cache.ts');
} finally {
    Module._load = originalLoad;
}

/*----------------------------------
- HARNESS
----------------------------------*/

const html = (title, head = '') => `<!doctype html><html><head>${head}<title>${title}</title></head><body>${title}</body></html>`;
const preloadHead =
    '<link rel="preload" href="/public/fonts/a.1a2b3c4d.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>' +
    '<link rel="preload" href="/public/hero.avif" as="image" imagesrcset="/public/hero.avif 1x, /public/hero-2x.avif 2x" fetchpriority="high"/>';
const preloadLink =
    '</public/fonts/a.1a2b3c4d.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous, ' +
    '</public/hero.avif>; rel=preload; as=image; imagesrcset="/public/hero.avif 1x, /public/hero-2x.avif 2x"; fetchpriority=high';

const pageRoute = (routePath, options = {}) => ({
    method: 'GET',
    path: routePath,
    regex: new RegExp(`^${routePath.replace(/:[a-z]+/g, '[^/]+')}$`),
    keys: [],
    options: { accept: 'html', priority: 0, ...options },
});

/**
 * A ServerRouter with only what the request path reads. `answer(request)` plays the route: it returns
 * the response `resolve` would, and may set cookies on `request.res` the way a hook or controller does.
 */
const createRouter = ({ routes = [], answer }) => {
    const router = Object.create(ServerRouter.prototype);
    const noop = () => undefined;
    Object.assign(router, {
        cache: {},
        staticRefreshesInFlight: new Set(),
        routes,
        config: { http: {} },
        app: {
            env: { profile: 'prod', name: 'server' },
            container: {
                Trace: {
                    startRequest: () => ({}),
                    record: noop,
                    isDevTraceEnabled: () => false,
                    setRequestUser: noop,
                    finishRequest: noop,
                    releaseRequest: noop,
                    shouldCapture: () => false,
                },
            },
            reportError: async () => undefined,
        },
        runHook: async () => undefined,
        // A class field, not on the prototype.
        printTakenTime: noop,
        resolve: async (request, isStatic) => {
            const response = await answer(request, isStatic);
            return { headers: {}, data: undefined, ...response };
        },
    });
    return router;
};

const servers = [];
const listen = (handler) =>
    new Promise((resolve) => {
        const app = express();
        // As in the HTTP server: cookies are parsed before the router.
        app.use(require('cookie-parser')());
        // A router error answers 500 with its message instead of leaving the request hanging.
        app.use((req, res) => Promise.resolve(handler(req, res)).catch((error) => res.status(500).send(String(error && error.stack))));
        const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
        servers.push(server);
    });

const serve = (router) => listen((req, res) => router.middleware(req, res));

const get = (origin, requestPath, headers = {}) =>
    new Promise((resolve, reject) => {
        http.get(`${origin}${requestPath}`, { headers: { Accept: 'text/html', ...headers } }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on('error', reject);
    });

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(appRoot, { recursive: true, force: true });
});

/*----------------------------------
- EDGE CACHE POLICY
----------------------------------*/

const edgeRoute = pageRoute('/pricing', { edgeCache: { maxAge: '10 minutes', staleWhileRevalidate: 86400 } });

test('a 200 of an edgeCache route is cacheable at the edge, and nothing says otherwise', async () => {
    const router = createRouter({
        routes: [edgeRoute],
        answer: (request) => {
            request.res.setHeader('Expires', '0'); // as every page render does
            return { statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html' }, data: html('pricing') };
        },
    });
    const response = await get(await serve(router), '/pricing');

    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    assert.equal(response.headers['surrogate-control'], undefined);
    assert.equal(response.headers.expires, undefined);
    assert.equal(response.headers['set-cookie'], undefined);
});

test('an answer that sets a cookie is refused at the edge, keeps the HTML default and is logged', async () => {
    const router = createRouter({
        routes: [edgeRoute],
        answer: (request) => {
            request.res.cookie('visitorId', 'v1');
            return { statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html' }, data: html('pricing') };
        },
    });
    const warnings = [];
    const consoleWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const response = await get(await serve(router), '/pricing');

        assert.equal(response.headers['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
        assert.equal(response.headers['surrogate-control'], 'no-store');
        assert.match(response.headers['set-cookie'][0], /^visitorId=v1/);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Not cacheable at the edge: \/pricing sets the cookie\(s\) visitorId/);
    } finally {
        console.warn = consoleWarn;
    }
});

test('a 404 or 503 of an edgeCache route is never cacheable at the edge', async () => {
    for (const statusCode of [404, 503]) {
        const router = createRouter({
            routes: [edgeRoute],
            answer: () => ({ statusCode, route: edgeRoute, headers: { 'Content-Type': 'text/html' }, data: html('error') }),
        });
        const response = await get(await serve(router), '/pricing');

        assert.equal(response.status, statusCode);
        assert.equal(response.headers['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate', String(statusCode));
    }
});

test('a route without edgeCache keeps the HTML default', async () => {
    const route = pageRoute('/account');
    const router = createRouter({
        routes: [route],
        answer: () => ({ statusCode: 200, route, headers: { 'Content-Type': 'text/html' }, data: html('account') }),
    });
    const response = await get(await serve(router), '/account');

    assert.equal(response.headers['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
});

test('edgeCache values are seconds or durations; anything else fails the registration', () => {
    assert.equal(edgeCache.buildEdgeCacheControl({ maxAge: 60 }), 'public, max-age=0, s-maxage=60');
    assert.equal(
        edgeCache.buildEdgeCacheControl({ maxAge: '1 hour', staleWhileRevalidate: '1 day' }),
        'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    );
    assert.throws(() => edgeCache.buildEdgeCacheControl({ maxAge: 'soon' }), /edgeCache\.maxAge/);
    assert.throws(() => edgeCache.buildEdgeCacheControl({ maxAge: -1 }), /edgeCache\.maxAge/);

    const router = createRouter({ routes: [pageRoute('/bad', { edgeCache: { maxAge: 'soon' } })], answer: () => ({}) });
    router.errors = {};
    router.config.debug = false;
    assert.throws(() => router.refreshRouteRegistration(), /Route \/bad: edgeCache\.maxAge/);
});

/*----------------------------------
- PAGE CACHE: HITS
----------------------------------*/

const staticRoute = pageRoute('/use-cases/:slug', {
    static: { refresh: '5 minutes', urls: ['*'] },
    edgeCache: { maxAge: 300 },
});

test('a stored page is served at once with its preloads as Link and the route edge policy', async () => {
    let resolvedStatic;
    const router = createRouter({
        routes: [staticRoute],
        answer: (request, isStatic) => {
            resolvedStatic = isStatic;
            return { statusCode: 200, headers: {} };
        },
    });
    router.renderStatic = async () => assert.fail('a fresh page is not re-rendered');
    pageCache.writePageCacheEntry(router.cache, '/use-cases/a', {
        rendered: html('stored a', preloadHead),
        options: staticRoute.options.static,
        expire: Date.now() + 60_000,
        link: preloadLink,
    });
    const response = await get(await serve(router), '/use-cases/a');

    assert.equal(resolvedStatic, true);
    assert.equal(response.body, html('stored a', preloadHead));
    assert.equal(response.headers.link, preloadLink);
    assert.equal(response.headers['cache-control'], 'public, max-age=0, s-maxage=300');
});

test('a stale page is served at once and re-rendered once in the background, a failed render keeps it', async () => {
    const router = createRouter({ routes: [staticRoute], answer: () => ({ statusCode: 200, headers: {} }) });
    let renders = 0;
    let finishRender;
    router.renderStatic = (url, options) => {
        renders++;
        assert.equal(url, '/use-cases/b');
        assert.equal(options, staticRoute.options.static);
        return new Promise((_resolve, reject) => (finishRender = () => reject(new Error('Product stalled'))));
    };
    pageCache.writePageCacheEntry(router.cache, '/use-cases/b', {
        rendered: html('stored b'),
        options: staticRoute.options.static,
        expire: Date.now() - 1,
    });
    const origin = await serve(router);

    const consoleError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const answers = await Promise.all([get(origin, '/use-cases/b'), get(origin, '/use-cases/b'), get(origin, '/use-cases/b')]);
        for (const answer of answers) assert.equal(answer.body, html('stored b'));
        assert.equal(renders, 1, 'one background render for a burst of stale hits');

        finishRender();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(router.cache['/use-cases/b'].rendered, html('stored b'));
        assert.match(errors.join('\n'), /Static refresh failed, the stored copy stays \/use-cases\/b/);

        // Once settled, the next stale hit may try again.
        await get(origin, '/use-cases/b');
        assert.equal(renders, 2);
    } finally {
        console.error = consoleError;
    }
});

/*----------------------------------
- PAGE CACHE: WRITES
----------------------------------*/

const runResolvedRoute = async (router, route, response) => {
    const request = { path: response.path, id: 'request1' };
    const fullResponse = {
        request,
        wasProvided: true,
        runController: async () => undefined,
        ...response,
    };
    fullResponse.request = request;
    await router.resolvedRoute(route, fullResponse, Date.now());
};

test('a rendered page is stored only when it answered 200', async () => {
    const router = createRouter({ routes: [staticRoute], answer: () => ({}) });
    const written = [];
    router.renderStatic = async (url, options, rendered) => written.push({ url, options, rendered });
    const consoleLog = console.log;
    console.log = () => undefined;
    try {
        await runResolvedRoute(router, staticRoute, { path: '/use-cases/missing', statusCode: 404, data: html('not found') });
        await runResolvedRoute(router, staticRoute, { path: '/use-cases/down', statusCode: 503, data: html('down') });
        assert.deepEqual(written, []);

        await runResolvedRoute(router, staticRoute, { path: '/use-cases/c', statusCode: 200, data: html('c') });
        assert.deepEqual(written, [{ url: '/use-cases/c', options: staticRoute.options.static, rendered: html('c') }]);
    } finally {
        console.log = consoleLog;
    }
});

test('renderStatic stores a 200 with its preloads, and keeps the stored copy when the render fails', async () => {
    let status = 200;
    const origin = await listen((req, res) => {
        assert.equal(req.headers.bypasscache, '1');
        res.status(status).send(html(`render ${status}`, preloadHead));
    });
    const router = createRouter({ routes: [staticRoute], answer: () => ({}) });
    router.url = (url) => origin + url;

    await router.renderStatic('/use-cases/d', staticRoute.options.static);
    const stored = router.cache['/use-cases/d'];
    assert.equal(stored.rendered, html('render 200', preloadHead));
    assert.equal(stored.link, preloadLink);
    // `refresh: '5 minutes'`
    assert.ok(Math.abs(stored.expire - (Date.now() + 5 * 60_000)) < 2_000);

    status = 503;
    await assert.rejects(router.renderStatic('/use-cases/d', staticRoute.options.static), /Static render returned 503/);
    assert.equal(router.cache['/use-cases/d'], stored);
});

test('a route that holds any path keeps its maxEntries least recently served pages', () => {
    const options = { urls: ['*'], maxEntries: 2 };
    const otherRoute = { urls: ['/listed'] };
    const cache = {};
    const write = (url, routeOptions = options) =>
        pageCache.writePageCacheEntry(cache, url, { rendered: url, options: routeOptions, expire: undefined });

    write('/listed', otherRoute);
    assert.deepEqual(write('/a'), []);
    assert.deepEqual(write('/b'), []);
    // `/a` was served last: `/b` is the least recently served of the route.
    pageCache.touchPageCacheEntry(cache, '/a');
    assert.deepEqual(write('/c'), ['/b']);
    assert.deepEqual(Object.keys(cache), ['/listed', '/a', '/c']);
    // Re-writing a stored path never evicts.
    assert.deepEqual(write('/a'), []);
    // A listed-paths route is never capped, and the default cap applies to a wildcard without maxEntries.
    assert.equal(pageCache.wildcardMaxEntries(otherRoute), undefined);
    assert.equal(pageCache.wildcardMaxEntries({ urls: ['*'] }), pageCache.defaultWildcardMaxEntries);
});

test('a page without refresh is re-rendered after an hour, not after 3.6 seconds', () => {
    assert.equal(pageCache.staticRefreshMs({ urls: ['/x'] }), 60 * 60 * 1000);
    assert.equal(pageCache.staticRefreshMs({ urls: ['/x'], refresh: '1 day' }), 24 * 60 * 60 * 1000);
    assert.equal(pageCache.isPageCacheEntryStale({ expire: Date.now() - 1 }), true);
    assert.equal(pageCache.isPageCacheEntryStale({ expire: undefined }), false);
});

test('the Link header of a stored page is read back from the preloads its document wrote', () => {
    assert.equal(pageCache.readPreloadLinkHeader(html('x', preloadHead)), preloadLink);
    assert.equal(
        pageCache.readPreloadLinkHeader(html('x', '<link rel="preload" href="/a?x=1&amp;y=2" as="image" imagesizes="&quot;q&quot;"/>')),
        '</a?x=1&y=2>; rel=preload; as=image; imagesizes="\\"q\\""',
    );
    // Preloads in the body are not the document's.
    assert.equal(pageCache.readPreloadLinkHeader('<html><head></head><body><link rel="preload" href="/b" as="image"/></body></html>'), undefined);
    assert.equal(pageCache.readPreloadLinkHeader(undefined), undefined);
});
