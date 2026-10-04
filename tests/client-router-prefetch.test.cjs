const assert = require('node:assert/strict');

const { ReactClientContext, createRouter, restore } = require('./clientRouterHarness.cjs');
const { h, options } = require('preact');
const { renderToString } = require('preact-render-to-string');
const { Link } = require('../client/services/router/components/Link.tsx');

/*----------------------------------
- HARNESS
----------------------------------*/

const flush = () => new Promise((resolve) => setImmediate(resolve));

// An unresolved route as registerRoutes() builds it from the SSR route list
const createUnresolvedRoute = (index, routePath, load) => ({
    index,
    chunk: `chunk${routePath.replace(/\W/g, '_')}`,
    regex: new RegExp(`^${routePath}$`),
    keys: [],
    load,
});

const createModule = (routePath) => ({
    __register: () => ({ method: 'GET', path: routePath, options: {}, controller: () => null }),
});

const createRouterWithRoutes = (paths, { config, failing = [] } = {}) => {
    const loads = [];
    const router = createRouter(config);
    router.routes = paths.map((routePath, index) =>
        createUnresolvedRoute(index, routePath, () => {
            loads.push(routePath);
            return failing.includes(routePath)
                ? Promise.reject(new Error('ChunkLoadError'))
                : Promise.resolve(createModule(routePath));
        }),
    );

    return { router, loads };
};

/*----------------------------------
- TESTS
----------------------------------*/

test('prefetch(path) loads the matching route chunk once and keeps it resolved', async () => {
    const { router, loads } = createRouterWithRoutes(['/radars', '/sales']);

    await Promise.all([router.prefetch('/sales?tab=near#top'), router.prefetch('/sales')]);
    await router.prefetch('/sales');

    assert.deepEqual(loads, ['/sales']);
    assert.equal('load' in router.routes[1], false);
    assert.equal(router.routes[1].path, '/sales');
    assert.deepEqual(router.routes[1].regex, /^\/sales$/);
    assert.equal('load' in router.routes[0], true);
});

test('a navigation joins a prefetch already in flight', async () => {
    const { router, loads } = createRouterWithRoutes(['/radars']);
    const route = router.routes[0];

    const prefetch = router.prefetch('/radars');
    const navigationRoute = await router['load'](route);
    await prefetch;

    assert.deepEqual(loads, ['/radars']);
    assert.equal(navigationRoute.path, '/radars');
});

test('prefetch ignores unknown paths and leaves failures to the navigation', async () => {
    let updates = 0;
    const { router, loads } = createRouterWithRoutes(['/radars'], { failing: ['/radars'] });
    router.app.handleUpdate = () => updates++;

    await router.prefetch('https://example.com/elsewhere');
    await router.prefetch('/unknown');
    await router.prefetch('/radars');

    assert.deepEqual(loads, ['/radars']);
    assert.equal(updates, 0);
    // Still unresolved: the next navigation loads it again and reports a failure itself
    assert.equal('load' in router.routes[0], true);
});

test('the router config prefetch list loads at idle, one chunk at a time', async () => {
    const idleCallbacks = [];
    window.requestIdleCallback = (callback) => idleCallbacks.push(callback);

    try {
        const { router, loads } = createRouterWithRoutes(['/radars', '/sales', '/tlds'], {
            config: { prefetch: ['/sales', '/radars'] },
        });
        let releaseSales;
        const salesLoad = router.routes[1].load;
        router.routes[1].load = () => new Promise((resolve) => (releaseSales = () => resolve(salesLoad())));

        router['prefetchAtIdle']();
        assert.equal(idleCallbacks.length, 1);
        await flush();
        assert.deepEqual(loads, []);

        idleCallbacks[0]();
        await flush();
        // The second chunk waits for the first
        assert.deepEqual(loads, []);
        releaseSales();
        await flush();
        assert.deepEqual(loads, ['/sales', '/radars']);

        // Nothing to schedule without a list
        createRouterWithRoutes(['/radars']).router['prefetchAtIdle']();
        assert.equal(idleCallbacks.length, 1);
    } finally {
        delete window.requestIdleCallback;
    }
});

test('without requestIdleCallback the prefetch waits a real delay, not one millisecond', async () => {
    const timers = [];
    window.setTimeout = (callback, delay) => timers.push({ callback, delay });

    try {
        const { router, loads } = createRouterWithRoutes(['/radars'], { config: { prefetch: ['/radars'] } });
        router['prefetchAtIdle']();

        assert.equal(timers.length, 1);
        // Safari and iOS have no idle callback: the page's own requests go first
        assert.ok(timers[0].delay >= 1000, `fallback delay ${timers[0].delay}ms`);
        assert.deepEqual(loads, []);

        timers[0].callback();
        await flush();
        assert.deepEqual(loads, ['/radars']);
    } finally {
        // The harness window has no timers of its own
        delete window.setTimeout;
    }
});

test('data saver turns the idle prefetch off', () => {
    const idleCallbacks = [];
    window.requestIdleCallback = (callback) => idleCallbacks.push(callback);
    window.navigator = { connection: { saveData: true } };

    try {
        createRouterWithRoutes(['/radars'], { config: { prefetch: ['/radars'] } }).router['prefetchAtIdle']();
        assert.equal(idleCallbacks.length, 0);

        // Saver off, or no Network Information API at all: the prefetch is scheduled
        window.navigator = { connection: { saveData: false } };
        createRouterWithRoutes(['/radars'], { config: { prefetch: ['/radars'] } }).router['prefetchAtIdle']();
        window.navigator = {};
        createRouterWithRoutes(['/radars'], { config: { prefetch: ['/radars'] } }).router['prefetchAtIdle']();
        assert.equal(idleCallbacks.length, 2);
    } finally {
        delete window.requestIdleCallback;
        window.navigator = {};
    }
});

test('Link prefetch loads the route on hover and focus, and keeps the caller handlers', async () => {
    const { router, loads } = createRouterWithRoutes(['/radars']);
    const anchors = [];
    const previousVnodeHook = options.vnode;
    options.vnode = (vnode) => {
        if (vnode.type === 'a') anchors.push(vnode.props);
        previousVnodeHook?.(vnode);
    };

    let hovered = 0;
    try {
        renderToString(
            h(
                ReactClientContext.Provider,
                { value: { Router: router } },
                h(Link, { to: '/radars', prefetch: true, onMouseEnter: () => hovered++ }, 'Radars'),
                h(Link, { to: '/radars' }, 'Plain'),
            ),
        );
    } finally {
        options.vnode = previousVnodeHook;
    }

    const [prefetching, plain] = anchors;
    assert.equal(plain.onMouseEnter, undefined);
    assert.equal(plain.onFocus, undefined);

    prefetching.onMouseEnter({});
    prefetching.onFocus({});
    await flush();

    assert.equal(hovered, 1);
    assert.deepEqual(loads, ['/radars']);
});

afterAll(restore);
