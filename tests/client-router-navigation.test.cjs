const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const coreRoot = path.join(__dirname, '..');
require('module-alias').addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
});
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

// Page.tsx renders through preact, like the apps that alias react to preact/compat
let pageContext = {};
const clientContextStub = () => pageContext;
clientContextStub.default = clientContextStub;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (request === '@/client/context') return clientContextStub;
    if (request === 'react') return originalLoad.call(this, 'preact/compat', parent, isMain);

    return originalLoad.call(this, request, parent, isMain);
};

const { h } = require('preact');
const { renderToString } = require('preact-render-to-string');
const { createNavigationSequencer, shouldDeferNavigation } = require('../client/services/router/navigation.ts');
const { createPageNavigation } = require('../common/router/response/page.ts');
const PageComponent = require('../client/services/router/components/Page.tsx').default;
const ClientPage = require('../client/services/router/response/page.ts').default;
// After Page.tsx, which keeps the context stub above: the harness brings window, history and the router
const routerHarness = require('./clientRouterHarness.cjs');
const { createRouterNavigation } = require('../client/services/router/components/router.tsx');

/*----------------------------------
- HARNESS
----------------------------------*/

const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

// A page whose every data fetch waits for the test to settle it
const createPage = (chunkId, { defers = false, prepareError } = {}) => {
    const fetches = [];
    return {
        chunkId,
        defers,
        prepareError,
        data: {},
        navigation: createPageNavigation({ status: 'ready' }),
        fetches,
        nextFetch: () => {
            const fetch = createDeferred();
            fetches.push(fetch);
            return fetch.promise;
        },
    };
};

// A request whose route chunk loads when the test says so
const createRequest = (page, chunk = Promise.resolve()) => ({ page, chunk });

const createHarness = (initialPage) => {
    const log = [];
    let committed = initialPage;
    const ports = {
        resolve: async (request, isCurrent) => {
            log.push(`resolve:${request.page.chunkId}`);
            await request.chunk;
            return isCurrent() ? request.page : null;
        },
        defers: (page) => page.defers,
        prepare: (page) => {
            log.push(`prepare:${page.chunkId}`);
            if (page.prepareError) throw page.prepareError;
            page.onPrepare?.();
        },
        fetch: async (page, prepared) => {
            log.push(`fetch:${page.chunkId}:${prepared ? 'prepared' : 'fresh'}`);
            const data = await page.nextFetch();
            page.data = { ...page.data, ...data };
        },
        commit: (page) => {
            log.push(`commit:${page.chunkId}`);
            committed = page;
        },
        render: (page, data) => log.push(`render:${page.chunkId}:${page.navigation.status}${data ? `:${data}` : ''}`),
        ready: (page) => log.push(`ready:${page.chunkId}`),
        setLoading: (loading) => log.push(`loading:${loading}`),
        fail: (step, error) => log.push(`fail:${step}:${error.message}`),
        startRender: () => log.push('startRender'),
    };

    return { log, committed: () => committed, sequencer: createNavigationSequencer(ports, initialPage) };
};

/*----------------------------------
- MODE
----------------------------------*/

test('a page defers only in deferred mode, when it declares it and has a data loader', () => {
    const loader = () => ({});
    const deferredRoute = { options: { navigation: 'deferred' }, data: loader };

    assert.equal(shouldDeferNavigation('deferred', deferredRoute), true);
    assert.equal(shouldDeferNavigation('blocking', deferredRoute), false);
    assert.equal(shouldDeferNavigation(undefined, deferredRoute), false);
    assert.equal(shouldDeferNavigation('deferred', { options: {}, data: loader }), false);
    assert.equal(shouldDeferNavigation('deferred', { options: { navigation: 'blocking' }, data: loader }), false);
    assert.equal(shouldDeferNavigation('deferred', { options: { navigation: 'deferred' }, data: null }), false);
    assert.equal(shouldDeferNavigation('deferred', { options: { navigation: 'deferred' } }), false);
});

/*----------------------------------
- BLOCKING
----------------------------------*/

test('blocking navigation keeps the loader, route, data, swap order', async () => {
    const harness = createHarness(createPage('home'));
    const next = createPage('list');

    const navigation = harness.sequencer.navigate(createRequest(next), { extra: true }, 'nav:1');
    await flush();
    assert.deepEqual(harness.log, ['loading:true', 'resolve:list', 'fetch:list:fresh']);
    assert.equal(harness.committed().chunkId, 'home');

    next.fetches[0].resolve({ rows: [1] });
    await navigation;

    assert.deepEqual(harness.log, ['loading:true', 'resolve:list', 'fetch:list:fresh', 'startRender', 'commit:list']);
    assert.deepEqual(next.data, { rows: [1], extra: true });
    assert.equal(harness.sequencer.current(), next);
    // The swap render releases the loader and fires page.ready, not the sequencer
    assert.equal(next.navigation.status, 'ready');
});

test('a page declaring deferred navigation stays blocking when it does not defer', async () => {
    const harness = createHarness(createPage('home'));
    const next = createPage('list', { defers: false });

    const navigation = harness.sequencer.navigate(createRequest(next));
    await flush();
    next.fetches[0].resolve({});
    await navigation;

    assert.equal(harness.log.includes('prepare:list'), false);
    assert.deepEqual(harness.log.slice(-2), ['startRender', 'commit:list']);
});

test('show() swaps a resolved error page without the loader', async () => {
    const harness = createHarness(createPage('home'));
    const errorPage = createPage('error-404');

    const navigation = harness.sequencer.show(errorPage, { message: 'Not found' });
    await flush();
    errorPage.fetches[0].resolve({});
    await navigation;

    assert.deepEqual(harness.log, ['fetch:error-404:fresh', 'startRender', 'commit:error-404']);
    assert.equal(errorPage.data.message, 'Not found');
});

test('a blocking data failure is logged, releases the loader and keeps the current page', async () => {
    const harness = createHarness(createPage('home'));
    const next = createPage('list');

    const navigation = harness.sequencer.navigate(createRequest(next));
    await flush();
    next.fetches[0].reject(new Error('offline'));
    await navigation;

    assert.deepEqual(harness.log.slice(-2), ['fail:data:offline', 'loading:false']);
    assert.equal(harness.committed().chunkId, 'home');
});

/*----------------------------------
- DEFERRED
----------------------------------*/

test('deferred navigation swaps the page in before its data', async () => {
    const harness = createHarness(createPage('home'));
    const next = createPage('list', { defers: true });

    const navigation = harness.sequencer.navigate(createRequest(next), { extra: true });
    await flush();

    assert.deepEqual(harness.log, [
        'loading:true',
        'resolve:list',
        'prepare:list',
        'startRender',
        'commit:list',
        'fetch:list:prepared',
    ]);
    assert.equal(next.navigation.status, 'pending');
    assert.equal(next.navigation.pending, true);
    assert.equal(next.navigation.stale, false);
    assert.equal(next.navigation.error, null);
    assert.equal(typeof next.navigation.since, 'number');

    next.fetches[0].resolve({ rows: [1] });
    await navigation;

    assert.deepEqual(harness.log.slice(-3), ['render:list:ready:replace', 'loading:false', 'ready:list']);
    assert.deepEqual(next.data, { rows: [1], extra: true });
    assert.equal(next.navigation.status, 'ready');
});

test('a throwing data provider aborts a deferred navigation before the swap', async () => {
    const harness = createHarness(createPage('home'));
    const next = createPage('list', { defers: true, prepareError: new Error('bad params') });

    await harness.sequencer.navigate(createRequest(next));

    assert.deepEqual(harness.log, ['loading:true', 'resolve:list', 'prepare:list', 'fail:data:bad params', 'loading:false']);
    assert.equal(harness.committed().chunkId, 'home');
});

test('a same-chunk deferred navigation keeps the previous data on screen', async () => {
    const harness = createHarness(createPage('list'));
    const sameChunk = createPage('list', { defers: true });

    harness.sequencer.navigate(createRequest(sameChunk));
    await flush();
    assert.equal(sameChunk.navigation.stale, true);

    // Cross-chunk: the Page component remounts, nothing to keep
    const otherChunk = createPage('detail', { defers: true });
    harness.sequencer.navigate(createRequest(otherChunk));
    await flush();
    assert.equal(otherChunk.navigation.stale, false);

    // Same chunk as a page that never showed data: nothing to keep either
    const afterPending = createPage('detail', { defers: true });
    harness.sequencer.navigate(createRequest(afterPending));
    await flush();
    assert.equal(afterPending.navigation.stale, false);
});

test('a deferred page whose provider redirects never swaps in', async () => {
    const harness = createHarness(createPage('home'));
    const login = createPage('login');
    const redirecting = createPage('account', { defers: true });
    let redirect;
    // Router.go('/login') from the provider starts the next navigation synchronously
    redirecting.onPrepare = () => (redirect = harness.sequencer.navigate(createRequest(login)));

    harness.sequencer.navigate(createRequest(redirecting));
    await flush();
    login.fetches[0].resolve({});
    await redirect;

    assert.equal(harness.log.includes('commit:account'), false);
    assert.equal(harness.log.includes('fetch:account:prepared'), false);
    assert.equal(harness.committed(), login);
});

/*----------------------------------
- RACES
----------------------------------*/

test('a slower chunk of an older navigation never commits', async () => {
    const harness = createHarness(createPage('home'));
    const slowChunk = createDeferred();
    const slow = createPage('slow', { defers: true });
    const fast = createPage('fast', { defers: true });

    const slowNavigation = harness.sequencer.navigate(createRequest(slow, slowChunk.promise));
    const fastNavigation = harness.sequencer.navigate(createRequest(fast));
    await flush();
    fast.fetches[0].resolve({});
    await fastNavigation;

    slowChunk.resolve();
    await slowNavigation;

    assert.equal(harness.committed(), fast);
    assert.equal(harness.log.includes('commit:slow'), false);
    assert.equal(harness.log.includes('prepare:slow'), false);
    assert.equal(harness.log.filter((entry) => entry === 'loading:false').length, 1);
});

test('older data never lands on a newer page', async () => {
    const harness = createHarness(createPage('home'));
    const blockingFirst = createPage('blocking');
    const deferredFirst = createPage('first', { defers: true });
    const latest = createPage('latest', { defers: true });

    // Blocking: the older data arrives after a newer navigation started
    const blockingNavigation = harness.sequencer.navigate(createRequest(blockingFirst));
    await flush();
    const deferredNavigation = harness.sequencer.navigate(createRequest(deferredFirst));
    await flush();
    blockingFirst.fetches[0].resolve({});
    await blockingNavigation;
    assert.equal(harness.log.includes('commit:blocking'), false);

    // Deferred: the first page is on screen, then replaced before its data
    const latestNavigation = harness.sequencer.navigate(createRequest(latest));
    await flush();
    deferredFirst.fetches[0].resolve({ rows: [1] });
    await deferredNavigation;
    assert.equal(harness.log.includes('render:first:ready:replace'), false);
    assert.equal(harness.log.includes('ready:first'), false);

    latest.fetches[0].resolve({});
    await latestNavigation;
    assert.equal(harness.sequencer.current(), latest);
    assert.equal(harness.log.at(-1), 'ready:latest');
});

test('data that lands while a newer navigation resolves renders but leaves the loader on', async () => {
    const harness = createHarness(createPage('home'));
    const shown = createPage('shown', { defers: true });
    const nextChunk = createDeferred();
    const next = createPage('next', { defers: true });

    const shownNavigation = harness.sequencer.navigate(createRequest(shown));
    await flush();
    const nextNavigation = harness.sequencer.navigate(createRequest(next, nextChunk.promise));
    await flush();

    shown.fetches[0].resolve({});
    await shownNavigation;
    assert.deepEqual(harness.log.slice(-2), ['render:shown:ready:replace', 'ready:shown']);

    nextChunk.resolve();
    await flush();
    next.fetches[0].resolve({});
    await nextNavigation;
    assert.deepEqual(harness.log.slice(-3), ['render:next:ready:replace', 'loading:false', 'ready:next']);
});

test('a rejected chunk is logged and releases the loader', async () => {
    const harness = createHarness(createPage('home'));
    const broken = createPage('broken', { defers: true });

    await harness.sequencer.navigate(
        createRequest(broken, Promise.reject(new Error('A new version of the website is available.'))),
    );

    assert.deepEqual(harness.log, [
        'loading:true',
        'resolve:broken',
        'fail:route:A new version of the website is available.',
        'loading:false',
    ]);
    assert.equal(harness.committed().chunkId, 'home');

    // The next navigation still works
    const next = createPage('next');
    const navigation = harness.sequencer.navigate(createRequest(next));
    await flush();
    next.fetches[0].resolve({});
    await navigation;
    assert.equal(harness.committed(), next);
});

test('an error page loaded for a superseded navigation never builds its response', async () => {
    const router = routerHarness.createRouter();
    let loads = 0;
    router.errors[500] = {
        index: 0,
        code: 500,
        chunk: 'error500',
        load: async () => {
            loads++;
            return { __register: () => ({ code: 500, options: {}, controller: () => assert.fail('controller ran') }) };
        },
    };
    const originalLog = console.log;
    console.log = () => {};

    try {
        // A newer navigation started while the error chunk loaded
        const page = await router['createErrorResponse'](new Error('boom'), {}, {}, () => false);
        assert.equal(page, null);
    } finally {
        console.log = originalLog;
    }

    assert.equal(loads, 1);
    // The loaded chunk is kept for the next error
    assert.equal('load' in router.errors[500], false);
});

/*----------------------------------
- ERROR AND RETRY
----------------------------------*/

test('a failed deferred data step shows an error that retry() recovers', async () => {
    const harness = createHarness(createPage('home'));
    const page = createPage('list', { defers: true });

    const navigation = harness.sequencer.navigate(createRequest(page));
    await flush();
    page.fetches[0].reject(new Error('offline'));
    await navigation;

    assert.equal(page.navigation.status, 'error');
    assert.equal(page.navigation.error.message, 'offline');
    assert.equal(page.navigation.stale, false);
    assert.deepEqual(harness.log.slice(-3), ['render:list:error', 'fail:data:offline', 'loading:false']);
    assert.equal(harness.log.includes('ready:list'), false);

    // Retry re-runs only the data step: no route, no swap, no loader. The data never reached the screen, so it
    //  is a first load: it replaces the page state rather than merging into what the Page component held
    harness.log.length = 0;
    page.navigation.retry();
    assert.equal(page.navigation.status, 'pending');
    assert.equal(page.navigation.stale, false);
    assert.equal(page.navigation.reloading, false);
    page.fetches[1].resolve({ rows: [1] });
    await flush();

    assert.deepEqual(harness.log, [
        'render:list:pending',
        'fetch:list:fresh',
        'render:list:ready:replace',
        'loading:false',
        'ready:list',
    ]);
    assert.equal(page.navigation.reloading, false);

    // A later retry (api.reload) keeps this page's own data on screen, merges, and does not fire ready again
    harness.log.length = 0;
    page.navigation.retry();
    assert.equal(page.navigation.stale, true);
    assert.equal(page.navigation.reloading, true);
    page.fetches[2].resolve({ rows: [2] });
    await flush();

    assert.deepEqual(harness.log, ['render:list:pending', 'fetch:list:fresh', 'render:list:ready:merge', 'loading:false']);
    assert.deepEqual(page.data, { rows: [2] });

    // A reload that fails keeps saying so: the data on screen is still the page's own
    page.navigation.retry();
    page.fetches[3].reject(new Error('offline'));
    await flush();
    assert.equal(page.navigation.status, 'error');
    assert.equal(page.navigation.reloading, true);
});

test('a same-chunk navigation is stale but never reloading: the data on screen is the previous page\'s', async () => {
    const harness = createHarness(createPage('list'));
    const next = createPage('list', { defers: true });

    harness.sequencer.navigate(createRequest(next));
    await flush();

    assert.equal(next.navigation.stale, true);
    assert.equal(next.navigation.reloading, false);

    // A retry of its failed first data step is still not a reload
    next.fetches[0].reject(new Error('offline'));
    await flush();
    next.navigation.retry();
    assert.equal(next.navigation.stale, true);
    assert.equal(next.navigation.reloading, false);
});

test('retry() of a page that left the screen does nothing, and the SSR page can retry', async () => {
    const initial = createPage('home', { defers: true });
    const harness = createHarness(initial);
    const staleRetry = initial.navigation.retry;

    // The SSR page is bound at creation
    harness.sequencer.retry();
    assert.deepEqual(harness.log, ['render:home:pending', 'fetch:home:fresh']);
    initial.fetches[0].resolve({});
    await flush();

    const next = createPage('next');
    const navigation = harness.sequencer.navigate(createRequest(next));
    await flush();
    next.fetches[0].resolve({});
    await navigation;

    harness.log.length = 0;
    staleRetry();
    // A blocking page has no data step to retry
    await harness.sequencer.retry();
    assert.deepEqual(harness.log, []);
});

/*----------------------------------
- CLIENT PAGE
----------------------------------*/

test('a deferred data step reuses the fetchers its providers built before the swap', async () => {
    let providerRuns = 0;
    const route = {
        path: '/radars',
        options: { id: 'radars', navigation: 'deferred' },
        data: () => {
            providerRuns++;
            return { radars: Promise.resolve(['one']), view: 'grid' };
        },
    };
    const mode = { mode: 'deferred' };
    const context = {
        route,
        request: {
            url: 'http://localhost/radars',
            data: {},
            api: {
                fetchSync: async (fetchers, loaded) => {
                    const data = { ...loaded };
                    for (const key in fetchers) data[key] = await fetchers[key];
                    return data;
                },
            },
        },
        Router: { config: { navigation: mode } },
    };
    const page = new ClientPage(route, () => null, context);

    assert.equal(page.isDeferred(), true);
    mode.mode = 'blocking';
    assert.equal(page.isDeferred(), false);

    page.prepareFetchers();
    await page.preRender(undefined, page.fetchers);
    assert.equal(providerRuns, 1);
    assert.deepEqual(page.data, { radars: ['one'], view: 'grid' });
    assert.equal(context.page, page);

    // Without prepared fetchers (blocking navigation, retry), the providers run again
    page.data = {};
    await page.preRender();
    assert.equal(providerRuns, 2);
});

test('a deferred page rejects a "navigation" key from its layout data too', () => {
    const route = { path: '/radars', options: { id: 'radars', navigation: 'deferred' }, data: () => ({ rows: [] }) };
    const context = { route, request: { url: 'http://localhost/radars', data: {}, api: {} }, Router: { config: {} } };
    const layout = { path: '/', Component: () => null, data: () => ({ navigation: { menu: [] } }) };
    const page = new ClientPage(route, () => null, context, layout);

    assert.throws(() => page.prepareFetchers(), /Layout data .* cannot return key "navigation"/);

    // The same layout is fine under a blocking page
    const blockingRoute = { ...route, options: { id: 'radars' } };
    const blockingPage = new ClientPage(blockingRoute, () => null, { ...context, route: blockingRoute }, layout);
    assert.deepEqual(Object.keys(blockingPage.prepareFetchers()), ['rows', 'navigation']);
});

/*----------------------------------
- ROUTER PORTS
----------------------------------*/

const createRouterPorts = ({ initialPage, resolve }) => {
    const handled = [];
    const loading = [];
    const clientRouter = {
        app: { handleError: (error) => handled.push(error) },
        setLoading: (value) => loading.push(value),
        resolve,
    };
    const view = { setCurrentPage: () => {}, setReadyCount: () => {} };
    const context = { page: initialPage };
    const navigation = createRouterNavigation(clientRouter, context, view, initialPage);

    return { navigation, handled, loading, context };
};

// A deferred page as the router ports see it, holding the Page component's data state
const createRenderedPage = (fetched) => {
    const page = {
        chunkId: 'radars',
        data: {},
        fetchers: {},
        navigation: createPageNavigation({ status: 'ready' }),
        state: { rows: ['previous'], note: 'written by api.set' },
        isDeferred: () => true,
        prepareFetchers: () => {},
        preRender: async () => {
            page.data = fetched();
        },
        setAllData: (update) => {
            page.state = update(page.state);
        },
        setNavigation: () => {},
    };
    return page;
};

test('a route chunk that fails to load reaches the app error handler and releases the loader', async () => {
    const { navigation, handled, loading } = createRouterPorts({
        resolve: async () => {
            throw new Error('A new version of the website is available. Please refresh the page.');
        },
    });
    const originalError = console.error;
    console.error = () => {};

    try {
        await navigation.sequencer.navigate({ path: '/radars' });
    } finally {
        console.error = originalError;
    }

    assert.equal(handled.length, 1);
    assert.match(handled[0].message, /new version/);
    assert.deepEqual(loading, [true, false]);
});

test('a reload merges into the data written with api.set, a navigation replaces it', async () => {
    let rows = ['reloaded'];
    const shown = createRenderedPage(() => ({ rows }));
    const { navigation } = createRouterPorts({ initialPage: shown, resolve: async () => next });

    await navigation.sequencer.retry();
    assert.deepEqual(shown.state, { rows: ['reloaded'], note: 'written by api.set' });

    // The first data render of a navigation replaces what the Page component held
    const next = createRenderedPage(() => ({ rows: ['next'] }));
    next.state = { leftover: true };
    await navigation.sequencer.navigate({ path: '/radars?page=2' });
    assert.deepEqual(next.state, { rows: ['next'] });
});

test('a retry that recovers a failed first data step replaces the previous page\'s data', async () => {
    let fail = true;
    const shown = createRenderedPage(() => ({ rows: ['previous'] }));
    const next = createRenderedPage(() => {
        if (fail) throw new Error('offline');
        return { rows: ['next'] };
    });
    const { navigation } = createRouterPorts({ initialPage: shown, resolve: async () => next });
    const originalError = console.error;
    console.error = () => {};

    try {
        // Same chunk: the Page component, and its state, stay those of the previous page
        next.state = { rows: ['previous'], note: 'previous page only' };
        await navigation.sequencer.navigate({ path: '/radars?page=2' });
        assert.equal(next.navigation.status, 'error');

        fail = false;
        await navigation.sequencer.retry();
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(next.state, { rows: ['next'] });
});

test('the context keeps the page on screen until a navigation commits', async () => {
    const shown = createRenderedPage(() => ({ rows: [] }));
    const superseded = createRenderedPage(() => ({ rows: [] }));
    // Blocking, with its data held: resolved and current, but not swapped in yet
    const latest = createRenderedPage(() => ({ rows: [] }));
    const latestData = createDeferred();
    latest.isDeferred = () => false;
    latest.preRender = () => latestData.promise;
    const routes = { '/radars/1': createDeferred(), '/radars/2': createDeferred() };
    const { navigation, context } = createRouterPorts({
        initialPage: shown,
        resolve: (request, isCurrent) => routes[request.path].promise.then((page) => (isCurrent() ? page : null)),
    });

    const supersededNavigation = navigation.sequencer.navigate({ path: '/radars/1' });
    const latestNavigation = navigation.sequencer.navigate({ path: '/radars/2' });

    // A navigation superseded during its route load never touches the context
    routes['/radars/1'].resolve(superseded);
    await supersededNavigation;
    assert.equal(context.page, shown);

    // Resolved and current, its data still loading: the page on screen still answers api.set and api.reload
    routes['/radars/2'].resolve(latest);
    await flush();
    assert.equal(context.page, shown);

    latestData.resolve();
    await latestNavigation;
    assert.equal(context.page, latest);
});

test('a response built for a navigation leaves the router context on the page on screen', () => {
    const ClientPageResponse = require('../client/services/router/response/index.tsx').default;
    const pageOnScreen = { chunkId: 'radars' };
    const router = { context: { page: pageOnScreen }, config: { context: () => ({}) } };
    const request = { app: {}, api: {}, router };

    const response = new ClientPageResponse(request, { options: {} });

    // The response's own context starts without a page; the router's keeps the one on screen
    assert.equal(router.context.page, pageOnScreen);
    assert.equal(router.context.request, request);
    assert.equal(response.context.page, undefined);
});

/*----------------------------------
- ROUTER COMPONENT
----------------------------------*/

const { options: preactOptions, render: renderInto } = require('preact');
const { createFakeDocument } = require('./fakeDom.cjs');
const { default: RouterComponent, scrollToHash } = require('../client/services/router/components/router.tsx');

// A page as the router component and the Page component read it, whose data the test releases
const createMountedPage = (chunkId, { deferred, log }) => {
    const data = createDeferred();
    const page = {
        chunkId,
        data: {},
        fetchers: {},
        navigation: createPageNavigation({ status: 'ready' }),
        context: { request: { path: `/${chunkId}` } },
        route: { path: `/${chunkId}`, options: deferred ? { navigation: 'deferred' } : {} },
        renderer: (props) => {
            log.push(`render:${chunkId}:${props.rows ? 'data' : 'empty'}`);
            return null;
        },
        isDeferred: () => deferred,
        prepareFetchers: () => ({}),
        preRender: async () => {
            page.data = await data.promise;
            return page;
        },
        updateClient: () => log.push(`updateClient:${chunkId}`),
        setAllData: () => {},
        setNavigation: () => {},
        releaseData: data.resolve,
    };
    return page;
};

test('page.ready waits for the data render when the data lands before the swap\'s effects run', async () => {
    const log = [];
    const frames = [];
    const previousFrame = preactOptions.requestAnimationFrame;
    const previousDocument = { ...global.document };
    // Effects run when the test paints a frame, so the data can land between a render and its effects
    preactOptions.requestAnimationFrame = (callback) => frames.push(callback);
    const paint = () => frames.splice(0).forEach((callback) => callback());
    Object.assign(global.document, createFakeDocument());
    const root = global.document.createElement('div');

    try {
        const home = createMountedPage('home', { deferred: false, log });
        const radars = createMountedPage('radars', { deferred: true, log });
        const clientRouter = { app: { handleError: () => {} }, runHook: (name) => log.push(`hook:${name}`) };
        // One context for the router component (harness stub) and the Page component (this file's stub)
        pageContext = { page: home, request: home.context.request, data: {} };
        routerHarness.setClientContext(pageContext);

        renderInto(h(RouterComponent, { service: clientRouter }), root);
        paint();
        log.length = 0;

        const navigation = clientRouter.navigate(radars);
        // The swap renders the pending page; its effects wait for the next frame
        await flush();
        // The data lands within that frame
        radars.releaseData({ rows: [1] });
        await navigation;
        // The next render runs the swap's pending effects first, then the data render
        await flush();
        paint();

        const dataRender = log.indexOf('render:radars:data');
        const ready = log.indexOf('hook:page.ready');
        assert.ok(dataRender >= 0, log.join(' '));
        assert.ok(ready > dataRender, `page.ready before the data render: ${log.join(' ')}`);
        assert.equal(log.filter((entry) => entry === 'hook:page.ready').length, 1);
        // The title and body refresh after the data render ran
        assert.ok(log.lastIndexOf('updateClient:radars') > dataRender, log.join(' '));
    } finally {
        renderInto(null, root);
        routerHarness.setClientContext({});
        preactOptions.requestAnimationFrame = previousFrame;
        for (const key of Object.keys(global.document)) if (!(key in previousDocument)) delete global.document[key];
    }
});

test('a hash scrolls to the element with that id, decoded, never to a tag selector', () => {
    const lookedUp = [];
    const scrolled = [];
    global.document.getElementById = (id) => {
        lookedUp.push(id);
        return id === 'prices' || id === 'café' ? { scrollIntoView: () => scrolled.push(id) } : null;
    };

    try {
        scrollToHash('#prices');
        scrollToHash('#caf%C3%A9');
        // An id a selector would refuse, and a malformed escape, are looked up as ids all the same
        scrollToHash('#2026-prices');
        scrollToHash('#100%');
        scrollToHash('#');
    } finally {
        delete global.document.getElementById;
    }

    assert.deepEqual(lookedUp, ['prices', 'café', '2026-prices', '100%']);
    assert.deepEqual(scrolled, ['prices', 'café']);
});

/*----------------------------------
- PAGE COMPONENT
----------------------------------*/

const renderPage = ({ declared, navigation, data }) => {
    let received;
    const page = {
        data,
        navigation,
        route: { options: declared ? { navigation: declared } : {} },
        renderer: (props) => {
            received = props;
            return null;
        },
    };
    pageContext = { data: {} };
    renderToString(h(PageComponent, { page }));

    return { page, received };
};

test('the Page component gives the navigation prop to deferred pages only, and binds both setters', () => {
    const pending = createPageNavigation({ status: 'pending', stale: false });
    const deferredPage = renderPage({ declared: 'deferred', navigation: pending, data: {} });

    assert.equal(deferredPage.received.navigation, pending);
    assert.equal(deferredPage.received.rows, undefined);
    assert.equal(typeof deferredPage.page.setNavigation, 'function');
    assert.equal(typeof deferredPage.page.setAllData, 'function');

    // A blocking page may return its own `navigation` data key
    const blockingPage = renderPage({
        declared: undefined,
        navigation: createPageNavigation({ status: 'ready' }),
        data: { navigation: 'site menu', rows: [1] },
    });
    assert.equal(blockingPage.received.navigation, 'site menu');
    assert.deepEqual(blockingPage.received.rows, [1]);
});

afterAll(() => {
    routerHarness.restore();
    Module._load = originalLoad;
});
