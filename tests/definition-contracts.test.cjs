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
const Service = require('../server/app/service/index.ts').default;
const { expressHandler, registerRouteDefinition } = require('../common/router/definitions.ts');
const { parseProteumEnvConfig } = require('../common/env/proteumEnv.ts');

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-definition-contracts-'));

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const loadServiceArtifactsForAppRoot = (appRoot) => {
    const Module = require('node:module');
    const modulePath = require.resolve('../cli/compiler/artifacts/services.ts');
    const originalLoad = Module._load;
    const appStub = { paths: { root: appRoot }, identity: { identifier: 'TestApp' }, containerServices: [] };
    const cliStub = { paths: { core: { root: coreRoot } } };

    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (parent?.filename === modulePath && request === '../../app') {
            return { __esModule: true, default: appStub };
        }
        if (parent?.filename === modulePath && request === '../..') {
            return { __esModule: true, default: cliStub };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
};

const withProteumEnv = (env, run) => {
    const previous = {};
    for (const key of Object.keys(env)) previous[key] = process.env[key];

    Object.assign(process.env, env);

    try {
        return run();
    } finally {
        for (const key of Object.keys(env)) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
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

test('router port override updates absolute runtime URLs', () => {
    const root = createTempDir();

    const config = withProteumEnv(
        {
            ENV_NAME: 'local',
            ENV_PROFILE: 'dev',
            PORT: '3010',
            URL: 'http://localhost:3010',
            URL_INTERNAL: 'http://localhost:3010',
        },
        () =>
            parseProteumEnvConfig({
                appDir: root,
                routerPortOverride: 3100,
            }),
    );

    assert.equal(config.router.port, 3100);
    assert.equal(config.router.currentDomain, 'http://localhost:3100');
    assert.equal(config.router.internalUrl, 'http://localhost:3100');
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

test('service model accessor prefers explicit Models service without recursing through inherited app getter', () => {
    class ModelConsumer extends Service {}

    const app = Object.create(Service.prototype);
    app.app = app;
    app.Models = { client: { model: true } };

    const service = new ModelConsumer(app, {}, app);

    assert.deepEqual(service.models, { model: true });
});

test('controller action context reads Models service without recursing through inherited app getter', () => {
    const app = Object.create(Service.prototype);
    app.app = app;
    app.Models = { client: { model: true } };

    const controller = defineController({
        path: 'Example',
        actions: {
            ReadModels: defineAction({
                handler: ({ models }) => models,
            }),
        },
    });

    const result = runControllerAction(controller.actions.ReadModels, {
        app,
        request: { data: {} },
    });

    assert.deepEqual(result, { model: true });
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

test('service artifact parser reads defineApplication router factories', () => {
    const root = createTempDir();
    const filepath = path.join(root, 'server/index.ts');
    const { parseAppBootstrapSource } = loadServiceArtifactsForAppRoot(root);

    writeFile(
        filepath,
        `import { defineApplication } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';

export default defineApplication({
    router: (app) => new Router(
        app,
        {
            plugins: {
                schema: new SchemaRouter({}, app),
            },
        },
        app,
    ),
});
`,
    );

    const bootstrap = parseAppBootstrapSource(filepath);

    assert.deepEqual(bootstrap.rootServices.map((service) => service.registeredName), ['Router']);
    assert.deepEqual(bootstrap.routerPlugins.map((service) => service.registeredName), ['schema']);
});

test('service artifact parser reads named defineApplication router factories', () => {
    const root = createTempDir();
    const filepath = path.join(root, 'server/index.ts');
    const { parseAppBootstrapSource } = loadServiceArtifactsForAppRoot(root);

    writeFile(
        filepath,
        `import { defineApplication } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';

const createRouter = (app) => new Router(
    app,
    {
        plugins: {
            schema: new SchemaRouter({}, app),
        },
    },
    app,
);

const App = defineApplication({
    router: createRouter,
});

export default App;
`,
    );

    const bootstrap = parseAppBootstrapSource(filepath);

    assert.deepEqual(bootstrap.rootServices.map((service) => service.registeredName), ['Router']);
    assert.deepEqual(bootstrap.routerPlugins.map((service) => service.registeredName), ['schema']);
});
