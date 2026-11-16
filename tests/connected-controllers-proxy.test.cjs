const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

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
    createConnectedControllerNode,
    isDerivableConnectedController,
} = require('../common/router/request/connectedControllers.ts');

/** An API client that records each fetcher it is asked for. */
const createRecordingApi = () => {
    const calls = [];
    return {
        calls,
        createFetcher: (method, httpPath, data, options) => {
            const fetcher = { method, path: httpPath, data, options };
            calls.push(fetcher);
            return fetcher;
        },
    };
};

/*----------------------------------
- THE NODE
----------------------------------*/

test('a connected leaf posts to /api/<accessor with slashes> with its connected target', () => {
    const api = createRecordingApi();
    const Product = createConnectedControllerNode(api, 'Product');

    const fetcher = Product.Domains.search.Find({ query: 'abc' });

    assert.deepEqual(fetcher, {
        method: 'POST',
        path: '/api/Domains/search/Find',
        data: { query: 'abc' },
        options: {
            connected: { controllerAccessor: 'Domains.search.Find', httpPath: '/api/Domains/search/Find', namespace: 'Product' },
        },
    });
    // A leaf without input is called without data, as the literal leaf passed `undefined`.
    assert.equal(Product.Account.api.GetUsage().data, undefined);
});

test('a written leaf wins over the derived path, at any depth', () => {
    const api = createRecordingApi();
    const custom = () => api.createFetcher('POST', '/api/custom/path', undefined, { connected: { namespace: 'Product' } });
    const Product = createConnectedControllerNode(api, 'Product', { Legacy: { Read: custom }, then: { Run: custom } });

    assert.equal(Product.Legacy.Read, custom);
    assert.equal(Product.Legacy.Read().path, '/api/custom/path');
    // Siblings of a written leaf keep the derived path.
    assert.equal(Product.Legacy.Other().path, '/api/Legacy/Other');
    // A guarded key the contract really uses is reachable through the literal tree.
    assert.equal(Product.then.Run().path, '/api/custom/path');
});

test('awaiting, resolving or serialising a node never calls a controller', async () => {
    const api = createRecordingApi();
    const Product = createConnectedControllerNode(api, 'Product');

    // A Proxy that answered `then` would be awaited as a promise and call `then(resolve, reject)`.
    assert.equal(Product.then, undefined);
    assert.equal(Product.Domains.then, undefined);
    // Each read builds a fresh node, so the same node is kept to compare.
    const domains = Product.Domains;
    assert.equal(await domains, domains);
    assert.equal(await Promise.resolve(Product), Product);
    assert.equal(Product.toJSON, undefined);
    assert.equal(JSON.stringify({ Product }), '{}');
    assert.equal(JSON.stringify(Product.Domains), undefined);
    // Coercing a node for a log line reads it as a function, not as a call.
    assert.match(String(Product.Domains), /function|=>/);
    assert.match(`${Product.Domains.search}`, /function|=>/);
    assert.equal(typeof Product.Domains.call, 'function');
    assert.equal(Product[Symbol.toPrimitive], undefined);
    assert.equal(Product[Symbol.iterator], undefined);
    assert.equal(api.calls.length, 0);
});

test('enumerating or spreading a node lists nothing, and the root stays a plain object to spread', () => {
    const api = createRecordingApi();
    const Product = createConnectedControllerNode(api, 'Product');
    const root = { Local: { Ping: () => 'pong' }, Product };

    assert.deepEqual(Object.keys(Product), []);
    assert.deepEqual({ ...Product.Domains }, {});
    const forInKeys = [];
    for (const key in Product) forInKeys.push(key);
    assert.deepEqual(forInKeys, []);

    // Apps spread the controllers into the router context (server/services/router/response/index.ts).
    const context = { ...root };
    assert.equal(context.Product, Product);
    assert.equal(context.Product.Domains.Find().path, '/api/Domains/Find');
    assert.equal(api.calls.length, 1);
});

test('only leaves on POST /api/<accessor with slashes>, with no reserved segment, are derivable', () => {
    assert.equal(isDerivableConnectedController('Domains.search.Find', '/api/Domains/search/Find'), true);
    assert.equal(isDerivableConnectedController('Domains.search.Find', '/api/domains/search/find'), false);
    assert.equal(isDerivableConnectedController('Domains.Find', '/custom/Domains/Find'), false);
    for (const reserved of ['then', 'toJSON', 'toString', 'call', 'name', 'constructor', 'caller'])
        assert.equal(isDerivableConnectedController(`Domains.${reserved}`, `/api/Domains/${reserved}`), false, reserved);
});

/*----------------------------------
- THE GENERATOR
----------------------------------*/

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

/** Runs the controllers generator against a temp app with one local controller and the given connected contract. */
const generateControllers = async (connectedControllers) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-connected-controllers-'));
    const appRoot = path.join(root, 'app');
    const generatedRoot = path.join(appRoot, '.proteum');
    writeFile(
        path.join(appRoot, 'server/controllers/Local.ts'),
        `import { defineAction, defineController, schema } from '@generated/server/controller';

export default defineController({
    path: 'Local',
    actions: {
        Ping: defineAction({ handler: () => 'pong' }),
        Save: defineAction({ input: schema.object({ name: schema.string() }), handler: ({ input }) => input.name }),
    },
});
`,
    );

    const written = {};
    const appStub = {
        paths: {
            root: appRoot,
            proteum: generatedRoot,
            common: { generated: path.join(generatedRoot, 'common') },
            client: { generated: path.join(generatedRoot, 'client') },
            server: { generated: path.join(generatedRoot, 'server') },
        },
        identity: { identifier: 'TestApp' },
        connectedProjects: connectedControllers ? { Product: {} } : {},
    };
    const contracts = connectedControllers
        ? [
              {
                  namespace: 'Product',
                  cachedContractFilepath: path.join(generatedRoot, 'connected/Product.json'),
                  contract: { identity: { identifier: 'Product' }, controllers: connectedControllers },
                  sourceKind: 'file',
                  sourceValue: path.join(root, 'product'),
                  typingMode: 'local-typed',
                  typeImportModuleSpecifier: '@proteum-connected/Product',
              },
          ]
        : [];

    const modulePath = require.resolve('../cli/compiler/artifacts/controllers.ts');
    const stubs = {
        '../../app': { __esModule: true, default: appStub },
        '../..': { __esModule: true, default: { paths: { core: { root: path.join(root, 'core') } } } },
        './connectedProjects': {
            resolveConnectedProjectContracts: async () => contracts,
            writeConnectedProjectContract: () => undefined,
        },
        '../writeIfChanged': { __esModule: true, default: (filepath, content) => (written[filepath] = content) },
    };
    const originalLoad = Module._load;
    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (parent?.filename === modulePath && request in stubs) return stubs[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const { generateControllerArtifacts } = require(modulePath);
        const result = await generateControllerArtifacts();
        return { result, content: written[path.join(generatedRoot, 'common', 'controllers.ts')] };
    } finally {
        Module._load = originalLoad;
        delete require.cache[modulePath];
        fs.rmSync(root, { recursive: true, force: true });
    }
};

/** Evaluates the generated `createControllers` with the real Proxy node and a recording API client. */
const evaluateControllers = (content) => {
    const { outputText } = ts.transpileModule(content, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request === '@common/router/request/connectedControllers') return require('../common/router/request/connectedControllers.ts');
        throw new Error(`Unexpected runtime import in the generated controllers: ${request}`);
    };
    new Function('module', 'exports', 'require', outputText)(module, module.exports, localRequire);
    const api = createRecordingApi();
    return { api, controllers: module.exports.createControllers(api) };
};

const connectedLeaf = (clientAccessor, httpPath = '/api/' + clientAccessor.split('.').join('/'), hasInput = true) => ({
    className: 'C',
    importPath: '@/server/controllers/C',
    relativeFilepath: 'server/controllers/C.ts',
    sourceLocation: { line: 1, column: 1 },
    routeBasePath: '',
    methodName: clientAccessor.split('.').pop(),
    inputCallsCount: hasInput ? 1 : 0,
    hasInput,
    routePath: httpPath.replace(/^\/api\//, ''),
    httpPath,
    clientAccessor,
});

test('the generator emits one Proxy node per connected namespace and keeps local controllers written out', async () => {
    const leaves = Array.from({ length: 40 }, (_, index) => connectedLeaf(`Area${index}.section.Action${index}`));
    const { content, result } = await generateControllers(leaves);

    // Local controllers: the literal tree, typed as before.
    assert.match(content, /"Local": \{\n        "Ping": \(\) => api\.createFetcher<TControllerActionResult<Controller0, "Ping">>\('POST', "\/api\/Local\/Ping", undefined\)/);
    assert.match(content, /"Save": \(data: TControllerActionInput<Controller0, "Save">\) => api\.createFetcher/);
    // Connected: one node, none of the 40 leaves spelt out, the namespace typed from the contract.
    assert.match(content, /"Product": createConnectedControllerNode\(api, "Product", undefined\) as TControllers\["Product"\]/);
    assert.doesNotMatch(content, /Area\d+/);
    assert.match(content, /import \{ createConnectedControllerNode \} from '@common\/router\/request\/connectedControllers';/);
    assert.match(content, /export type TControllers = \{[\s\S]*"Product": ConnectedControllers_Product,/);
    // The manifest still lists every connected leaf.
    assert.equal(result.controllers.filter((controller) => controller.scope === 'connected').length, 40);

    const { api, controllers } = evaluateControllers(content);
    assert.equal(controllers.Local.Ping().path, '/api/Local/Ping');
    assert.deepEqual(controllers.Product.Area7.section.Action7({ q: 1 }), {
        method: 'POST',
        path: '/api/Area7/section/Action7',
        data: { q: 1 },
        options: { connected: { controllerAccessor: 'Area7.section.Action7', httpPath: '/api/Area7/section/Action7', namespace: 'Product' } },
    });
    assert.deepEqual(Object.keys(controllers), ['Local', 'Product']);
    assert.equal(api.calls.length, 2);
});

test('the generator writes out a connected leaf whose path is not derivable, and nothing else of its namespace', async () => {
    const { content } = await generateControllers([
        connectedLeaf('Domains.Find'),
        connectedLeaf('Legacy.Read', '/api/legacy-read', false),
        connectedLeaf('Jobs.then.Run'),
    ]);

    assert.match(content, /"Product": createConnectedControllerNode\(api, "Product", \{/);
    assert.match(content, /"Read": \(\) => api\.createFetcher<.+?>\('POST', "\/api\/legacy-read", undefined, \{ connected: \{"controllerAccessor":"Legacy\.Read","httpPath":"\/api\/legacy-read","namespace":"Product"\} \}\)/);
    assert.match(content, /"then": \{\n\s+"Run": \(data: any\) =>/);
    assert.doesNotMatch(content, /Domains/);

    const { controllers } = evaluateControllers(content);
    assert.equal(controllers.Product.Legacy.Read().path, '/api/legacy-read');
    assert.equal(controllers.Product.Jobs.then.Run().path, '/api/Jobs/then/Run');
    assert.equal(controllers.Product.Domains.Find().path, '/api/Domains/Find');
});

test('an app without connected projects keeps the generated client it had, with no Proxy import', async () => {
    const { content } = await generateControllers(undefined);

    assert.doesNotMatch(content, /createConnectedControllerNode/);
    assert.match(content, /export const createControllers = \(\n    api: Pick<ApiClient, 'createFetcher'>\n\): TControllers => \(\n\{\n    "Local": \{/);
});
