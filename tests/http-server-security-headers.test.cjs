const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
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

const helmet = require('helmet');

// A fake app root holding the built public files the static middleware serves.
const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-security-headers-'));
fs.mkdirSync(path.join(appRoot, 'bin', 'public'), { recursive: true });
fs.writeFileSync(path.join(appRoot, 'bin', 'public', 'worker.js'), 'self.onmessage = () => {};');
fs.writeFileSync(path.join(appRoot, 'bin', 'public', 'static.html'), '<!doctype html><title>static</title>');
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
let buildContentSecurityPolicyHeaders;
try {
    ({ default: HttpServer } = require('../server/services/router/http/index.ts'));
    ({ buildContentSecurityPolicyHeaders } = require('../server/services/router/http/securityHeaders.ts'));
} finally {
    Module._load = originalLoad;
}

/*----------------------------------
- FIXTURES
----------------------------------*/

// The shape both Unique Domains apps use today.
const legacyCsp = {
    scripts: ['blob:', 'cdn.example.com'],
    styles: ["'self'", "'unsafe-inline'"],
    images: ["'self'", 'data:', 'https:'],
};
const phaseOneDirectives = { 'frame-ancestors': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"] };

const html = (title) => `<!doctype html><title>${title}</title>`;
const renderedPages = new Map();

/** Answers by path, the way the Proteum router answers: pages, JSON, its own 404 and error page. */
const fakeRouterMiddleware = (req, res) => {
    switch (req.path) {
        case '/api':
        case '/api/x/y':
        case '/page':
            return res.send(html(req.path));
        case '/api/v1/x':
            return res.json({ ok: true });
        case '/llms.txt':
            return res.type('text/plain').send('# llms');
        case '/vendor/worker.js':
        case '/api/vendor/worker.js':
            // A worker served by a route, like the agenda map's: it runs under this answer's policy.
            return res.type('text/javascript').send('self.onmessage = () => {};');
        case '/page.xhtml':
            return res.type('application/xhtml+xml').send(html('xhtml'));
        case '/array-content-type':
            res.setHeader('Content-Type', ['text/html; charset=utf-8']);
            return res.end(html('array'));
        case '/api/own-policy':
        case '/own-policy':
            res.setHeader('Content-Security-Policy', "default-src 'none';script-src 'nonce-abc'");
            res.setHeader('Referrer-Policy', 'no-referrer');
            return res.send(html('own'));
        case '/api/cached': {
            // The router's static page cache branch: status, the response headers, then the stored HTML.
            const cached = renderedPages.get(req.path);
            if (!cached) {
                renderedPages.set(req.path, html('cached'));
                return res.send(renderedPages.get(req.path));
            }
            res.status(200);
            res.header({ 'Content-Type': 'text/html; charset=utf-8' });
            return res.send(cached);
        }
        case '/api/throws':
            // The router catches its own errors and renders the error page as HTML.
            try {
                throw new Error('boom');
            } catch {
                return res.status(500).send(html('error'));
            }
        default:
            if (req.path.startsWith('/api/v1/')) return res.status(404).json({ error: 'Not found' });
            return res.status(404).send(html('not found'));
    }
};

const servers = [];

const startServer = async (config = {}) => {
    const app = { env: { name: 'server', profile: 'prod' }, on: () => undefined };
    const router = { app, middleware: fakeRouterMiddleware };
    const server = new HttpServer(
        { domain: 'localhost', port: 0, ssl: false, upload: { maxSize: '1mb' }, csp: legacyCsp, ...config },
        router,
    );
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

    const { port } = server.http.address();
    const request = async (requestPath, init = {}) => {
        const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, { redirect: 'manual', ...init });
        await response.arrayBuffer();
        return response;
    };
    // fetch() adds `Cache-Control: no-cache` to a conditional request, which defeats the 304: plain http here.
    request.revalidate = (requestPath, etag) =>
        new Promise((resolve, reject) => {
            http.get({ host: '127.0.0.1', port, path: requestPath, headers: { 'If-None-Match': etag } }, (res) => {
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(res.headers) }));
            }).on('error', reject);
        });
    return request;
};

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.http.close(resolve))));
    fs.rmSync(appRoot, { recursive: true, force: true });
});

/** What 2.6.1 produced at its second policy mount, for the same legacy config. */
const helmetPolicyOf = (directives) => {
    const headers = {};
    helmet.contentSecurityPolicy({ useDefaults: false, directives })({}, { setHeader: (name, value) => (headers[name] = value) }, () => undefined);
    return headers['Content-Security-Policy'];
};
const legacyPolicy261 = helmetPolicyOf({
    defaultSrc: helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
    scriptSrc: ["'unsafe-inline'", "'self'", "'unsafe-eval'", ...legacyCsp.scripts],
    styleSrc: legacyCsp.styles,
    imgSrc: legacyCsp.images,
});
const helmetDefaultPolicy = helmetPolicyOf(helmet.contentSecurityPolicy.getDefaultDirectives());

const baseHeaders = {
    'strict-transport-security': 'max-age=15552000; includeSubDomains',
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-dns-prefetch-control': 'off',
    'expect-ct': 'max-age=0',
    'x-download-options': 'noopen',
    'x-permitted-cross-domain-policies': 'none',
    'x-xss-protection': '0',
};

const assertBaseHeaders = (response, label) => {
    for (const [name, value] of Object.entries(baseHeaders))
        assert.equal(response.headers.get(name), value, `${label}: ${name}`);
    assert.equal(response.headers.get('x-powered-by'), null, `${label}: x-powered-by must be absent`);
};

const crossOriginHeaders = ['cross-origin-resource-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy'];

/*----------------------------------
- HEADERS BY KIND OF ANSWER
----------------------------------*/

test('an HTML answer under /api carries the app policy and every base header', async () => {
    const request = await startServer();

    for (const requestPath of ['/api', '/api/x/y']) {
        const response = await request(requestPath);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-security-policy'), legacyPolicy261, requestPath);
        assertBaseHeaders(response, requestPath);
    }
});

test('a JSON answer under /api carries the base headers and the fallback policy, no Cross-Origin header', async () => {
    const request = await startServer();

    for (const requestPath of ['/api/v1/x', '/api/v1/missing']) {
        const response = await request(requestPath);
        assert.match(response.headers.get('content-type'), /^application\/json/);
        assert.equal(response.headers.get('content-security-policy'), helmetDefaultPolicy, requestPath);
        assertBaseHeaders(response, requestPath);
        for (const name of crossOriginHeaders) assert.equal(response.headers.get(name), null, `${requestPath}: ${name}`);
    }
});

test('an HTML answer outside /api keeps the 2.6.1 policy, plus the new directives only when configured', async () => {
    const legacy = await startServer();
    const page = await legacy('/page');
    assert.equal(page.headers.get('content-security-policy'), legacyPolicy261);
    assertBaseHeaders(page, '/page');

    const phaseOne = await startServer({ csp: { ...legacyCsp, directives: phaseOneDirectives } });
    const phaseOnePage = await phaseOne('/page');
    assert.equal(
        phaseOnePage.headers.get('content-security-policy'),
        `${legacyPolicy261};frame-ancestors 'self';object-src 'none';base-uri 'self'`,
    );
});

test('a non-HTML router answer outside /api gets the fallback policy', async () => {
    const request = await startServer();
    const response = await request('/llms.txt');
    assert.equal(response.headers.get('content-security-policy'), helmetDefaultPolicy);
    assertBaseHeaders(response, '/llms.txt');
});

test('a route that sets its own policy keeps it, under /api and outside', async () => {
    const request = await startServer({
        csp: { ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"] }, reportUri: '/csp-report' } },
    });

    for (const requestPath of ['/api/own-policy', '/own-policy']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('content-security-policy'), "default-src 'none';script-src 'nonce-abc'", requestPath);
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer', requestPath);
        assert.equal(response.headers.get('content-security-policy-report-only'), null, requestPath);
        assert.equal(response.headers.get('x-powered-by'), null, requestPath);
    }
});

test('a 404 HTML under /api carries the app policy', async () => {
    const request = await startServer();
    const response = await request('/api/unknown/page');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-security-policy'), legacyPolicy261);
    assertBaseHeaders(response, '/api/unknown/page');
});

test('a page served from the static page cache carries the same headers as the first render', async () => {
    const request = await startServer();
    const first = await request('/api/cached');
    const second = await request('/api/cached');

    for (const name of ['content-security-policy', ...Object.keys(baseHeaders)])
        assert.equal(second.headers.get(name), first.headers.get(name), name);
    assert.equal(second.headers.get('content-security-policy'), legacyPolicy261);
    assert.equal(second.headers.get('x-powered-by'), null);
});

test('the server error page under /api carries the app policy', async () => {
    const request = await startServer();
    const response = await request('/api/throws');
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-security-policy'), legacyPolicy261);
    assertBaseHeaders(response, '/api/throws');

});

test('an error that escapes the router to Express keeps its own strict policy', async () => {
    const request = await startServer();
    const consoleError = console.error;
    console.error = () => undefined;
    try {
        // A malformed JSON body fails in the /api body parser, before the router runs.
        const response = await request('/api/v1/x', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{not json',
        });
        assert.equal(response.status, 400);
        assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
        assertBaseHeaders(response, 'malformed JSON under /api');
    } finally {
        console.error = consoleError;
    }
});

test('a 304 carries no policy, so the stored copy keeps the one its 200 came with', async () => {
    const request = await startServer({
        csp: { ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"] } } },
    });

    for (const requestPath of ['/page', '/api', '/api/cached', '/vendor/worker.js', '/api/v1/x']) {
        const first = await request(requestPath);
        const etag = first.headers.get('etag');
        assert.ok(etag, `${requestPath}: an ETag`);

        const revalidated = await request.revalidate(requestPath, etag);
        assert.equal(revalidated.status, 304, requestPath);
        assert.equal(revalidated.headers.get('content-security-policy'), null, requestPath);
        assert.equal(revalidated.headers.get('content-security-policy-report-only'), null, requestPath);
        assertBaseHeaders(revalidated, `${requestPath} 304`);
    }
});

test('a script served by a route carries the app policy, a static script keeps helmet\'s', async () => {
    const request = await startServer({
        csp: { ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"] }, reportUri: '/csp-report' } },
    });

    for (const requestPath of ['/vendor/worker.js', '/api/vendor/worker.js']) {
        const response = await request(requestPath);
        assert.match(response.headers.get('content-type'), /^text\/javascript/);
        assert.equal(response.headers.get('content-security-policy'), legacyPolicy261, requestPath);
        assert.equal(response.headers.get('content-security-policy-report-only'), "default-src 'self';report-uri /csp-report", requestPath);
        assertBaseHeaders(response, requestPath);
    }

    const staticScript = await request('/public/worker.js');
    assert.equal(staticScript.headers.get('content-security-policy'), helmetDefaultPolicy);
});

test('XHTML and a Content-Type set as an array count as documents', async () => {
    const request = await startServer();
    for (const requestPath of ['/page.xhtml', '/array-content-type']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('content-security-policy'), legacyPolicy261, requestPath);
    }
});

test('static files keep helmet headers byte for byte, an HTML file included', async () => {
    const request = await startServer({
        csp: { ...legacyCsp, directives: phaseOneDirectives, reportOnly: { policy: { 'default-src': ["'self'"] } } },
    });

    for (const requestPath of ['/public/worker.js', '/public/static.html', '/ping', '/public/missing.js']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('content-security-policy'), helmetDefaultPolicy, requestPath);
        assert.equal(response.headers.get('content-security-policy-report-only'), null, requestPath);
        assertBaseHeaders(response, requestPath);
    }
});

/*----------------------------------
- CONFIG
----------------------------------*/

test('csp.policy replaces the whole policy, with nothing added by Proteum', async () => {
    const request = await startServer({
        csp: { policy: { 'default-src': ["'self'"], 'script-src': ["'self'", "'unsafe-inline'"], 'upgrade-insecure-requests': [] } },
    });
    const response = await request('/api');
    assert.equal(
        response.headers.get('content-security-policy'),
        "default-src 'self';script-src 'self' 'unsafe-inline';upgrade-insecure-requests",
    );
});

test('csp.reportOnly sends the second header on documents and scripts only, with its report-uri', async () => {
    const request = await startServer({
        csp: { ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"], 'frame-src': ['challenges.example.com'] }, reportUri: '/csp-report' } },
    });

    for (const requestPath of ['/api', '/page', '/api/unknown']) {
        const response = await request(requestPath);
        assert.equal(
            response.headers.get('content-security-policy-report-only'),
            "default-src 'self';frame-src challenges.example.com;report-uri /csp-report",
            requestPath,
        );
        assert.equal(response.headers.get('content-security-policy'), legacyPolicy261, requestPath);
    }

    for (const requestPath of ['/api/v1/x', '/llms.txt', '/ping']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('content-security-policy-report-only'), null, requestPath);
    }
});

test('config.helmet still reaches helmet', async () => {
    const request = await startServer({ helmet: { referrerPolicy: { policy: 'strict-origin-when-cross-origin' } } });

    for (const requestPath of ['/api', '/api/v1/x', '/page', '/public/worker.js']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', requestPath);
    }
});

test('a malformed csp config fails the boot', async () => {
    const bootFailures = [
        [{ policy: { 'default-src': ["'self'"] }, scripts: ['a.example.com'] }, /csp\.policy replaces the whole policy, so scripts must be absent/],
        [{ policy: { 'default-src': ["'self'"] }, directives: { 'object-src': ["'none'"] } }, /directives must be absent/],
        [{ ...legacyCsp, directives: { 'script-src': ['b.example.com'] } }, /legacy lists own/],
        [{ ...legacyCsp, directives: { 'default-src': ["'self'"] } }, /legacy lists own/],
        [{ ...legacyCsp, directives: { frameAncestors: ["'self'"] } }, /unknown directive name "frameAncestors"/],
        [{ ...legacyCsp, directives: { 'frame-ancestor': ["'self'"] } }, /unknown directive name "frame-ancestor"/],
        [{ ...legacyCsp, directives: { 'frame-src': [] } }, /is empty/],
        [{ ...legacyCsp, directives: { 'upgrade-insecure-requests': ['yes'] } }, /takes no value/],
        [{ ...legacyCsp, directives: { 'frame-ancestors': ['self'] } }, /bare word "self"/],
        [{ ...legacyCsp, directives: { 'object-src': ['none'] } }, /bare word "none"/],
        [{ policy: { 'script-src': ["'self"] } }, /unbalanced single quotes/],
        [{ policy: { 'script-src': ["''"] } }, /unbalanced single quotes/],
        [{ ...legacyCsp, directives: { 'frame-ancestors': ['\u2019self\u2019'] } }, /printable ASCII/],
        [{ ...legacyCsp, directives: { 'frame-src': ['a\u0000b'] } }, /printable ASCII/],
        [{ ...legacyCsp, directives: { 'frame-src': ['a.example.com;script-src *'] } }, /no whitespace/],
        [{ ...legacyCsp, directives: { 'frame-src': ['a.example.com b.example.com'] } }, /no whitespace/],
        [{ ...legacyCsp, directives: { 'frame-src': [''] } }, /non-empty source/],
        [{ ...legacyCsp, directives: { 'frame-src': 'a.example.com' } }, /must be an array/],
        [{ scripts: 'a.example.com' }, /csp\.scripts must be an array/],
        [{ scripts: [42] }, /csp\.scripts\[0\] must be a string/],
        [{ scripts: ['\u4f8b\u5b50.com'] }, /printable ASCII/],
        [{ styles: ["'self'"] }, /csp\.scripts is required/],
        [undefined, /csp must be an object/],
        [{ policy: {} }, /csp\.policy has no directive/],
        [{ ...legacyCsp, reportOnly: { policy: {} } }, /reportOnly\.policy has no directive/],
        [{ ...legacyCsp, reportOnly: { reportUri: '/a' } }, /reportOnly\.policy must be an object/],
        [{ ...legacyCsp, reportOnly: { policy: { 'report-uri': ['/a'] }, reportUri: '/b' } }, /report-uri twice/],
        [{ ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"] }, reportUri: '/a b' } }, /reportUri must be/],
        [{ ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"] }, reportUri: '' } }, /reportUri must be/],
    ];

    for (const [csp, message] of bootFailures) {
        assert.throws(() => buildContentSecurityPolicyHeaders(csp), message, JSON.stringify(csp));
    }

    // Valid CSP the checks must not refuse.
    assert.equal(
        buildContentSecurityPolicyHeaders({
            policy: {
                'default-src': ["'self'"],
                'trusted-types': [],
                sandbox: ['allow-scripts'],
                'require-trusted-types-for': ["'script'"],
                'script-src': ["'self'", "'nonce-abc'", "'sha256-AbC+/=='", 'https:', 'wss://relay.example.com', '*.example.com'],
                'report-uri': ['https://example.com/csp?app=web'],
            },
        }).policy,
        "default-src 'self';trusted-types;sandbox allow-scripts;require-trusted-types-for 'script';script-src 'self' 'nonce-abc' 'sha256-AbC+/==' https: wss://relay.example.com *.example.com;report-uri https://example.com/csp?app=web",
    );

    // Through the server itself: start() rejects before it listens.
    const app = { env: { name: 'server', profile: 'prod' }, on: () => undefined };
    const server = new HttpServer(
        { domain: 'localhost', port: 0, ssl: false, upload: { maxSize: '1mb' }, csp: { policy: {}, scripts: [] } },
        { app, middleware: fakeRouterMiddleware },
    );
    await assert.rejects(server.start(), /\[http\.csp\]/);
    assert.equal(server.http.listening, false);
});

test('the legacy serializer matches helmet 4.6 for every legacy list combination', () => {
    const combos = [
        { scripts: [] },
        { scripts: ['a.example.com'], default: ["'self'"] },
        { scripts: ['a.example.com'], default: [], styles: [], images: ["'self'"] },
        { scripts: ['a.example.com'], default: ["'self'", 'https:'], styles: ["'unsafe-inline'"], images: ['data:'] },
        // 2.6 accepted several sources in one entry; helmet joined them with a space.
        { scripts: ['a.example.com b.example.com'], styles: ["'self' 'unsafe-inline'"] },
    ];

    for (const csp of combos) {
        const directives = {
            defaultSrc: csp.default?.length ? csp.default : helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
            scriptSrc: ["'unsafe-inline'", "'self'", "'unsafe-eval'", ...csp.scripts],
        };
        if (csp.styles?.length) directives.styleSrc = csp.styles;
        if (csp.images?.length) directives.imgSrc = csp.images;

        assert.equal(buildContentSecurityPolicyHeaders(csp).policy, helmetPolicyOf(directives), JSON.stringify(csp));
    }
});
