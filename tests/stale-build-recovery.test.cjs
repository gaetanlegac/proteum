const assert = require('node:assert/strict');

const { createRouter, restore } = require('./clientRouterHarness.cjs');
const {
    STALE_BUILD_RELOAD_KEY,
    clearStaleBuildReloads,
    isChunkLoadError,
    reloadOnceForStaleBuild,
} = require('../client/app/staleBuild.ts');

/*----------------------------------
- HARNESS
----------------------------------*/

const flush = () => new Promise((resolve) => setImmediate(resolve));

const createStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
};

// What rspack's runtime rejects with when a deploy removed the chunk file
const createChunkLoadError = (chunkId = '7385') => {
    const error = new Error(`Loading chunk ${chunkId} failed.\n(missing: /public/${chunkId}.5860cf66.js)`);
    error.name = 'ChunkLoadError';
    return error;
};

const createCssChunkLoadError = () => {
    const error = new Error('Loading CSS chunk 7385 failed.');
    error.code = 'CSS_CHUNK_LOAD_FAILED';
    return error;
};

// A router with one route whose chunk fails with `error`, a stubbed sessionStorage and reload
const createFailingRouter = (error, { buildId = 1761025500000, storage = createStorage() } = {}) => {
    const calls = { reloads: 0, updates: 0 };
    global.BUILD_ID = buildId;
    window.sessionStorage = storage;
    window.location.reload = () => calls.reloads++;

    const router = createRouter();
    router.app.handleUpdate = () => calls.updates++;
    const route = { index: 0, chunk: 'pages_domains', regex: /^\/domains$/, keys: [], load: () => Promise.reject(error) };
    router.routes = [route];

    return { router, route, calls, storage };
};

const cleanupGlobals = () => {
    delete global.BUILD_ID;
    delete window.sessionStorage;
    delete window.location.reload;
};

afterEach(cleanupGlobals);
afterAll(restore);

/*----------------------------------
- HELPER
----------------------------------*/

test('chunk load errors are told apart from other route load failures', () => {
    assert.equal(isChunkLoadError(createChunkLoadError()), true);
    assert.equal(isChunkLoadError(createCssChunkLoadError()), true);
    // A module that loaded but threw while evaluating is not a stale build
    assert.equal(isChunkLoadError(new Error('ChunkLoadError')), false);
    assert.equal(isChunkLoadError(new TypeError('x is undefined')), false);
});

test('a stale build reloads once per build id, then leaves the error to the caller', () => {
    const storage = createStorage();
    let reloads = 0;
    const options = { storage: () => storage, reload: () => reloads++ };

    assert.equal(reloadOnceForStaleBuild('100', options), true);
    assert.equal(storage.getItem(STALE_BUILD_RELOAD_KEY), '100');
    assert.equal(reloadOnceForStaleBuild('100', options), false);
    assert.equal(reloads, 1);

    // The reloaded page runs the new build: one more reload is allowed if it misses a chunk too
    assert.equal(reloadOnceForStaleBuild('200', options), true);
    assert.equal(reloadOnceForStaleBuild('200', options), false);
    assert.equal(reloads, 2);
});

test('two builds answering during a rollout reload once each, never in turn forever', () => {
    const storage = createStorage();
    let reloads = 0;
    const options = { storage: () => storage, reload: () => reloads++ };

    // Old build A, new HTML from B, a chunk served by A's instance, back to B...
    for (const buildId of ['A', 'B', 'A', 'B', 'A']) reloadOnceForStaleBuild(buildId, options);

    assert.equal(reloads, 2);
    assert.equal(storage.getItem(STALE_BUILD_RELOAD_KEY), 'A,B');
});

test('a route chunk that loads gives the next missing chunk its reload again', () => {
    const storage = createStorage();
    let reloads = 0;
    const options = { storage: () => storage, reload: () => reloads++ };

    // A network blip spent the reload; the reloaded page then loaded its route chunk
    assert.equal(reloadOnceForStaleBuild('100', options), true);
    clearStaleBuildReloads(() => storage);
    assert.equal(storage.getItem(STALE_BUILD_RELOAD_KEY), null);

    // The real deploy later in the same tab, same running build
    assert.equal(reloadOnceForStaleBuild('100', options), true);
    assert.equal(reloads, 2);
});

test('offline, a failed chunk is the network, not a deploy: no reload and the guard stays free', () => {
    const storage = createStorage();
    let reloads = 0;

    assert.equal(reloadOnceForStaleBuild('100', { storage: () => storage, reload: () => reloads++, isOnline: () => false }), false);
    assert.equal(reloads, 0);
    assert.equal(storage.getItem(STALE_BUILD_RELOAD_KEY), null);
});

test('no sessionStorage means no reload, so a blocked guard can never loop', () => {
    let reloads = 0;
    const blocked = () => {
        throw new Error('SecurityError: access denied');
    };
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
        assert.equal(reloadOnceForStaleBuild('100', { storage: blocked, reload: () => reloads++ }), false);
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(reloads, 0);
});

/*----------------------------------
- ROUTER
----------------------------------*/

const silenceConsoleError = async (run) => {
    const originalError = console.error;
    console.error = () => {};
    try {
        return await run();
    } finally {
        console.error = originalError;
    }
};

test('a route chunk the deploy removed reloads the page once instead of opening the update notice', async () => {
    const { router, route, calls, storage } = createFailingRouter(createChunkLoadError());

    await silenceConsoleError(async () => {
        let settled = false;
        router['load'](route).then(
            () => (settled = true),
            () => (settled = true),
        );
        await flush();

        assert.equal(calls.reloads, 1);
        assert.equal(calls.updates, 0);
        // The navigation waits for the new document instead of rendering the error page
        assert.equal(settled, false);
        assert.equal(storage.getItem('proteum:stale-build-reload'), '1761025500000');
    });
});

test('the same build missing a chunk again surfaces the error and the update notice', async () => {
    const storage = createStorage();
    storage.setItem('proteum:stale-build-reload', '1761025500000');
    const { router, route, calls } = createFailingRouter(createCssChunkLoadError(), { storage });

    await silenceConsoleError(async () => {
        await assert.rejects(router['load'](route), /A new version of the website is available/);
    });
    assert.equal(calls.reloads, 0);
    assert.equal(calls.updates, 1);
});

test('a route that loads clears the guard the previous reload left', async () => {
    const storage = createStorage();
    storage.setItem('proteum:stale-build-reload', '1761025500000');
    const { router, route } = createFailingRouter(new Error('unused'), { storage });
    route.load = () => Promise.resolve({ __register: () => ({ method: 'GET', path: '/domains', options: {}, controller: () => null }) });

    await router['load'](route);
    assert.equal(storage.getItem('proteum:stale-build-reload'), null);
});

test('a route module that fails for another reason keeps the update notice and never reloads', async () => {
    const { router, route, calls } = createFailingRouter(new TypeError('x is undefined'));

    await silenceConsoleError(async () => {
        await assert.rejects(router['load'](route), /A new version of the website is available/);
    });
    assert.equal(calls.reloads, 0);
    assert.equal(calls.updates, 1);
});
