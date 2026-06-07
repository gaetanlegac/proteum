const assert = require('node:assert/strict');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';

require('ts-node/register/transpile-only');

const {
    isUiSingletonRequest,
    resolveUiSingletonAliases,
    resolveUiSingletonServerExternalRequest,
} = require('../cli/compiler/common/uiSingletons.ts');

test('UI singleton matcher includes React and Preact runtime packages', () => {
    assert.equal(isUiSingletonRequest('preact'), true);
    assert.equal(isUiSingletonRequest('preact/hooks'), true);
    assert.equal(isUiSingletonRequest('preact-render-to-string'), true);
    assert.equal(isUiSingletonRequest('react'), true);
    assert.equal(isUiSingletonRequest('react-dom/client'), true);
});

test('UI singleton matcher does not match unrelated React-prefixed packages', () => {
    assert.equal(isUiSingletonRequest('react-number-format'), false);
    assert.equal(isUiSingletonRequest('reactive-stream'), false);
    assert.equal(isUiSingletonRequest('@radix-ui/react-popover'), false);
    assert.equal(isUiSingletonRequest(undefined), false);
});

test('UI singleton aliases resolve React imports to Preact runtime requests', () => {
    const seenRequests = [];
    const seenPackageRoots = [];
    const aliases = resolveUiSingletonAliases({
        resolvePackageRoot: (packageName) => {
            seenPackageRoots.push(packageName);
            return `/app/node_modules/${packageName}`;
        },
        resolveRequest: (request) => {
            seenRequests.push(request);
            return `/app/node_modules/${request}`;
        },
    });

    assert.equal(aliases['preact'], '/app/node_modules/preact');
    assert.equal(aliases['preact$'], '/app/node_modules/preact');
    assert.equal(aliases['preact/hooks$'], '/app/node_modules/preact/hooks');
    assert.equal(aliases['react$'], '/app/node_modules/preact/compat');
    assert.equal(aliases['react-dom$'], '/app/node_modules/preact/compat');
    assert.equal(aliases['react-dom/client$'], '/app/node_modules/preact/compat/client');
    assert.equal(aliases['react/jsx-runtime$'], '/app/node_modules/preact/jsx-runtime');
    assert.equal(aliases['preact-render-to-string'], '/app/node_modules/preact-render-to-string');
    assert.equal(aliases['preact-render-to-string$'], '/app/node_modules/preact-render-to-string');
    assert.deepEqual(seenPackageRoots, ['preact', 'preact-render-to-string']);
    assert.equal(
        Object.keys(aliases).indexOf('preact/jsx-dev-runtime$') < Object.keys(aliases).indexOf('preact'),
        true,
    );
    assert.deepEqual(
        seenRequests.filter((request) => request === 'preact-render-to-string'),
        ['preact-render-to-string'],
    );
});

test('UI singleton server externals resolve Preact and React compat requests from the app', () => {
    const seenRequests = [];
    const resolveRequest = (request) => {
        seenRequests.push(request);
        return `/app/node_modules/${request}`;
    };

    assert.equal(resolveUiSingletonServerExternalRequest('preact', resolveRequest), '/app/node_modules/preact');
    assert.equal(
        resolveUiSingletonServerExternalRequest('preact/hooks', resolveRequest),
        '/app/node_modules/preact/hooks',
    );
    assert.equal(
        resolveUiSingletonServerExternalRequest('react', resolveRequest),
        '/app/node_modules/preact/compat',
    );
    assert.equal(
        resolveUiSingletonServerExternalRequest('react/jsx-runtime', resolveRequest),
        '/app/node_modules/preact/jsx-runtime',
    );
    assert.equal(
        resolveUiSingletonServerExternalRequest('react-dom/client', resolveRequest),
        '/app/node_modules/preact/compat/client',
    );
    assert.deepEqual(seenRequests, [
        'preact',
        'preact/hooks',
        'preact/compat',
        'preact/jsx-runtime',
        'preact/compat/client',
    ]);
});

test('UI singleton server externals keep the SSR renderer compiled', () => {
    const resolveRequest = () => {
        throw new Error('should not resolve');
    };

    assert.equal(resolveUiSingletonServerExternalRequest('preact-render-to-string', resolveRequest), undefined);
});
