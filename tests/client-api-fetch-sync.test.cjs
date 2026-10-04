const assert = require('node:assert/strict');
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

const previousDev = global.__DEV__;
const previousFetch = global.fetch;
global.__DEV__ = false;

const ApiClient = require('../client/services/router/request/api.ts').default;

/*----------------------------------
- HARNESS
----------------------------------*/

const createClient = (respond) => {
    const calls = [];
    const handledErrors = [];
    const app = { handleError: (error) => handledErrors.push(error) };
    const request = { router: { url: (requestPath) => requestPath } };

    global.fetch = async (url, config) => {
        calls.push({ url, method: config.method, body: config.body ? JSON.parse(config.body) : undefined });
        const { status = 200, body } = respond(url, config);
        return { ok: status < 400, status, json: async () => body, headers: new Headers() };
    };

    return { api: new ApiClient(app, request), calls, handledErrors };
};

const quietly = async (run) => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
        return await run();
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
};

/*----------------------------------
- TESTS
----------------------------------*/

test('fetchSync sends api fetchers in one batch, awaits other promises locally and keeps plain values', async () => {
    const { api, calls } = createClient(() => ({ body: { rows: [1, 2], stats: { total: 2 } } }));

    const data = await quietly(() =>
        api.fetchSync(
            {
                rows: api.post('/api/Rows/list', { page: 1 }),
                stats: api.post('/api/Rows/stats'),
                local: Promise.resolve({ ok: true }),
                thenable: { then: (resolve) => resolve(5) },
                initialFilters: { q: 'word' },
                dateKey: '2026-10-04',
                skipped: undefined,
                cached: api.post('/api/Rows/cached'),
            },
            { cached: 'kept' },
        ),
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(Object.keys(calls[0].body.fetchers), ['rows', 'stats']);
    assert.deepEqual(calls[0].body.fetchers.rows, { method: 'POST', path: '/api/Rows/list', data: { page: 1 } });

    assert.deepEqual(data, {
        cached: 'kept',
        rows: [1, 2],
        stats: { total: 2 },
        // Not an /api call: resolved here instead of serializing to {}
        local: { ok: true },
        thenable: 5,
        initialFilters: { q: 'word' },
        dateKey: '2026-10-04',
    });
    assert.deepEqual(Object.keys(data), ['cached', 'rows', 'stats', 'local', 'thenable', 'initialFilters', 'dateKey']);
});

test('fetchSync makes no request when no entry needs the server', async () => {
    const { api, calls } = createClient(() => ({ body: {} }));

    const data = await api.fetchSync({ deepLink: { tab: 'sales' }, today: Promise.resolve('2026-10-04') }, {});

    assert.equal(calls.length, 0);
    assert.deepEqual(data, { deepLink: { tab: 'sales' }, today: '2026-10-04' });
});

test('a failed batch goes through the app error handler and rejects', async () => {
    const { api, handledErrors } = createClient(() => ({ status: 500, body: { code: 500, message: 'Boom' } }));

    await quietly(() =>
        assert.rejects(() => api.fetchSync({ rows: api.post('/api/Rows/list') }, {}), (error) => error.message === 'Boom'),
    );
    assert.equal(handledErrors.length, 1);
});

test('a rejected local promise goes through the app error handler and rejects', async () => {
    const { api, calls, handledErrors } = createClient(() => ({ body: {} }));

    await assert.rejects(() => api.fetchSync({ local: Promise.reject(new Error('local failure')) }, {}), /local failure/);
    assert.equal(calls.length, 0);
    assert.equal(handledErrors.length, 1);
    assert.equal(handledErrors[0].message, 'local failure');
});

test('locally resolved values go through JSON, like SSR data and /api responses', async () => {
    const { api } = createClient(() => ({ body: {} }));
    const filters = { q: 'word', page: undefined };
    const day = new Date('2026-10-04T00:00:00.000Z');

    const data = await api.fetchSync(
        {
            filters,
            day,
            money: { toJSON: () => '12.50' },
            seen: new Set(['a']),
            resolved: Promise.resolve({ at: day, missing: undefined }),
            nothing: Promise.resolve(undefined),
        },
        {},
    );

    assert.deepEqual(data, {
        filters: { q: 'word' },
        day: '2026-10-04T00:00:00.000Z',
        money: '12.50',
        seen: {},
        resolved: { at: '2026-10-04T00:00:00.000Z' },
    });
    // The page gets its own copy: the provider's object is not shared
    assert.notEqual(data.filters, filters);
});

test('api.reload re-runs the data step through navigation on a deferred page', () => {
    const { api } = createClient(() => ({ body: {} }));
    let retries = 0;
    let fetches = 0;
    const page = {
        fetchers: { rows: {}, stats: {} },
        data: { rows: [1], stats: { total: 1 } },
        context: { request: { data: { page: '1' } } },
        isDeferred: () => true,
        navigationRetry: () => retries++,
        fetchData: () => {
            fetches++;
            return Promise.resolve({});
        },
    };
    api.router = { context: { page } };

    api.reload('rows', { page: '2' });

    assert.equal(retries, 1);
    assert.equal(fetches, 0);
    // The retry fetches what reload removed, with the new params
    assert.deepEqual(page.data, { stats: { total: 1 } });
    assert.deepEqual(page.context.request.data, { page: '2' });
});

afterAll(() => {
    if (previousDev === undefined) delete global.__DEV__;
    else global.__DEV__ = previousDev;
    if (previousFetch === undefined) delete global.fetch;
    else global.fetch = previousFetch;
});
