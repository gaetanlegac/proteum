const assert = require('node:assert/strict');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';

require('ts-node/register/transpile-only');

const {
    isFrameworkSourceContext,
    resolveServerExternalRequest,
} = require('../cli/compiler/server/externals.ts');

test('server external resolution prefers app dependencies outside framework source', () => {
    const optionsSeen = [];
    const resolved = resolveServerExternalRequest({
        context: '/repo/node_modules/@klair/usecases/src/mcp/groups/workers',
        frameworkRoots: ['/framework/core'],
        request: '@prisma/client',
        resolveRequest: (request, options) => {
            optionsSeen.push(options);
            assert.equal(request, '@prisma/client');
            return options.preferApp
                ? '/repo/node_modules/@prisma/client/default.js'
                : '/framework/core/node_modules/@prisma/client/default.js';
        },
    });

    assert.equal(resolved, '/repo/node_modules/@prisma/client/default.js');
    assert.deepEqual(optionsSeen, [{ preferApp: true }]);
});

test('server external resolution prefers framework dependencies for framework source', () => {
    const resolved = resolveServerExternalRequest({
        context: '/framework/core/server',
        frameworkRoots: ['/framework/core'],
        request: 'express',
        resolveRequest: (request, options) => {
            assert.equal(request, 'express');
            return options.preferApp
                ? '/repo/node_modules/express/index.js'
                : '/framework/core/node_modules/express/index.js';
        },
    });

    assert.equal(resolved, '/framework/core/node_modules/express/index.js');
});

test('server external resolution falls back to the bare request when resolution fails', () => {
    const resolved = resolveServerExternalRequest({
        context: '/repo/server',
        frameworkRoots: ['/framework/core'],
        request: 'optional-peer',
        resolveRequest: () => {
            throw new Error('missing');
        },
    });

    assert.equal(resolved, 'optional-peer');
});

test('framework source context matching handles exact and nested roots', () => {
    assert.equal(isFrameworkSourceContext('/framework/core', ['/framework/core']), true);
    assert.equal(isFrameworkSourceContext('/framework/core/server', ['/framework/core']), true);
    assert.equal(isFrameworkSourceContext('/repo/node_modules/@klair/usecases', ['/framework/core']), false);
});
