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

// The app container reads the app's proteum.config.ts at import; the HTTP server only needs it at runtime.
const httpServerModulePath = path.join(coreRoot, 'server/services/router/http/index.ts');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === httpServerModulePath && request === '@server/app/container') {
        return { __esModule: true, default: {} };
    }

    return originalLoad.call(this, request, parent, isMain);
};

let HttpServer;
let httpDrainDeadlineMs;
try {
    ({ default: HttpServer, httpDrainDeadlineMs } = require('../server/services/router/http/index.ts'));
} finally {
    Module._load = originalLoad;
}

/** A real HttpServer wired to a fake app, with its node server swapped for a recorder. */
const createDrainingServer = () => {
    const hooks = {};
    const app = {
        env: { name: 'local' },
        on: (name, callback) => {
            hooks[name] = callback;
        },
    };
    const server = new HttpServer({ domain: 'localhost', port: 0, ssl: false }, { app });

    const calls = [];
    let closeCallback;
    server.http = {
        close: (callback) => {
            calls.push('close');
            closeCallback = callback;
        },
        closeIdleConnections: () => calls.push('closeIdleConnections'),
        closeAllConnections: () => calls.push('closeAllConnections'),
    };

    let settled = false;
    const runCleanupHook = () => {
        const drained = hooks.cleanup();
        void drained.then(() => {
            settled = true;
        });
        return drained;
    };

    return { calls, runCleanupHook, isSettled: () => settled, finishClose: () => closeCallback() };
};

const flushMicrotasks = async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
};

afterEach(() => {
    vi.useRealTimers();
});

test('http server cleanup waits for close and clears the drain deadline', async () => {
    vi.useFakeTimers();
    const server = createDrainingServer();

    const drained = server.runCleanupHook();
    await flushMicrotasks();

    assert.equal(server.isSettled(), false, 'cleanup must not resolve while responses are still in flight');
    assert.deepEqual(server.calls, ['close', 'closeIdleConnections']);
    assert.equal(vi.getTimerCount(), 1);

    server.finishClose();
    await drained;

    assert.equal(server.isSettled(), true);
    assert.equal(vi.getTimerCount(), 0, 'the drain deadline must be cleared once close() calls back');
    assert.deepEqual(server.calls, ['close', 'closeIdleConnections']);
});

test('http server cleanup force-closes connections when the drain deadline passes', async () => {
    vi.useFakeTimers();
    const server = createDrainingServer();

    const drained = server.runCleanupHook();

    await vi.advanceTimersByTimeAsync(httpDrainDeadlineMs - 1);
    assert.equal(server.isSettled(), false);
    assert.deepEqual(server.calls, ['close', 'closeIdleConnections']);

    await vi.advanceTimersByTimeAsync(1);
    await drained;

    assert.equal(server.isSettled(), true);
    assert.deepEqual(server.calls, ['close', 'closeIdleConnections', 'closeAllConnections']);
});

test('http server drain deadline stays under the 20 second host drain window', () => {
    assert.equal(httpDrainDeadlineMs, 10_000);
    assert.ok(httpDrainDeadlineMs < 20_000);
});
