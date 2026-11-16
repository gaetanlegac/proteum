const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { rspack } = require('@rspack/core');
const { getClientOutputNames, getClientSourceMapOptions } = require('../cli/compiler/client/outputNames');
const createFileRules = require('../cli/compiler/common/files/autres');
const { writeClientManifest } = require('../cli/compiler/common/clientManifest');
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

const compile = (root, dev, { sourceMaps = false } = {}) => {
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
            resolve(writeClientManifest(stats, root));
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
