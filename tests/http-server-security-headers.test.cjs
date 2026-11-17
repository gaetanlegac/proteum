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
fs.mkdirSync(path.join(appRoot, 'bin', 'public', 'app'), { recursive: true });
fs.writeFileSync(path.join(appRoot, 'bin', 'public', 'worker.js'), 'self.onmessage = () => {};');
fs.writeFileSync(path.join(appRoot, 'bin', 'public', 'static.html'), '<!doctype html><title>static</title>');
fs.writeFileSync(path.join(appRoot, 'bin', 'public', 'app', 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
globalThis.APP_OUTPUT_DIR = 'bin';
globalThis.__DEV__ = false;

// `/robots.txt` is served from beside the HTTP module. Created for this file only when absent, removed after.
const robotsDir = path.join(coreRoot, 'server/services/router/http/public');
const robotsFile = path.join(robotsDir, 'robots.txt');
const createdRobotsDir = !fs.existsSync(robotsDir);
const createdRobotsFile = !fs.existsSync(robotsFile);
if (createdRobotsFile) {
    fs.mkdirSync(robotsDir, { recursive: true });
    fs.writeFileSync(robotsFile, 'User-agent: *\n');
}

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
let applyEdgeCachePolicy;
try {
    ({ default: HttpServer } = require('../server/services/router/http/index.ts'));
    ({ buildContentSecurityPolicyHeaders } = require('../server/services/router/http/securityHeaders.ts'));
    ({ applyEdgeCachePolicy } = require('../server/services/router/http/cache.ts'));
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
const reportOnly = { policy: { 'default-src': ["'self'"] }, reportUri: '/csp-report' };
const reportOnlyHeader = "default-src 'self';report-uri /csp-report";
const routeOwnPolicy = "default-src 'none';script-src 'nonce-abc'";
const routeOwnReportOnly = "default-src 'none';report-uri /route-report";

const html = (title) => `<!doctype html><title>${title}</title>`;

/** Answers by path with the write calls the Proteum router makes: pages, JSON, its own 404 and error page. */
const createFakeRouterMiddleware = () => {
    // One static page cache per server.
    const renderedPages = new Map();

    return (req, res) => {
        switch (req.path) {
            case '/api':
            case '/api/x/y':
            case '/page':
                return res.send(html(req.path));
            case '/api/v1/x':
            case '/data.json':
                return res.json({ ok: true });
            case '/llms.txt':
                return res.type('text/plain').send('# llms');
            case '/vendor/worker.js':
            case '/api/vendor/worker.js':
                // A worker served by a route, like the agenda map's: it runs under this answer's policy.
                return res.type('text/javascript').send('self.onmessage = () => {};');
            case '/api/page.xhtml':
                return res.type('application/xhtml+xml').send(html('xhtml'));
            case '/api/array-content-type':
                res.setHeader('Content-Type', ['text/html; charset=utf-8']);
                return res.end(html('array'));
            case '/api/streamed':
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.write('<!doctype html>');
                return res.end('<title>streamed</title>');
            case '/api/write-head':
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end(html('write head'));
            case '/api/no-policy':
                res.removeHeader('Content-Security-Policy');
                return res.send(html('no policy'));
            case '/api/redirect':
            case '/redirect':
                // The router's redirect: a status, a Location, no body.
                res.status(302);
                res.header({ Location: '/page' });
                return res.send();
            case '/api/own-policy':
            case '/own-policy':
                res.setHeader('Content-Security-Policy', routeOwnPolicy);
                res.setHeader('Referrer-Policy', 'no-referrer');
                return res.send(html('own'));
            case '/api/own-report-only':
            case '/own-report-only':
                res.setHeader('Content-Security-Policy-Report-Only', routeOwnReportOnly);
                return res.send(html('own report-only'));
            case '/api/cached':
            case '/cached': {
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
            case '/edge-cached':
            case '/edge-cached-late-cookie': {
                // As the router does for a route with `edgeCache`: the policy applied at send time. A listener
                // registered earlier writes its cookie as the headers leave, through the prototype's setHeader
                // (as the `cookies` package does), out of sight of anything wrapped on the response itself.
                if (req.path === '/edge-cached-late-cookie')
                    require('on-headers')(res, function () {
                        http.OutgoingMessage.prototype.setHeader.call(this, 'Set-Cookie', 'session=member-1');
                    });
                applyEdgeCachePolicy(res, { maxAge: 600 }, { method: req.method, statusCode: 200 });
                return res.send(html(req.path));
            }
            case '/api/throws':
            case '/throws':
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
};

const servers = [];

/** Raw HTTP, so the header list keeps its order and no client adds request headers of its own. */
const send = ({ host, port }, requestPath, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
        const req = http.request({ host, port, path: requestPath, method, headers }, (res) => {
            res.resume();
            res.on('end', () => {
                const rawHeaders = [];
                for (let index = 0; index < res.rawHeaders.length; index += 2)
                    rawHeaders.push([res.rawHeaders[index], res.rawHeaders[index + 1]]);
                resolve({ status: res.statusCode, headers: new Headers(res.headers), rawHeaders });
            });
        });
        req.on('error', reject);
        req.end(body);
    });

const startServer = async (config = {}) => {
    const app = { env: { name: 'server', profile: 'prod' }, on: () => undefined };
    const router = { app, middleware: createFakeRouterMiddleware() };
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

    // Ask the server where it listens: a foreign process on 127.0.0.1 and the same port must never answer.
    const address = server.http.address();
    const target = { host: address.family === 'IPv6' ? '::1' : '127.0.0.1', port: address.port };
    const request = (requestPath, init) => send(target, requestPath, init);
    request.revalidate = async (requestPath) => {
        const first = await request(requestPath);
        const etag = first.headers.get('etag');
        assert.ok(etag, `${requestPath}: an ETag`);
        return await request(requestPath, { headers: { 'If-None-Match': etag } });
    };
    return request;
};

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.http.close(resolve))));
    fs.rmSync(appRoot, { recursive: true, force: true });
    if (createdRobotsFile) fs.rmSync(createdRobotsDir ? robotsDir : robotsFile, { recursive: true, force: true });
});

/** What 2.6.1 produced at its second policy mount, for the same legacy config. */
const helmetPolicyOf = (directives) => {
    const headers = {};
    helmet.contentSecurityPolicy({ useDefaults: false, directives })({}, { setHeader: (name, value) => (headers[name] = value) }, () => undefined);
    return headers['Content-Security-Policy'];
};
const legacyPolicyOf = (csp) => {
    const directives = {
        defaultSrc: csp.default?.length ? csp.default : helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        scriptSrc: ["'unsafe-inline'", "'self'", "'unsafe-eval'", ...csp.scripts],
    };
    if (csp.styles?.length) directives.styleSrc = csp.styles;
    if (csp.images?.length) directives.imgSrc = csp.images;
    return helmetPolicyOf(directives);
};
const legacyPolicy261 = legacyPolicyOf(legacyCsp);
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
const crossOriginHeaders = ['cross-origin-resource-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy'];

const assertBaseHeaders = (response, label, expected = baseHeaders) => {
    for (const [name, value] of Object.entries(expected))
        assert.equal(response.headers.get(name), value, `${label}: ${name}`);
    assert.equal(response.headers.get('x-powered-by'), null, `${label}: x-powered-by must be absent`);
    // helmet 5 and later send these by default; they would refuse Product's images on the website.
    for (const name of crossOriginHeaders) assert.equal(response.headers.get(name), null, `${label}: ${name}`);
};

const assertPolicy = (response, label, policy, reportOnlyValue = null) => {
    assert.equal(response.headers.get('content-security-policy'), policy, `${label}: content-security-policy`);
    assert.equal(response.headers.get('content-security-policy-report-only'), reportOnlyValue, `${label}: report-only`);
};

/*----------------------------------
- HEADERS BY KIND OF ANSWER
----------------------------------*/

test('an HTML answer under /api carries the app policy and every base header', async () => {
    const request = await startServer();

    for (const requestPath of ['/api', '/api/x/y']) {
        const response = await request(requestPath);
        assert.equal(response.status, 200);
        assertPolicy(response, requestPath, legacyPolicy261);
        assertBaseHeaders(response, requestPath);
    }
});

test('a JSON answer under /api carries the base headers and the fallback policy, no Cross-Origin header', async () => {
    const request = await startServer();

    for (const requestPath of ['/api/v1/x', '/api/v1/missing']) {
        const response = await request(requestPath);
        assert.match(response.headers.get('content-type'), /^application\/json/);
        assertPolicy(response, requestPath, helmetDefaultPolicy);
        assertBaseHeaders(response, requestPath);
    }
});

test('an HTML answer outside /api keeps the 2.6.1 policy, plus the new directives only when configured', async () => {
    const legacy = await startServer();
    const page = await legacy('/page');
    assertPolicy(page, '/page', legacyPolicy261);
    assertBaseHeaders(page, '/page');

    const phaseOne = await startServer({ csp: { ...legacyCsp, directives: phaseOneDirectives } });
    const phaseOnePage = await phaseOne('/page');
    assertPolicy(phaseOnePage, '/page phase 1', `${legacyPolicy261};frame-ancestors 'self';object-src 'none';base-uri 'self'`);
});

test('every router answer outside /api carries the app policy, whatever its type', async () => {
    const request = await startServer();

    // The map's worker is a JavaScript answer: a worker takes its policy from its own script's answer.
    const answers = [
        ['/vendor/worker.js', 200],
        ['/llms.txt', 200],
        ['/data.json', 200],
        ['/redirect', 302],
        ['/missing', 404],
        ['/throws', 500],
    ];
    for (const [requestPath, status] of answers) {
        const response = await request(requestPath);
        assert.equal(response.status, status, requestPath);
        assertPolicy(response, requestPath, legacyPolicy261);
        assertBaseHeaders(response, requestPath);
    }
});

test('under /api, other kinds of answer keep the fallback, and every way of writing HTML gets the app policy', async () => {
    const request = await startServer();

    for (const requestPath of ['/api/redirect', '/api/vendor/worker.js']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, helmetDefaultPolicy);
        assertBaseHeaders(response, requestPath);
    }

    for (const requestPath of ['/api/streamed', '/api/write-head', '/api/page.xhtml', '/api/array-content-type']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, legacyPolicy261);
        assertBaseHeaders(response, requestPath);
    }

    const head = await request('/api', { method: 'HEAD' });
    assertPolicy(head, 'HEAD /api', legacyPolicy261);
    assertBaseHeaders(head, 'HEAD /api');

    // A route that removed the policy is left without one.
    const removed = await request('/api/no-policy');
    assertPolicy(removed, '/api/no-policy', null);
    assertBaseHeaders(removed, '/api/no-policy');
});

test('a route that sets its own policy keeps it, under /api and outside', async () => {
    // The referrer value lane B configures, so the route's own `no-referrer` is told apart from helmet's.
    const request = await startServer({
        csp: { ...legacyCsp, reportOnly },
        helmet: { referrerPolicy: { policy: 'strict-origin-when-cross-origin' } },
    });

    for (const requestPath of ['/api/own-policy', '/own-policy']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, routeOwnPolicy);
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer', requestPath);
        assert.equal(response.headers.get('x-powered-by'), null, requestPath);
    }

    for (const requestPath of ['/api', '/page']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', requestPath);
    }

    // A route's own report-only header is kept, beside the app policy.
    for (const requestPath of ['/api/own-report-only', '/own-report-only']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, legacyPolicy261, routeOwnReportOnly);
    }
});

test('a 404 HTML under /api carries the app policy', async () => {
    const request = await startServer();
    const response = await request('/api/unknown/page');
    assert.equal(response.status, 404);
    assertPolicy(response, '/api/unknown/page', legacyPolicy261);
    assertBaseHeaders(response, '/api/unknown/page');
});

test('a page served from the static page cache carries the same headers as the first render', async () => {
    const request = await startServer({ csp: { ...legacyCsp, reportOnly } });

    for (const requestPath of ['/api/cached', '/cached']) {
        const first = await request(requestPath);
        const second = await request(requestPath);

        assertPolicy(first, `${requestPath} first`, legacyPolicy261, reportOnlyHeader);
        assertPolicy(second, `${requestPath} cached`, legacyPolicy261, reportOnlyHeader);
        assertBaseHeaders(second, `${requestPath} cached`);
    }
});

test('the server error page under /api carries the app policy', async () => {
    const request = await startServer({ csp: { ...legacyCsp, reportOnly } });
    const response = await request('/api/throws');
    assert.equal(response.status, 500);
    assertPolicy(response, '/api/throws', legacyPolicy261, reportOnlyHeader);
    assertBaseHeaders(response, '/api/throws');
});

test('a body-parser error under /api, before the router, keeps Express\'s own strict policy', async () => {
    const request = await startServer();
    const consoleError = console.error;
    console.error = () => undefined;
    try {
        const response = await request('/api/v1/x', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{not json',
        });
        assert.equal(response.status, 400);
        assertPolicy(response, 'malformed JSON under /api', "default-src 'none'");
        assertBaseHeaders(response, 'malformed JSON under /api');
    } finally {
        console.error = consoleError;
    }
});

test('a 304 under /api carries no policy; outside /api it carries the app policy, as in 2.6.1', async () => {
    const request = await startServer({ csp: { ...legacyCsp, reportOnly } });

    // Under /api the writer would otherwise leave helmet's default, which would replace a page's policy.
    for (const requestPath of ['/api', '/api/cached', '/api/v1/x']) {
        const revalidated = await request.revalidate(requestPath);
        assert.equal(revalidated.status, 304, requestPath);
        assertPolicy(revalidated, `${requestPath} 304`, null);
        assertBaseHeaders(revalidated, `${requestPath} 304`);
    }

    // Outside /api a 304 carries the same values its 200 carried.
    for (const requestPath of ['/page', '/vendor/worker.js']) {
        const revalidated = await request.revalidate(requestPath);
        assert.equal(revalidated.status, 304, requestPath);
        assertPolicy(revalidated, `${requestPath} 304`, legacyPolicy261, reportOnlyHeader);
        assertBaseHeaders(revalidated, `${requestPath} 304`);
    }
});

/** Each static answer's header list as 2.6.1 sends it, in order; `null` marks a value that changes per run. */
const staticHeaders261 = (extra) => [
    ['Content-Security-Policy', helmetDefaultPolicy],
    ['X-DNS-Prefetch-Control', 'off'],
    ['Expect-CT', 'max-age=0'],
    ['X-Frame-Options', 'SAMEORIGIN'],
    ['Strict-Transport-Security', 'max-age=15552000; includeSubDomains'],
    ['X-Download-Options', 'noopen'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Permitted-Cross-Domain-Policies', 'none'],
    ['Referrer-Policy', 'no-referrer'],
    ['X-XSS-Protection', '0'],
    ...extra,
    ['Date', null],
    ['Connection', 'keep-alive'],
    ['Keep-Alive', 'timeout=5'],
];
const recordedStaticHeaders = {
    '/public/worker.js': staticHeaders261([
        ['Access-Control-Allow-Origin', '*'],
        ['Cache-Control', 'public, max-age=0, must-revalidate'],
        ['Accept-Ranges', 'bytes'],
        ['Last-Modified', null],
        ['ETag', null],
        ['Content-Type', 'application/javascript; charset=UTF-8'],
        ['Content-Length', '26'],
        ['Vary', 'Accept-Encoding'],
    ]),
    '/public/static.html': staticHeaders261([
        ['Access-Control-Allow-Origin', '*'],
        ['Cache-Control', 'public, max-age=0, must-revalidate'],
        ['Accept-Ranges', 'bytes'],
        ['Last-Modified', null],
        ['ETag', null],
        ['Content-Type', 'text/html; charset=UTF-8'],
        ['Content-Length', '36'],
        ['Vary', 'Accept-Encoding'],
    ]),
    '/public/missing.js': [
        ...staticHeaders261([
            ['Access-Control-Allow-Origin', '*'],
            ['Cache-Control', 'no-store'],
        ]),
        ['Transfer-Encoding', 'chunked'],
    ],
    '/ping': staticHeaders261([
        ['Content-Type', 'text/html; charset=utf-8'],
        ['Content-Length', '4'],
        ['ETag', null],
        ['Vary', 'Accept-Encoding'],
    ]),
    '/robots.txt': staticHeaders261([
        ['Accept-Ranges', 'bytes'],
        ['Cache-Control', 'public, max-age=0'],
        ['Last-Modified', null],
        ['ETag', null],
        ['Content-Type', 'text/plain; charset=UTF-8'],
        ['Content-Length', '14'],
        ['Vary', 'Accept-Encoding'],
    ]),
    '/favicon.ico': staticHeaders261([
        ['Accept-Ranges', 'bytes'],
        ['Cache-Control', 'public, max-age=0'],
        ['Last-Modified', null],
        ['ETag', null],
        ['Content-Type', 'image/x-icon'],
        ['Content-Length', '4'],
        ['Vary', 'Accept-Encoding'],
    ]),
};

test('static files keep the 2.6.1 header list byte for byte, names, values and order', async () => {
    // Recorded from the 2.6.1 HttpServer on this harness. Everything configured, so nothing may leak onto them.
    const request = await startServer({ csp: { ...legacyCsp, directives: phaseOneDirectives, reportOnly } });

    for (const [requestPath, expected] of Object.entries(recordedStaticHeaders)) {
        const response = await request(requestPath);
        assert.deepEqual(
            response.rawHeaders.map(([name, value], index) => [name, expected[index]?.[1] === null ? null : value]),
            expected,
            requestPath,
        );
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
    assertPolicy(response, '/api', "default-src 'self';script-src 'self' 'unsafe-inline';upgrade-insecure-requests");
});

test('csp.reportOnly rides wherever the app policy goes, with its report-uri, never on the fallback', async () => {
    const request = await startServer({
        csp: { ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"], 'frame-src': ['challenges.example.com'] }, reportUri: '/csp-report' } },
    });

    for (const requestPath of ['/api', '/page', '/api/unknown', '/llms.txt', '/vendor/worker.js', '/data.json']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, legacyPolicy261, "default-src 'self';frame-src challenges.example.com;report-uri /csp-report");
    }

    for (const requestPath of ['/api/v1/x', '/api/vendor/worker.js', '/ping', '/public/worker.js']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('content-security-policy-report-only'), null, requestPath);
    }
});

test('without csp.reportOnly no answer carries a report-only header', async () => {
    const request = await startServer();

    for (const requestPath of ['/api', '/page', '/vendor/worker.js', '/api/v1/x', '/public/static.html']) {
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

test('X-Powered-By stays off even when helmet is told to keep it', async () => {
    const request = await startServer({ helmet: { hidePoweredBy: false } });

    for (const requestPath of ['/api', '/api/v1/x', '/page', '/public/worker.js']) {
        const response = await request(requestPath);
        assert.equal(response.headers.get('x-powered-by'), null, requestPath);
    }
});

test('with helmet\'s policy turned off, the fallback answers carry none and the others the app policy', async () => {
    const request = await startServer({ helmet: { contentSecurityPolicy: false } });

    for (const requestPath of ['/api/v1/x', '/public/worker.js', '/ping']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, null);
    }

    for (const requestPath of ['/api', '/page', '/vendor/worker.js']) {
        const response = await request(requestPath);
        assertPolicy(response, requestPath, legacyPolicy261);
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
        [{ ...legacyCsp, directives: { 'object-src': ['None'] } }, /bare word "None"/],
        [{ ...legacyCsp, directives: { 'frame-ancestors': ['Self'] } }, /bare word "Self"/],
        [{ policy: { 'script-src': ["'self"] } }, /unbalanced single quotes/],
        [{ policy: { 'script-src': ["''"] } }, /unbalanced single quotes/],
        [{ ...legacyCsp, directives: { 'frame-ancestors': ['’self’'] } }, /printable ASCII/],
        [{ ...legacyCsp, directives: { 'frame-src': ['a\u0000b'] } }, /printable ASCII/],
        [{ ...legacyCsp, directives: { 'frame-src': ['a.example.com;script-src *'] } }, /no whitespace/],
        [{ ...legacyCsp, directives: { 'frame-src': ['a.example.com b.example.com'] } }, /no whitespace/],
        [{ ...legacyCsp, directives: { 'frame-src': [''] } }, /non-empty source/],
        [{ ...legacyCsp, directives: { 'frame-src': 'a.example.com' } }, /must be an array/],
        [{ scripts: 'a.example.com' }, /csp\.scripts must be an array/],
        [{ scripts: [42] }, /csp\.scripts\[0\] must be a string/],
        [{ scripts: ['例子.com'] }, /printable ASCII/],
        [{ scripts: ['café.example.com'] }, /printable ASCII/],
        [{ scripts: [], styles: [''] }, /csp\.styles\[0\] is empty/],
        [{ scripts: [], default: ['   '] }, /csp\.default\[0\] is empty/],
        [{ styles: ["'self'"] }, /csp\.scripts is required/],
        [undefined, /csp must be an object/],
        [{ ...legacyCsp, reportonly: reportOnly }, /csp has unknown keys "reportonly"/],
        [{ ...legacyCsp, directive: phaseOneDirectives }, /csp has unknown keys "directive"/],
        [{ ...legacyCsp, reportOnly: { policy: { 'default-src': ["'self'"] }, reporturi: '/a' } }, /csp\.reportOnly has unknown keys "reporturi"/],
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
                webrtc: ["'block'"],
                'script-src': ["'self'", "'nonce-abc'", "'sha256-AbC+/=='", 'https:', 'wss://relay.example.com', '*.example.com'],
                'report-uri': ['https://example.com/csp?app=web'],
            },
        }).policy,
        "default-src 'self';trusted-types;sandbox allow-scripts;require-trusted-types-for 'script';webrtc 'block';script-src 'self' 'nonce-abc' 'sha256-AbC+/==' https: wss://relay.example.com *.example.com;report-uri https://example.com/csp?app=web",
    );

    // The four lists keep their 2.6 leniency: a bare keyword is not checked there.
    assert.equal(buildContentSecurityPolicyHeaders({ scripts: [], styles: ['self'] }).policy, "script-src 'unsafe-inline' 'self' 'unsafe-eval';style-src self");

    // Through the server itself: start() rejects before it listens.
    const app = { env: { name: 'server', profile: 'prod' }, on: () => undefined };
    const server = new HttpServer(
        { domain: 'localhost', port: 0, ssl: false, upload: { maxSize: '1mb' }, csp: { policy: {}, scripts: [] } },
        { app, middleware: createFakeRouterMiddleware() },
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
        // 2.6 accepted several sources in one entry, spaces as written; helmet joined the entries with a space.
        { scripts: ['a.example.com b.example.com'], styles: ["'self'  'unsafe-inline'"], images: [' data:'] },
    ];

    for (const csp of combos) {
        assert.equal(buildContentSecurityPolicyHeaders(csp).policy, legacyPolicyOf(csp), JSON.stringify(csp));
    }
});

/*----------------------------------
- EDGE CACHE GUARD
----------------------------------*/

test('the HTTP server turns an edge-cached answer private when a cookie leaves with its headers', async () => {
    const request = await startServer();
    const consoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const late = await request('/edge-cached-late-cookie');
        assert.equal(late.headers.get('set-cookie'), 'session=member-1');
        assert.equal(late.headers.get('cache-control'), 'private, no-store');
        assert.equal(late.headers.get('surrogate-control'), 'no-store');
        assert.match(warnings.join('\n'), /Not cacheable at the edge: \/edge-cached-late-cookie sets a cookie as its headers are written/);

        // Without the cookie, the policy leaves as applied.
        const clean = await request('/edge-cached');
        assert.equal(clean.headers.get('set-cookie'), null);
        assert.equal(clean.headers.get('cache-control'), 'public, max-age=0, s-maxage=600');
    } finally {
        console.warn = consoleWarn;
    }
});
