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
const previousLessExtension = require.extensions['.less'];
require.extensions['.less'] = () => {};

const clientContextStub = () => ({ side: 'client' });
clientContextStub.default = clientContextStub;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (request === '@/client/context') return clientContextStub;

    return originalLoad.call(this, request, parent, isMain);
};

const previousWindow = global.window;
const previousDocument = global.document;
global.window = {
    dev: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    history: {
        state: {},
        pushState: () => {},
        replaceState: () => {},
    },
    location: {
        hash: '',
        pathname: '/',
        search: '',
        assign: () => {},
    },
};
global.document = { defaultView: global.window };

const {
    default: Application,
    getClientErrorMessage,
    normalizeClientError,
} = require('../client/app/index.ts');

class TestApplication extends Application {
    boot() {}
    handleUpdate() {}
}

test('client error message normalization accepts unknown caught values', () => {
    assert.equal(getClientErrorMessage(new Error('boom'), 'fallback'), 'boom');
    assert.equal(getClientErrorMessage('string failure', 'fallback'), 'string failure');
    assert.equal(getClientErrorMessage({ message: 'object failure' }, 'fallback'), 'object failure');
    assert.equal(getClientErrorMessage({ code: 'UNKNOWN' }, 'fallback'), 'fallback');
});

test('client error normalization returns an Error instance', () => {
    const existing = new Error('existing');

    assert.equal(normalizeClientError(existing), existing);
    assert.equal(normalizeClientError('string failure').message, 'string failure');
    assert.equal(normalizeClientError({ code: 'UNKNOWN' }, 'fallback').message, 'fallback');
});

test('client app handleError logs and returns displayable message', () => {
    const app = new TestApplication();
    const logged = [];
    const originalConsoleError = console.error;
    console.error = (error) => {
        logged.push(error);
    };

    try {
        const message = app.handleError({ code: 'UNKNOWN' }, 'Unable to finish action.');

        assert.equal(message, 'Unable to finish action.');
        assert.equal(logged.length, 1);
        assert.equal(logged[0] instanceof Error, true);
        assert.equal(logged[0].message, 'Unable to finish action.');
    } finally {
        console.error = originalConsoleError;
    }
});

afterAll(() => {
    Module._load = originalLoad;
    if (previousLessExtension === undefined) delete require.extensions['.less'];
    else require.extensions['.less'] = previousLessExtension;
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
});
