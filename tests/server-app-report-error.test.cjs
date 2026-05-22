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

const appContainerStub = {
    Environment: {
        profile: 'test',
        connectedProjects: [],
    },
    Identity: {},
    Setup: {},
    Console: {
        createBugReport: () => {},
    },
    Trace: {
        finishRequest: () => {},
        record: () => {},
        releaseRequest: () => {},
    },
    handleBug: () => {},
};

const applicationModulePath = path.join(coreRoot, 'server/app/index.ts');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === applicationModulePath && request === './container') {
        return { __esModule: true, default: appContainerStub };
    }

    return originalLoad.call(this, request, parent, isMain);
};

let Application;
try {
    Application = require('../server/app/index.ts').Application;
} finally {
    Module._load = originalLoad;
}

class TestApplication extends Application {}

const createAppWithHooks = (hooks) => {
    const app = new TestApplication();
    app.hooks = hooks;

    return app;
};

test('server application reports plain errors through the default error hook', async () => {
    const events = [];
    const request = { id: 'request-1' };
    const app = createAppWithHooks({
        error: [
            async (error, hookRequest) => {
                events.push({
                    hook: 'error',
                    message: error.message,
                    requestId: hookRequest.id,
                });
            },
        ],
    });

    await app.reportError(new Error('boom'), request);

    assert.deepEqual(events, [{ hook: 'error', message: 'boom', requestId: 'request-1' }]);
});

test('server application reports HTTP errors through code-specific hooks', async () => {
    const events = [];
    const error = new Error('missing');
    error.http = 404;
    const request = { id: 'request-404' };
    const app = createAppWithHooks({
        'error.404': [
            async (hookError, hookRequest) => {
                events.push({
                    hook: 'error.404',
                    message: hookError.message,
                    requestId: hookRequest.id,
                });
            },
        ],
    });

    await app.reportError(error, request);

    assert.deepEqual(events, [{ hook: 'error.404', message: 'missing', requestId: 'request-404' }]);
});

test('server application reports status errors through code-specific hooks', async () => {
    const events = [];
    const error = new Error('forbidden');
    error.status = 403;
    const app = createAppWithHooks({
        'error.403': [
            async (hookError) => {
                events.push({
                    hook: 'error.403',
                    message: hookError.message,
                });
            },
        ],
    });

    await app.reportError(error);

    assert.deepEqual(events, [{ hook: 'error.403', message: 'forbidden' }]);
});

test('server application normalizes non-error rejections before reporting', async () => {
    const messages = [];
    const app = createAppWithHooks({
        error: [
            async (error) => {
                messages.push(error.message);
            },
        ],
    });

    await app.reportError('string failure');
    await app.reportError({ reason: 'unknown failure' });

    assert.deepEqual(messages, ['string failure', 'Unknown application error']);
});
