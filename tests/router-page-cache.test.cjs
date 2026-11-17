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
let sharedRender;
try {
    ({ default: ServerRouter } = require('../server/services/router/index.ts'));
    pageCache = require('../server/services/router/pageCache.ts');
    edgeCache = require('../server/services/router/http/cache.ts');
    sharedRender = require('../server/services/router/sharedRender.ts');
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
        staticRefreshRetryAt: new Map(),
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
const listen = (handler, { before = [] } = {}) =>
    new Promise((resolve) => {
        const app = express();
        // As the HTTP server sets it (server/services/router/http/index.ts): one proxy hop is trusted.
        app.set('trust proxy', 1);
        // As in the HTTP server: the edge cache guard first, cookies and bodies parsed before the router.
        app.use(edgeCache.edgeCacheHeaderGuard);
        for (const middleware of before) app.use(middleware);
        app.use(require('cookie-parser')());
        app.use(express.json());
        app.use(require('express-fileupload')());
        // A router error answers 500 with its message instead of leaving the request hanging.
        app.use((req, res) => Promise.resolve(handler(req, res)).catch((error) => res.status(500).send(String(error && error.stack))));
        const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
        servers.push(server);
    });

/** Serves the router as the HTTP server does; the router's own host is the test server's. */
const serve = async (router, options) => {
    const origin = await listen((req, res) => router.middleware(req, res), options);
    router.config.currentDomain = origin;
    router.http = { config: { port: Number(new URL(origin).port) } };
    return origin;
};

/** Any method, headers and body, on its own connection (so a socket address set by a test stays with one request). */
const send = (origin, requestPath, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
        const { hostname, port } = new URL(origin);
        // The raw path, so a bare `?` stays; the length, as Node sends no body on a GET without it.
        const lengthHeader = body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) };
        const options = { hostname, port, path: requestPath, method, agent: false, headers: { Accept: 'text/html', ...lengthHeader, ...headers } };
        const req = http.request(options, (res) => {
            let text = '';
            res.on('data', (chunk) => (text += chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
        });
        req.on('error', reject);
        req.end(body);
    });

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

test('an answer that sets a cookie is refused at the edge, sent private, no-store and logged', async () => {
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

        assert.equal(response.headers['cache-control'], 'private, no-store');
        assert.equal(response.headers['surrogate-control'], 'no-store');
        assert.match(response.headers['set-cookie'][0], /^visitorId=v1/);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Not cacheable at the edge: \/pricing sets the cookie\(s\) visitorId/);
    } finally {
        console.warn = consoleWarn;
    }
});

/** Runs a request against an edge-cached route whose cookie arrives the way `before` writes it. */
const edgeAnswerWithLateCookie = async (before) => {
    const router = createRouter({
        routes: [edgeRoute],
        answer: () => ({ statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html' }, data: html('pricing') }),
    });
    const consoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const response = await send(await serve(router, { before: [before] }), '/pricing');
        return { response, warnings };
    } finally {
        console.warn = consoleWarn;
    }
};

test('a cookie a headers listener writes through the prototype setHeader still turns the answer private', async () => {
    const onHeaders = require('on-headers');
    // As the `cookies` package does: a listener registered before the router, writing through the prototype.
    const { response, warnings } = await edgeAnswerWithLateCookie((req, res, next) => {
        onHeaders(res, function () {
            http.OutgoingMessage.prototype.setHeader.call(this, 'Set-Cookie', 'session=member-1');
        });
        next();
    });

    assert.equal(response.headers['set-cookie'][0], 'session=member-1');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['surrogate-control'], 'no-store');
    assert.match(warnings.join('\n'), /Not cacheable at the edge: \/pricing sets a cookie as its headers are written/);
});

test('a cookie written through a setHeader reference taken earlier, or given to writeHead, still turns the answer private', async () => {
    const onHeaders = require('on-headers');
    const captured = await edgeAnswerWithLateCookie((req, res, next) => {
        const setHeader = res.setHeader;
        onHeaders(res, function () {
            setHeader.call(this, 'Set-Cookie', 'sid=s1');
        });
        next();
    });
    assert.equal(captured.response.headers['set-cookie'][0], 'sid=s1');
    assert.equal(captured.response.headers['cache-control'], 'private, no-store');

    const viaWriteHead = await edgeAnswerWithLateCookie((req, res, next) => {
        // A layer that hands its cookie to writeHead itself, outside setHeader.
        const writeHead = res.writeHead;
        res.writeHead = function (statusCode, ...rest) {
            return writeHead.call(this, statusCode, { 'Set-Cookie': 'late=1', 'Cache-Control': 'public, max-age=600' });
        };
        next();
    });
    assert.equal(viaWriteHead.response.headers['set-cookie'][0], 'late=1');
    assert.equal(viaWriteHead.response.headers['cache-control'], 'private, no-store');
});

test('without a cookie, the guard leaves the edge policy as it is', async () => {
    const { response, warnings } = await edgeAnswerWithLateCookie((req, res, next) => next());

    assert.equal(response.headers['cache-control'], 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    assert.deepEqual(warnings, []);
});

test('an answer with its own Cache-Control, or for a signed-in visitor, keeps its policy', async () => {
    const own = createRouter({
        routes: [edgeRoute],
        answer: () => ({ statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, max-age=60' }, data: html('own') }),
    });
    assert.equal((await get(await serve(own), '/pricing')).headers['cache-control'], 'private, max-age=60');

    // In lower case, or set on the Express response by the controller: still the answer's own.
    const lowerCase = createRouter({
        routes: [edgeRoute],
        answer: () => ({ statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html', 'cache-control': 'no-store' }, data: html('own') }),
    });
    assert.equal((await get(await serve(lowerCase), '/pricing')).headers['cache-control'], 'no-store');
    const onResponse = createRouter({
        routes: [edgeRoute],
        answer: (request) => {
            request.res.setHeader('Cache-Control', 'private, max-age=30');
            return { statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html' }, data: html('own') };
        },
    });
    assert.equal((await get(await serve(onResponse), '/pricing')).headers['cache-control'], 'private, max-age=30');

    const member = createRouter({
        routes: [edgeRoute],
        answer: (request) => {
            request.user = { email: 'member@example.com' };
            return { statusCode: 200, route: edgeRoute, headers: { 'Content-Type': 'text/html' }, data: html('member') };
        },
    });
    assert.equal((await get(await serve(member), '/pricing')).headers['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
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

    for (const maxEntries of [0, -1, 1.5]) {
        const capped = createRouter({ routes: [pageRoute('/capped', { static: { urls: ['*'], maxEntries } })], answer: () => ({}) });
        capped.errors = {};
        capped.config.debug = false;
        assert.throws(() => capped.refreshRouteRegistration(), /Route \/capped: static\.maxEntries must be a positive integer/);
    }
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

test('a stored page answered with a cookie is refused at the edge too, not left public', async () => {
    const router = createRouter({
        routes: [staticRoute],
        answer: (request) => {
            request.res.cookie('udVisitorId', 'v1');
            return { statusCode: 200, headers: {} };
        },
    });
    pageCache.writePageCacheEntry(router.cache, '/use-cases/e', {
        rendered: html('stored e'),
        options: staticRoute.options.static,
        expire: Date.now() + 60_000,
    });
    const consoleWarn = console.warn;
    console.warn = () => undefined;
    try {
        const response = await get(await serve(router), '/use-cases/e');
        assert.equal(response.body, html('stored e'));
        assert.equal(response.headers['cache-control'], 'private, no-store');
    } finally {
        console.warn = consoleWarn;
    }
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

        // After a failure, hits keep the stored copy for a while without starting another render.
        await get(origin, '/use-cases/b');
        assert.equal(renders, 1);
        assert.ok(router.staticRefreshRetryAt.get('/use-cases/b') > Date.now() + 4 * 60_000);
        // Once the delay is over, the next stale hit tries again.
        router.staticRefreshRetryAt.set('/use-cases/b', Date.now() - 1);
        await get(origin, '/use-cases/b');
        assert.equal(renders, 2);
    } finally {
        console.error = consoleError;
    }
});

/*----------------------------------
- PAGE CACHE: WRITES
----------------------------------*/

const runResolvedRoute = async (router, route, response, request = { method: 'GET', req: { query: {} } }) => {
    request = { path: response.path, id: 'request1', ...request };
    const fullResponse = {
        request,
        wasProvided: true,
        runController: async () => undefined,
        ...response,
    };
    fullResponse.request = request;
    await router.resolvedRoute(route, fullResponse, Date.now());
};

test('stale hits start at most four background renders at once, and the sweep shares their in-flight set', async () => {
    const router = createRouter({ routes: [staticRoute], answer: () => ({ statusCode: 200, headers: {} }) });
    const pending = [];
    router.renderStatic = (url) => new Promise((resolve) => pending.push({ url, resolve }));
    for (let index = 0; index < 10; index++)
        pageCache.writePageCacheEntry(router.cache, `/use-cases/s${index}`, {
            rendered: html(`s${index}`),
            options: { refresh: '5 minutes', urls: [`/use-cases/s${index}`] },
            expire: Date.now() - 1,
        });
    const origin = await serve(router);

    await Promise.all(Array.from({ length: 10 }, (_, index) => get(origin, `/use-cases/s${index}`)));
    assert.equal(pending.length, 4);

    // The hourly sweep renders every other stale page, never one already rendering.
    router.refreshStaticPages();
    assert.equal(pending.length, 10);
    assert.equal(new Set(pending.map(({ url }) => url)).size, 10);
    pending.forEach(({ resolve }) => resolve());
});

/**
 * A router whose route stores like a page: the middleware builds the real ServerRequest, then the router's
 * own write rule (`resolvedRoute`) decides. `writes` records what it would store.
 */
const createStoringRouter = (route, { status = 200 } = {}) => {
    const writes = [];
    const router = createRouter({
        routes: [route],
        answer: async (request, isStatic) => {
            if (request.headers['x-test-signed-in']) request.user = { email: 'member@example.com' };
            const response = {
                request,
                statusCode: status,
                headers: { 'Content-Type': 'text/html' },
                data: html(`page ${request.path}${isStatic ? ' (static)' : ''}`),
                wasProvided: true,
                route,
                runController: async () => undefined,
            };
            if (!isStatic) await router.resolvedRoute(route, response, Date.now());
            return response;
        },
    });
    router.renderStatic = async (url, options, rendered) => writes.push({ url, rendered });
    return { router, writes };
};

const quietly = async (run) => {
    const consoleLog = console.log;
    console.log = () => undefined;
    try {
        return await run();
    } finally {
        console.log = consoleLog;
    }
};

test('a rendered page is stored only when it answered 200, and only from a GET', () =>
    quietly(async () => {
        for (const status of [404, 503]) {
            const { router, writes } = createStoringRouter(staticRoute, { status });
            await send(await serve(router), '/use-cases/missing');
            assert.deepEqual(writes, [], String(status));
        }

        const { router, writes } = createStoringRouter(staticRoute);
        const origin = await serve(router);
        await send(origin, '/use-cases/c');
        assert.deepEqual(writes.map(({ url }) => url), ['/use-cases/c']);

        // Any other method, even one the route answers.
        router.routes[0] = { ...staticRoute, method: '*' };
        await send(origin, '/use-cases/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.deepEqual(writes.map(({ url }) => url), ['/use-cases/c']);
    }));

test('a render carrying anything of its own request is never stored', () =>
    quietly(async () => {
        const { router, writes } = createStoringRouter(staticRoute);
        const origin = await serve(router);
        const own = new URL(origin).host;

        // A JSON body on a GET (it lands in window.ssr.request.data).
        await send(origin, '/use-cases/body', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo: 'https://evil.example/' }) });
        // (A file cannot reach a GET's page data: express-fileupload parses only POST, PUT and PATCH.)
        // Any query string, `?=x` and a bare `?` included.
        for (const query of ['?a=1', '?=INJECTED', '?']) await send(origin, `/use-cases/query${encodeURIComponent(query)}${query}`);
        // A host or protocol that is not the app's own (it goes into the canonical).
        await send(origin, '/use-cases/host', { headers: { Host: 'evil.example' } });
        await send(origin, '/use-cases/forwarded-host', { headers: { 'X-Forwarded-Host': 'evil.example' } });
        // A forged Host behind an X-Forwarded-Host that names the app: the raw Host still goes into the canonical.
        await send(origin, '/use-cases/host-behind-forward', { headers: { Host: 'evil.example', 'X-Forwarded-Host': own } });
        await send(origin, '/use-cases/proto', { headers: { 'X-Forwarded-Proto': 'https' } });
        // A signed-in visitor.
        await send(origin, '/use-cases/member', { headers: { 'x-test-signed-in': '1' } });
        assert.deepEqual(writes, []);

        // The same path, clean, on the app's own host: stored.
        await send(origin, '/use-cases/body', { headers: { Host: own } });
        assert.deepEqual(writes.map(({ url }) => url), ['/use-cases/body']);
    }));

test('bypasscache renders past the stored copy only on a loopback connection', () =>
    quietly(async () => {
        const listed = pageRoute('/legal', { static: { refresh: '1 day', urls: ['/legal'] } });
        const { router, writes } = createStoringRouter(listed);
        pageCache.writePageCacheEntry(router.cache, '/legal', { rendered: html('stored legal'), options: listed.options.static, expire: Date.now() + 60_000 });
        // The address a proxy or another machine connects from.
        const remote = (req, res, next) => {
            if (req.headers['x-test-remote']) Object.defineProperty(req.socket, 'remoteAddress', { value: '203.0.113.9', configurable: true });
            next();
        };
        const origin = await serve(router, { before: [remote] });

        const fromOutside = await send(origin, '/legal', {
            // X-Forwarded-For says loopback: only the socket counts.
            headers: { bypasscache: '1', 'x-test-remote': '1', 'X-Forwarded-For': '127.0.0.1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ injected: 'by-bypasscache' }),
        });
        assert.equal(fromOutside.body, html('stored legal'));
        assert.deepEqual(writes, []);

        const fromLoopback = await send(origin, '/legal', { headers: { bypasscache: '1' } });
        assert.equal(fromLoopback.body, html('page /legal'));
        assert.deepEqual(writes.map(({ url }) => url), ['/legal']);

        assert.equal(sharedRender.isLoopbackAddress('::ffff:127.0.0.1'), true);
        assert.equal(sharedRender.isLoopbackAddress('::1'), true);
        assert.equal(sharedRender.isLoopbackAddress('10.0.0.1'), false);
        assert.equal(sharedRender.isLoopbackAddress(undefined), false);
    }));

test('renderStatic renders over loopback as the public host, stores a 200, keeps the copy on a failure', async () => {
    let status = 200;
    const seen = [];
    const origin = await listen((req, res) => {
        seen.push({ path: req.path, host: req.headers.host, forwardedHost: req.headers['x-forwarded-host'], proto: req.headers['x-forwarded-proto'], bypass: req.headers.bypasscache, remote: req.socket.remoteAddress });
        if (status === 302) return res.redirect(302, '/sign-in');
        if (req.path === '/sign-in') return res.send(html('SIGN-IN PAGE'));
        res.status(status).send(html(`render ${status}`, preloadHead));
    });
    const router = createRouter({ routes: [staticRoute], answer: () => ({}) });
    router.config.currentDomain = 'https://example.com';
    router.http = { config: { port: Number(new URL(origin).port) } };

    await router.renderStatic('/use-cases/d', staticRoute.options.static);
    const stored = router.cache['/use-cases/d'];
    assert.equal(stored.rendered, html('render 200', preloadHead));
    assert.equal(stored.link, preloadLink);
    // `refresh: '5 minutes'`
    assert.ok(Math.abs(stored.expire - (Date.now() + 5 * 60_000)) < 2_000);
    assert.deepEqual(seen[0], { path: '/use-cases/d', host: 'example.com', forwardedHost: 'example.com', proto: 'https', bypass: '1', remote: '127.0.0.1' });

    status = 503;
    await assert.rejects(router.renderStatic('/use-cases/d', staticRoute.options.static), /Static render returned 503/);
    assert.equal(router.cache['/use-cases/d'], stored);

    // A redirect is not followed: its target is not stored under this path, and the copy stays.
    status = 302;
    await assert.rejects(router.renderStatic('/use-cases/d', staticRoute.options.static), /Static render returned 302/);
    assert.equal(router.cache['/use-cases/d'], stored);
    assert.deepEqual(seen.map(({ path }) => path), ['/use-cases/d', '/use-cases/d', '/use-cases/d']);

    // A page that is gone stops being served.
    status = 404;
    await assert.rejects(router.renderStatic('/use-cases/d', staticRoute.options.static), /Static render returned 404/);
    assert.equal(router.cache['/use-cases/d'], undefined);
});

test('a hit makes its page the most recently served: with a cap of 2, serving A then storing C evicts B', () =>
    quietly(async () => {
        const capped = pageRoute('/capped/:name', { static: { refresh: '1 hour', urls: ['*'], maxEntries: 2 } });
        const router = createRouter({ routes: [capped], answer: () => ({ statusCode: 200, headers: {} }) });
        const write = (url) => pageCache.writePageCacheEntry(router.cache, url, { rendered: html(url), options: capped.options.static, expire: Date.now() + 60_000 });
        write('/capped/a');
        write('/capped/b');
        const origin = await serve(router);

        assert.equal((await send(origin, '/capped/a')).body, html('/capped/a'));
        assert.deepEqual(write('/capped/c'), ['/capped/b']);
        assert.deepEqual(Object.keys(router.cache), ['/capped/a', '/capped/c']);
    }));

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
    // A `>` inside a quoted value does not end the tag.
    assert.equal(
        pageCache.readPreloadLinkHeader(html('x', '<link rel="preload" href="/h.avif" as="image" imagesizes="(width >= 768px) 50vw, 100vw" fetchpriority="high"/>')),
        '</h.avif>; rel=preload; as=image; imagesizes="(width >= 768px) 50vw, 100vw"; fetchpriority=high',
    );
    // Preloads in the body are not the document's.
    assert.equal(pageCache.readPreloadLinkHeader('<html><head></head><body><link rel="preload" href="/b" as="image"/></body></html>'), undefined);
    assert.equal(pageCache.readPreloadLinkHeader(undefined), undefined);
});
