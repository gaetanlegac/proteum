const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const coreRoot = path.join(__dirname, '..');
require('module-alias').addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
});
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const {
    indexRouteDefinitions,
    writeGeneratedRouteModule,
} = require('../cli/compiler/common/generatedRouteModules.ts');
const { findClientRouteFiles } = require('../cli/compiler/artifacts/discovery.ts');
const { indexControllers } = require('../cli/compiler/common/controllers.ts');
const {
    defineAction,
    defineController,
    runControllerAction,
    schema,
} = require('../server/app/controller/index.ts');
const { expressHandler, registerRouteDefinition } = require('../common/router/definitions.ts');

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-definition-contracts-'));

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

test('route indexer reads explicit page definitions with static metadata', () => {
    const root = createTempDir();
    const filepath = path.join(root, 'client/pages/index.tsx');

    writeFile(
        filepath,
        `import { definePageRoute } from '@common/router/definitions';

const routePath = '/demo';

export default definePageRoute({
    path: routePath,
    options: { auth: false },
    data: null,
    render: () => null,
});
`,
    );

    const [definition] = indexRouteDefinitions({ side: 'client', sourceFilepath: filepath });

    assert.equal(definition.methodName, 'page');
    assert.equal(definition.path, '/demo');
    assert.equal(definition.targetResolution, 'static-expression');
    assert.equal(definition.hasData, false);
    assert.deepEqual(definition.normalizedOptionKeys, ['auth']);
});

test('route wrapper imports explicit definitions without lifting source helpers', () => {
    const root = createTempDir();
    const sourceFilepath = path.join(root, 'client/pages/index.tsx');
    const outputFilepath = path.join(root, '.proteum/client/route-modules/client/pages/index.tsx');

    writeFile(
        sourceFilepath,
        `import { definePageRoute } from '@common/router/definitions';

const helper = 'must stay in the source module';

export default definePageRoute({
    path: '/wrapped',
    options: {},
    data: null,
    render: () => helper,
});
`,
    );

    writeGeneratedRouteModule({
        outputFilepath,
        runtime: 'client',
        side: 'client',
        sourceFilepath,
        clientRoute: { chunkId: 'client_pages_index' },
    });

    const generated = fs.readFileSync(outputFilepath, 'utf8');

    assert.match(generated, /import __routeDefinition/);
    assert.match(generated, /registerRouteDefinition/);
    assert.doesNotMatch(generated, /must stay in the source module/);
    assert.doesNotMatch(generated, /const \{ Router/);
});

test('route discovery includes explicit route definitions', () => {
    const root = createTempDir();
    const routeFilepath = path.join(root, 'client/pages/index.tsx');
    const helperFilepath = path.join(root, 'client/pages/helpers.tsx');

    writeFile(
        routeFilepath,
        `import { definePageRoute } from '@common/router/definitions';

export default definePageRoute({
    path: '/',
    options: {},
    data: null,
    render: () => null,
});
`,
    );
    writeFile(
        helperFilepath,
        `export const helper = true;
`,
    );

    assert.deepEqual(findClientRouteFiles(path.join(root, 'client/pages')), [routeFilepath]);
});

test('route indexer rejects legacy contextual route imports and top-level router calls', () => {
    const root = createTempDir();
    const filepath = path.join(root, 'server/routes/legacy.ts');

    writeFile(
        filepath,
        `import { Router } from '@app';

Router.get('/legacy', {}, async () => ({ ok: true }));
`,
    );

    assert.throws(
        () => indexRouteDefinitions({ side: 'server', sourceFilepath: filepath }),
        /imports @app/,
    );
});

test('route indexer rejects runtime metadata expressions', () => {
    const root = createTempDir();
    const filepath = path.join(root, 'client/pages/dynamic.tsx');

    writeFile(
        filepath,
        `import { definePageRoute } from '@common/router/definitions';
import runtimeConfig from '../runtimeConfig';

export default definePageRoute({
    path: runtimeConfig.path,
    options: {},
    data: null,
    render: () => null,
});
`,
    );

    assert.throws(
        () => indexRouteDefinitions({ side: 'client', sourceFilepath: filepath }),
        /definePageRoute path must be a serializable static literal or const-only expression/,
    );
});

test('server route factories keep app references inside runtime registration', () => {
    const root = createTempDir();
    const filepath = path.join(root, 'server/routes/api.ts');

    writeFile(
        filepath,
        `import { defineServerRoute, defineServerRoutes } from '@common/router/definitions';

const base = '/api';

export default defineServerRoutes(({ Users }) => [
    defineServerRoute({
        method: 'GET',
        path: base + '/users',
        options: {},
        handler: async () => Users.list(),
    }),
]);
`,
    );

    const [definition] = indexRouteDefinitions({ side: 'server', sourceFilepath: filepath });

    assert.equal(definition.methodName, 'get');
    assert.equal(definition.path, '/api/users');
    assert.equal(definition.targetResolution, 'static-expression');
});

test('route definitions register through explicit router registrar', () => {
    const calls = [];

    registerRouteDefinition(
        {
            registerRouteDefinition: (definition, metadata) => {
                calls.push({ definition, metadata });
            },
        },
        { kind: 'server', method: 'GET', path: '/ready', options: {}, handler: () => true },
        { id: 'route-ready' },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].definition.path, '/ready');
    assert.equal(calls[0].metadata.id, 'route-ready');
    assert.throws(
        () =>
            registerRouteDefinition(
                { get: () => true },
                { kind: 'server', method: 'GET', path: '/ready', options: {}, handler: () => true },
            ),
        /registerRouteDefinition/,
    );
});

test('expressHandler preserves next-based middleware behavior', async () => {
    const response = new EventEmitter();
    let called = false;

    const handler = expressHandler((request, _response, next, context) => {
        assert.equal(request.url, '/health');
        assert.equal(context.marker, 'ctx');
        called = true;
        next();
    });

    await handler({
        marker: 'ctx',
        request: {
            req: { url: '/health' },
            res: response,
        },
    });

    assert.equal(called, true);
});

test('controller definitions parse input through explicit actions', () => {
    const controller = defineController({
        path: 'Example',
        actions: {
            Save: defineAction({
                input: schema.object({ name: schema.string() }),
                handler: ({ input }) => ({ greeting: `Hello ${input.name}` }),
            }),
        },
    });

    const result = runControllerAction(controller.actions.Save, {
        app: {},
        request: { data: { name: 'Proteum' } },
    });

    assert.deepEqual(result, { greeting: 'Hello Proteum' });
});

test('controller indexer rejects legacy controller classes', () => {
    const root = createTempDir();
    const controllersRoot = path.join(root, 'server/controllers');
    const filepath = path.join(controllersRoot, 'Legacy.ts');

    writeFile(
        filepath,
        `import Controller from '@server/app/controller';

export default class Legacy extends Controller {
    public Test() {
        return true;
    }
}
`,
    );

    assert.throws(
        () => indexControllers([{ importPrefix: '@/server/controllers/', root: controllersRoot }]),
        /legacy controller class/,
    );
});
