const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { rspack } = require('@rspack/core');
const { getClientOutputNames, getClientSourceMapOptions } = require('../cli/compiler/client/outputNames');
const createFileRules = require('../cli/compiler/common/files/autres');
const { resolvePreloadFonts, writeClientManifest } = require('../cli/compiler/common/clientManifest');
const { defaultHttpCacheConfig, resolvePublicAssetCacheControl } = require('../server/services/router/http/cache');

/*----------------------------------
- HARNESS
----------------------------------*/

// A client shaped like a Proteum app: an entry with CSS, a runtime chunk and a lazy page chunk with its own CSS
const writeFixture = (root) => {
    const write = (file, content) => fs.writeFileSync(path.join(root, file), content);
    write('index.js', "import './entry.css';\nimport(/* webpackChunkName: 'pages_domains' */ './page.js').then((page) => page.default());\n");
    write('entry.css', "@font-face { font-family: Brand; src: url('./brand.woff2') format('woff2'); }\nbody { color: #111; }\n");
    write('brand.woff2', 'wOF2 fixture bytes');
    write('page.js', "import './page.css';\nexport default () => document.body.setAttribute('data-page', 'domains');\n");
    write('page.css', '.page { color: #222; }\n');
};

const compile = (root, dev, { sourceMaps = false, preloadFonts = [] } = {}) => {
    const names = getClientOutputNames(dev);
    // `false` keeps the other tests' output free of maps; the source map tests pass the app setting.
    const maps = sourceMaps === false ? { devtool: false } : getClientSourceMapOptions(dev, sourceMaps);
    const compiler = rspack({
        mode: dev ? 'development' : 'production',
        context: root,
        target: 'web',
        devtool: maps.devtool,
        entry: { client: './index.js' },
        output: {
            path: path.join(root, 'public'),
            publicPath: '/public/',
            filename: names.entry,
            chunkFilename: names.chunk,
            ...(maps.sourceMapFilename ? { sourceMapFilename: maps.sourceMapFilename } : {}),
        },
        module: {
            rules: [
                { test: /\.css$/, use: [rspack.CssExtractRspackPlugin.loader, require.resolve('css-loader')], type: 'javascript/auto' },
                // The app compiler's own font rule
                ...createFileRules(undefined, dev, true),
            ],
        },
        plugins: [new rspack.CssExtractRspackPlugin({ filename: names.css, chunkFilename: names.css })],
        optimization: { runtimeChunk: { name: 'runtime' }, minimize: false },
    });

    return new Promise((resolve, reject) =>
        compiler.run((error, stats) => {
            compiler.close(() => {});
            if (error) return reject(error);
            if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
            const { manifest, missingPreloadFonts } = writeClientManifest(stats, root, preloadFonts);
            resolve(Object.assign(manifest, { missingPreloadFonts }));
        }),
    );
};

const cacheControlFor = (asset) =>
    resolvePublicAssetCacheControl({
        res: { req: { originalUrl: `/public/${asset}` } },
        filePath: `/app/bin/public/${asset}`,
        profile: 'prod',
        cache: defaultHttpCacheConfig.publicAssets,
    });

let root;
beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-output-names-'));
    writeFixture(root);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/*----------------------------------
- TESTS
----------------------------------*/

test('production names every client file with a content hash, entries included', async () => {
    const manifest = await compile(root, false);
    const entry = manifest.entries.client;
    const page = manifest.chunks.pages_domains;

    assert.deepEqual(entry.js.map((asset) => asset.replace(/\.[a-f0-9]{8}\.js$/, '.js')), ['runtime.js', 'client.js']);
    assert.deepEqual(entry.css.map((asset) => asset.replace(/\.[a-f0-9]{8}\.css$/, '.css')), ['client.css']);
    assert.match(page.css[0], /^pages_domains\.[a-f0-9]{8}\.css$/);
    assert.match(page.js[0], /^\d+\.[a-f0-9]{8}\.js$/);

    // The stylesheet names the font, which carries its own hash
    const font = fs.readdirSync(path.join(root, 'public', 'fonts'))[0];
    assert.match(font, /^brand\.[a-f0-9]{8}\.woff2$/);
    assert.match(fs.readFileSync(path.join(root, 'public', entry.css[0]), 'utf8'), new RegExp(`fonts/${font.replace('.', '\\.')}`));

    // Every file the HTML names is served immutable, so no browser or CDN keeps an old runtime past a deploy
    for (const asset of [...entry.js, ...entry.css, ...page.js, ...page.css, `fonts/${font}`]) {
        assert.equal(fs.existsSync(path.join(root, 'public', asset)), true, asset);
        assert.equal(cacheControlFor(asset), 'public, max-age=31536000, immutable', asset);
    }
});

test('a content change renames the file that changed and leaves the others alone', async () => {
    const before = await compile(root, false);
    fs.writeFileSync(path.join(root, 'page.css'), '.page { color: #333; }\n');
    const after = await compile(root, false);

    assert.notEqual(after.chunks.pages_domains.css[0], before.chunks.pages_domains.css[0]);
    assert.deepEqual(after.entries.client.css, before.entries.client.css);
});

test('dev keeps the stable names HMR and the dev middleware rely on', async () => {
    const manifest = await compile(root, true);

    assert.deepEqual(manifest.entries.client.js, ['runtime.js', 'client.js']);
    assert.deepEqual(manifest.entries.client.css, ['client.css']);
    assert.deepEqual(manifest.chunks.pages_domains.css, ['pages_domains.css']);
});

test('a declared preload font is written to the manifest by its hashed path, an unknown one is reported', async () => {
    const manifest = await compile(root, false, { preloadFonts: ['brand', 'missing-font'] });
    const font = fs.readdirSync(path.join(root, 'public', 'fonts'))[0];

    assert.deepEqual(manifest.preloadFonts, [{ href: `fonts/${font}`, type: 'font/woff2' }]);
    assert.deepEqual(manifest.missingPreloadFonts, ['missing-font']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'client-manifest.json'), 'utf8')).preloadFonts, manifest.preloadFonts);
});

test('a preload font prefers woff2, and keeps the declaration order', () => {
    const assets = ['fonts/a.0123abcd.woff', 'fonts/a.89abcdef.woff2', 'fonts/b.c.0a1b2c3d.ttf', 'client.1a2b3c4d.js'];

    assert.deepEqual(resolvePreloadFonts(assets, ['b.c', 'a']), {
        preloadFonts: [
            { href: 'fonts/b.c.0a1b2c3d.ttf', type: 'font/ttf' },
            { href: 'fonts/a.89abcdef.woff2', type: 'font/woff2' },
        ],
        missing: [],
        ambiguous: [],
    });
    assert.deepEqual(resolvePreloadFonts(assets).preloadFonts, []);
    // Two source files named alike emit two files of one name: the build cannot tell which to preload.
    assert.deepEqual(resolvePreloadFonts(['fonts/latin.0123abcd.woff2', 'fonts/latin.89abcdef.woff2'], ['latin']).ambiguous, ['latin']);
    // An eot-only font has nothing a browser preloads.
    assert.deepEqual(resolvePreloadFonts(['fonts/old.0123abcd.eot'], ['old']).missing, ['old']);
});

/** Every file under `directory`, relative to it. */
const listFiles = (directory) =>
    fs.existsSync(directory)
        ? fs.readdirSync(directory, { recursive: true }).filter((file) => fs.statSync(path.join(directory, file)).isFile())
        : [];

test('production source maps are hidden by default: written outside public/, named by no script', async () => {
    fs.rmSync(path.join(root, 'public'), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'sourcemaps'), { recursive: true, force: true });
    const manifest = await compile(root, false, { sourceMaps: 'hidden' });

    assert.deepEqual(listFiles(path.join(root, 'public')).filter((file) => file.endsWith('.map')), []);
    for (const script of [...manifest.entries.client.js, ...manifest.chunks.pages_domains.js]) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', script), 'utf8'), /sourceMappingURL/, script);
        assert.equal(fs.existsSync(path.join(root, 'sourcemaps', `${script}.map`)), true, `${script}.map kept for error reports`);
    }
});

test('sourceMaps public serves the maps beside the scripts, as before 2.8; false writes none', async () => {
    fs.rmSync(path.join(root, 'public'), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'sourcemaps'), { recursive: true, force: true });
    const manifest = await compile(root, false, { sourceMaps: 'public' });
    const client = manifest.entries.client.js.find((script) => script.startsWith('client.'));

    assert.equal(fs.existsSync(path.join(root, 'public', `${client}.map`)), true);
    assert.match(fs.readFileSync(path.join(root, 'public', client), 'utf8'), /sourceMappingURL=client\.[a-f0-9]{8}\.js\.map/);
    // The manifest never lists a map as an asset to load.
    assert.equal(manifest.entries.client.assets.some((asset) => asset.endsWith('.map')), false);

    assert.deepEqual(getClientSourceMapOptions(false, false), { devtool: false });
    assert.deepEqual(getClientSourceMapOptions(true, 'hidden'), { devtool: 'eval-cheap-module-source-map' });
});

/*----------------------------------
- THE CLIENT COMPILER'S OWN CONFIG
----------------------------------*/

/**
 * `cli/compiler/client/index.ts` itself, with its neighbours stubbed: what an app gets for each `sourceMaps`
 * setting, `undefined` (the setting left out) first.
 */
const clientCompilerConfig = (setup) => {
    const Module = require('node:module');
    const modulePath = require.resolve('../cli/compiler/client/index.ts');
    const coreRoot = path.join(__dirname, '..');
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-client-config-'));
    const noRules = () => [];
    const stubs = {
        '../common': { __esModule: true, default: () => ({ plugins: [], resolve: {} }), regex: { scripts: /\.tsx?$/, style: /\.css$/ } },
        '../common/bundleAnalysis': { createClientBundleAnalysisPlugins: () => [] },
        '../common/cssMinimizer': { __esModule: true, default: class CssMinimizerStub {} },
        '../common/uiSingletons': { resolveUiSingletonAliases: () => ({}) },
        './identite': { __esModule: true, default: () => Promise.resolve() },
        '../..': {
            __esModule: true,
            default: {
                paths: {
                    framework: { installedRoot: undefined, activeRoot: coreRoot, appNodeModulesRoot: path.join(appRoot, 'node_modules') },
                    getFrameworkRoots: () => [],
                    getVisiblePackageInstallRoots: () => [],
                    resolveRequest: () => '',
                    resolvePackageRoot: () => '',
                },
            },
        },
        '../../runtime/verbose': { logVerbose: () => undefined },
        '../common/scripts': noRules,
        '../common/files/style': noRules,
        '../common/files/images': noRules,
        '../common/files/autres': noRules,
    };
    const app = {
        setup,
        packageJson: {},
        transpileModuleDirectories: [],
        paths: {
            root: appRoot,
            client: { generated: path.join(appRoot, '.proteum/client') },
            common: { generated: path.join(appRoot, '.proteum/common') },
            server: { generated: path.join(appRoot, '.proteum/server') },
        },
        outputPath: () => path.join(appRoot, 'bin'),
        aliases: { client: { forWebpack: () => ({ aliases: {} }) } },
    };
    const originalLoad = Module._load;
    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (parent?.filename === modulePath && request in stubs) return stubs[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const { default: createCompiler } = require(modulePath);
        return createCompiler(app, 'prod');
    } finally {
        Module._load = originalLoad;
        delete require.cache[modulePath];
        fs.rmSync(appRoot, { recursive: true, force: true });
    }
};

test('the production client config hides source maps when the app sets nothing', () => {
    const config = clientCompilerConfig({});

    assert.equal(config.devtool, 'hidden-source-map');
    assert.equal(config.output.sourceMapFilename, '../sourcemaps/[file].map');
    // The helper's own default, with no setting given.
    assert.deepEqual(getClientSourceMapOptions(false), { devtool: 'hidden-source-map', sourceMapFilename: '../sourcemaps/[file].map' });
});

test('the production client config follows sourceMaps public and false', () => {
    const publicConfig = clientCompilerConfig({ sourceMaps: 'public' });
    assert.equal(publicConfig.devtool, 'source-map');
    assert.equal(publicConfig.output.sourceMapFilename, undefined);

    const none = clientCompilerConfig({ sourceMaps: false });
    assert.equal(none.devtool, false);
    assert.equal(none.output.sourceMapFilename, undefined);
});
