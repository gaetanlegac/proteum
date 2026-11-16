const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const coreRoot = path.join(__dirname, '..');
require('module-alias').addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
});
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { precompressPublicAssets } = require('../cli/compiler/common/precompress.ts');

// A fake app root holding the built public files, as `proteum build` leaves them.
const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-precompress-'));
const publicRoot = path.join(appRoot, 'bin', 'public');
// Real minified code: a synthetic, very repetitive file compresses better at level 4 than at 11.
const script = fs.readFileSync(path.join(coreRoot, 'node_modules/preact/dist/preact.js'), 'utf8');
const files = {
    'client.1a2b3c4d.js': script,
    'client.1a2b3c4d.css': `.row { color: #111; }\n`.repeat(200),
    'icons/sprite.svg': `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0h24v24H0z"/>'.repeat(100)}</svg>`,
    'data/catalog.json': JSON.stringify({ items: Array.from({ length: 300 }, (_, index) => ({ index })) }),
    // Too small to gain: no twin.
    'tiny.json': '{}',
    // Not text: never compressed.
    'picture.avif': Buffer.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
    'photo.1a2b3c4d.webp': Buffer.alloc(2048, 7),
    'app/favicon.ico': Buffer.from([0, 0, 1, 0]),
    // `.br` inside a name, and an uppercase AVIF extension.
    'vendor/jquery.browser.min.js': script,
    'Photo.AVIF': Buffer.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
    // A gzip file the app ships is a download of its own, never an encoding of its neighbour.
    'downloads/data.csv': 'a,b\n'.repeat(500),
    'downloads/data.csv.gz': zlib.gzipSync('a,b\n'.repeat(500)),
};
for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(publicRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(publicRoot, file), content);
}
// A link the app put in its own public folder (the production build copies it as it is): never followed,
// and a broken one or a loop does not stop the server from starting.
const appOwnPublic = path.join(appRoot, 'public');
fs.mkdirSync(appOwnPublic);
fs.writeFileSync(path.join(appOwnPublic, 'linked.js'), script);
fs.symlinkSync(path.join(appOwnPublic, 'linked.js'), path.join(publicRoot, 'linked.js'));
fs.symlinkSync(path.join(appRoot, 'missing-target.js'), path.join(publicRoot, 'dangling.js'));
fs.symlinkSync(publicRoot, path.join(publicRoot, 'loop'));

globalThis.APP_OUTPUT_DIR = 'bin';
globalThis.__DEV__ = false;

// The app container reads the app's proteum.config.ts at import; the HTTP server only needs its root path.
const httpServerModulePath = path.join(coreRoot, 'server/services/router/http/index.ts');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === httpServerModulePath && request === '@server/app/container') {
        return { __esModule: true, default: { path: { root: appRoot } } };
    }

    return originalLoad.call(this, request, parent, isMain);
};
let HttpServer;
try {
    ({ default: HttpServer } = require('../server/services/router/http/index.ts'));
} finally {
    Module._load = originalLoad;
}

const servers = [];

/** Raw HTTP, so the answer keeps its bytes and no client adds an Accept-Encoding of its own. */
const request = ({ host, port }, requestPath, headers = {}) =>
    new Promise((resolve, reject) => {
        const req = http.request({ host, port, path: requestPath, headers }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
    });

let target;
let report;
beforeAll(async () => {
    report = await precompressPublicAssets(publicRoot);

    // Started after the build step, as in production: the static middleware lists the twins at start.
    const app = { env: { name: 'server', profile: 'prod' }, on: () => undefined };
    const router = { app, middleware: (req, res) => res.status(404).send('not found') };
    const server = new HttpServer({ domain: 'localhost', port: 0, ssl: false, upload: { maxSize: '1mb' }, csp: { scripts: [] } }, router);
    servers.push(server);
    const listening = new Promise((resolve) => server.http.once('listening', resolve));
    const consoleInfo = console.info;
    console.info = () => undefined;
    try {
        await server.start();
        await listening;
    } finally {
        console.info = consoleInfo;
    }
    const address = server.http.address();
    target = { host: address.family === 'IPv6' ? '::1' : '127.0.0.1', port: address.port };
});

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.http.close(resolve))));
    fs.rmSync(appRoot, { recursive: true, force: true });
});

/*----------------------------------
- BUILD STEP
----------------------------------*/

test('the build writes a Brotli 11 twin beside each text file that gains from it, and nothing else', () => {
    const twins = fs
        .readdirSync(publicRoot, { recursive: true })
        // Node's recursive listing follows the `loop` link; the build step does not.
        .filter((file) => file.endsWith('.br') && !file.startsWith('loop/'))
        .sort();

    assert.deepEqual(twins, [
        'client.1a2b3c4d.css.br',
        'client.1a2b3c4d.js.br',
        'data/catalog.json.br',
        'icons/sprite.svg.br',
        'vendor/jquery.browser.min.js.br',
    ]);
    assert.equal(report.written, 5);
    assert.equal(report.skipped, 1);
    assert.ok(report.bytesAfter < report.bytesBefore);
    // The linked file of the app's own public folder is left alone.
    assert.deepEqual(fs.readdirSync(appOwnPublic), ['linked.js']);

    const twin = fs.readFileSync(path.join(publicRoot, 'client.1a2b3c4d.js.br'));
    assert.equal(zlib.brotliDecompressSync(twin).toString(), script);
    // Level 11 beats the level-4 compression a CDN applies on the fly.
    const level4 = zlib.brotliCompressSync(Buffer.from(script), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
    assert.ok(twin.length < level4.length, `${twin.length} < ${level4.length}`);
});

/*----------------------------------
- SERVING
----------------------------------*/

test('a client that accepts br gets the twin, with the type, cache policy and Vary of the file', async () => {
    const response = await request(target, '/public/client.1a2b3c4d.js', { 'Accept-Encoding': 'gzip, deflate, br' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], 'br');
    assert.equal(response.headers['content-type'], 'application/javascript; charset=UTF-8');
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match(response.headers.vary, /Accept-Encoding/);
    assert.equal(zlib.brotliDecompressSync(response.body).toString(), script);

    for (const [file, type, cache] of [
        ['client.1a2b3c4d.css', 'text/css; charset=UTF-8', 'public, max-age=31536000, immutable'],
        ['icons/sprite.svg', 'image/svg+xml', 'public, max-age=0, must-revalidate'],
        ['data/catalog.json', 'application/json; charset=UTF-8', 'public, max-age=0, must-revalidate'],
    ]) {
        const twin = await request(target, `/public/${file}`, { 'Accept-Encoding': 'br' });
        assert.equal(twin.headers['content-encoding'], 'br', file);
        assert.equal(twin.headers['content-type'], type, file);
        assert.equal(twin.headers['cache-control'], cache, file);
        assert.equal(zlib.brotliDecompressSync(twin.body).toString(), files[file], file);
    }
});

test('a client that does not accept br gets the file as before, compressed on the fly if it asks for gzip', async () => {
    const plain = await request(target, '/public/client.1a2b3c4d.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), script);
    assert.match(plain.headers.vary, /Accept-Encoding/);

    const gzip = await request(target, '/public/client.1a2b3c4d.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gzip.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gzip.body).toString(), script);

    // A file without a twin keeps its path through the middlewares.
    const tiny = await request(target, '/public/tiny.json', { 'Accept-Encoding': 'br' });
    assert.equal(tiny.headers['content-encoding'], undefined);
    assert.equal(tiny.body.toString(), '{}');
});

test('the twin and the file revalidate apart: their ETags differ', async () => {
    const twin = await request(target, '/public/client.1a2b3c4d.js', { 'Accept-Encoding': 'br' });
    const plain = await request(target, '/public/client.1a2b3c4d.js');
    assert.ok(twin.headers.etag && plain.headers.etag);
    assert.notEqual(twin.headers.etag, plain.headers.etag);

    const revalidated = await request(target, '/public/client.1a2b3c4d.js', {
        'Accept-Encoding': 'br',
        'If-None-Match': twin.headers.etag,
    });
    assert.equal(revalidated.status, 304);
});

test('an AVIF picture is served as image/avif, uncompressed', async () => {
    const response = await request(target, '/public/picture.avif', { 'Accept-Encoding': 'gzip, br' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/avif');
    assert.equal(response.headers['content-encoding'], undefined);
    assert.equal(response.headers['cache-control'], 'public, max-age=0, must-revalidate');
});

test('a missing file is still a no-store 404 for a client that accepts br', async () => {
    const missing = await request(target, '/public/missing.js', { 'Accept-Encoding': 'br' });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers['cache-control'], 'no-store');
});

test('a name holding .br gets its own twin, and a .gz file is never served as an encoding', async () => {
    const twin = await request(target, '/public/vendor/jquery.browser.min.js', { 'Accept-Encoding': 'br' });
    assert.equal(twin.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(twin.body).toString(), script);

    const csv = await request(target, '/public/downloads/data.csv', { 'Accept-Encoding': 'gzip, br' });
    assert.notEqual(csv.headers['content-encoding'], undefined, 'compression() still compresses it on the fly');
    const decoded = csv.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(csv.body) : zlib.gunzipSync(csv.body);
    assert.equal(decoded.toString(), files['downloads/data.csv']);
});

test('a client that refuses br, in any casing or with *, never gets the twin', async () => {
    const twin = fs.readFileSync(path.join(publicRoot, 'client.1a2b3c4d.js.br'));
    for (const acceptEncoding of ['br;q=0', 'br;Q=0', 'BR;q=0, gzip', '*, br;q=0', 'gzip', 'identity']) {
        const response = await request(target, '/public/client.1a2b3c4d.js', { 'Accept-Encoding': acceptEncoding });
        // (compression() may still pick br on the fly for `br;Q=0`: its own parser reads only a lowercase q.)
        assert.equal(response.body.equals(twin), false, acceptEncoding);
        assert.match(response.headers.vary, /Accept-Encoding/, acceptEncoding);
    }
    const anything = await request(target, '/public/client.1a2b3c4d.js', { 'Accept-Encoding': '*' });
    assert.equal(anything.headers['content-encoding'], 'br');
});

test('an answer that is not the twin carries no Brotli header: other methods, a twin removed after start', async () => {
    const post = await new Promise((resolve, reject) => {
        const req = http.request({ ...target, path: '/public/client.1a2b3c4d.js', method: 'POST', headers: { 'Accept-Encoding': 'br' } }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
    });
    assert.equal(post.status, 404);
    assert.equal(post.headers['content-encoding'], undefined);
    assert.equal(post.headers['cache-control'], 'no-store');

    fs.renameSync(path.join(publicRoot, 'data/catalog.json.br'), path.join(publicRoot, 'data/catalog.json.br.moved'));
    try {
        const response = await request(target, '/public/data/catalog.json', { 'Accept-Encoding': 'br' });
        assert.equal(response.status, 404);
        assert.equal(response.headers['content-encoding'], undefined);
        assert.equal(response.headers['content-type'], undefined);
        assert.equal(response.headers['cache-control'], 'no-store');
    } finally {
        fs.renameSync(path.join(publicRoot, 'data/catalog.json.br.moved'), path.join(publicRoot, 'data/catalog.json.br'));
    }
});

test('a malformed URL answers as before the twins, and an uppercase .AVIF is image/avif', async () => {
    const malformed = await request(target, '/public/%E0%A4%A.js', { 'Accept-Encoding': 'br' });
    assert.notEqual(malformed.status, 200);
    assert.equal(malformed.headers['content-encoding'], undefined);

    const avif = await request(target, '/public/Photo.AVIF', { 'Accept-Encoding': 'gzip, br' });
    assert.equal(avif.headers['content-type'], 'image/avif');
    assert.equal(avif.headers['content-encoding'], undefined);
});
