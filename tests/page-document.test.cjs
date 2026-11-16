const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const coreRoot = path.join(__dirname, '..');
require('module-alias').addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
    // As in apps: React is Preact's compat layer.
    react: path.join(coreRoot, 'node_modules/preact/compat'),
});
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { h, hydrate } = require('preact');
const { createFakeDocument } = require('./fakeDom.cjs');
const { buildPreloadLinkHeader, dedupePreloads, fontPreloads } = require('../server/services/router/response/page/preloads.ts');

globalThis.__DEV__ = false;
globalThis.BUILD_ID = 'build1';

// The document reads the client manifest beside the server bundle; the test hands it one.
let manifest = {};
const documentModulePath = path.join(coreRoot, 'server/services/router/response/page/document.tsx');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === documentModulePath && request === './clientManifest')
        return { getClientBuildManifest: () => manifest };
    return originalLoad.call(this, request, parent, isMain);
};
let DocumentRenderer;
try {
    ({ default: DocumentRenderer } = require(documentModulePath));
} finally {
    Module._load = originalLoad;
}

/*----------------------------------
- HARNESS
----------------------------------*/

const traces = [];
const createRenderer = (profile = 'prod') => {
    const app = {
        env: { profile },
        identity: { web: { title: 'App' }, author: { name: 'Author' }, maincolor: '#000' },
        container: { Trace: { record: (...args) => traces.push(args) } },
    };
    return new DocumentRenderer({ app, ssrRoutes: [{ code: 404, chunk: 'error_404' }] }, app);
};

const createPage = (overrides = {}) => ({
    chunkId: 'pages_home',
    title: 'Home',
    description: 'The home page',
    bodyClass: new Set(['home']),
    head: [],
    jsonld: [],
    style: [],
    scripts: [{ id: 'pages_home', url: '/public/home.1a2b3c4d.js' }],
    preloads: [],
    data: { rows: [1, 2] },
    route: { options: {} },
    ...overrides,
});

const createResponse = (headers = {}) => ({
    headers,
    canonicalUrl: new URL('https://example.com/'),
    request: { id: 'request1' },
    forSsr: (page) => ({ request: { id: 'request1', data: {} }, page: { chunkId: page.chunkId, data: page.data } }),
});

manifest = {
    publicPath: '/public/',
    entries: { client: { css: ['client.1a2b3c4d.css'], js: ['runtime.1a2b3c4d.js', 'client.1a2b3c4d.js'] } },
};

/*----------------------------------
- PAGE DATA AT THE END OF THE BODY
----------------------------------*/

test('the page data closes the body, after the content, and the head reads no page data', async () => {
    const document = await createRenderer().page('<div id="app">content</div>', createPage(), createResponse());
    const head = document.slice(document.indexOf('<head>'), document.indexOf('</head>'));
    const body = document.slice(document.indexOf('<body'), document.indexOf('</html>'));

    assert.doesNotMatch(head, /window\.ssr|window\.routes/);
    assert.equal(
        body,
        '<body class="home"><div id="app">content</div><script type="text/javascript">' +
            'window.ssr={"request":{"id":"request1","data":{}},"page":{"chunkId":"pages_home","data":{"rows":[1,2]}}}; ' +
            'window.routes=[{"code":404,"chunk":"error_404"}];</script></body>',
    );
    // Every script that reads it is `defer`, so it runs after the parser met the data.
    for (const src of ['/public/runtime.1a2b3c4d.js', '/public/client.1a2b3c4d.js', '/public/home.1a2b3c4d.js']) {
        const tag = head.match(new RegExp(`<script[^>]*src="${src.replace(/\./g, '\\.')}"[^>]*>`));
        assert.ok(tag && / defer[ >]/.test(tag[0]), src);
    }
    // The payload is still traced with its size.
    const payload = traces.find(([, name]) => name === 'ssr.payload');
    assert.ok(payload && payload[2].serializedBytes > 0);
});

test('a dev document still flags window.dev, with the page data', async () => {
    const document = await createRenderer('dev').page('<div></div>', createPage(), createResponse());

    assert.match(document, /window\.routes=\[[^\]]*\];window\.dev = true;<\/script><\/body><\/html>$/);
});

test('an inline page script stays in the head, before the page data, and an async one keeps async', async () => {
    const page = createPage({
        scripts: [
            { id: 'gaConfig', inline: 'window.dataLayer = [];' },
            { id: 'tag', url: 'https://tags.example.com/tag.js', attrs: { async: true } },
        ],
    });
    const document = await createRenderer().page('<main></main>', page, createResponse());
    const head = document.slice(0, document.indexOf('</head>'));

    assert.match(head, /<script type="text\/javascript" id="gaConfig">window\.dataLayer = \[\];<\/script>/);
    assert.match(head, /<script type="text\/javascript" src="https:\/\/tags\.example\.com\/tag\.js" async><\/script>/);
});

test('values in the page data and the JSON-LD can neither close the script nor open a comment', async () => {
    const hostile = '</script><script>alert(document.domain)</script><!--\u2028';
    const page = createPage({ data: { q: hostile }, jsonld: [{ '@type': 'Thing', name: hostile }] });
    const document = await createRenderer().page('<main></main>', page, createResponse());

    assert.equal(document.match(/<\/script>/g).length, document.match(/<script/g).length);
    assert.doesNotMatch(document, /<!--/);
    assert.doesNotMatch(document, /\u2028/);
    // The browser reads the same values back.
    const ssrSource = document.slice(document.lastIndexOf('<script type="text/javascript">') + 31, document.lastIndexOf('</script>'));
    const window = {};
    new Function('window', ssrSource)(window);
    assert.equal(window.ssr.page.data.q, hostile);
    const jsonLd = document.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1];
    assert.equal(JSON.parse(jsonLd)['@graph'][0].name, hostile);
});

test('Preact hydrates the body content and leaves the trailing page data script alone', () => {
    const previousDocument = global.document;
    global.document = createFakeDocument();
    try {
        const body = global.document.createElement('body');
        const app = global.document.createElement('div');
        app.setAttribute('id', 'app');
        app.appendChild(global.document.createTextNode('content'));
        const data = global.document.createElement('script');
        data.appendChild(global.document.createTextNode('window.ssr={}'));
        body.appendChild(app);
        body.appendChild(data);

        // What `client/services/router` does: hydrate the app into `document.body`.
        hydrate(h('div', { id: 'app' }, 'content'), body);

        assert.deepEqual(
            body.childNodes.map((node) => node.localName),
            ['div', 'script'],
        );
        assert.equal(body.childNodes[0], app);
        assert.equal(body.childNodes[1], data);
    } finally {
        global.document = previousDocument;
    }
});

/*----------------------------------
- PRELOADS
----------------------------------*/

test('declared fonts and the page preloads are linked in the head and mirrored in the Link header', async () => {
    manifest = { ...manifest, preloadFonts: [{ href: 'fonts/figtree-latin.1a2b3c4d.woff2', type: 'font/woff2' }] };
    const page = createPage({
        preloads: [
            {
                href: '/public/hero-640.avif',
                as: 'image',
                type: 'image/avif',
                imagesrcset: '/public/hero-640.avif 640w, /public/hero-1280.avif 1280w',
                imagesizes: '(max-width: 640px) 100vw, 640px',
                fetchpriority: 'high',
            },
            // A second call for the same file is dropped.
            { href: '/public/hero-640.avif', as: 'image', imagesrcset: '/public/hero-640.avif 640w, /public/hero-1280.avif 1280w' },
        ],
    });
    const response = createResponse({ Link: '</other>; rel=preconnect' });
    const document = await createRenderer().page('<main></main>', page, response);
    const head = document.slice(0, document.indexOf('</head>'));

    assert.match(
        head,
        /<meta name="viewport" content="width=device-width, initial-scale=1"\/><link rel="preload" href="\/public\/fonts\/figtree-latin\.1a2b3c4d\.woff2" as="font" type="font\/woff2" crossorigin="anonymous"\/><link rel="preload" href="\/public\/hero-640\.avif" as="image" type="image\/avif" imagesrcset="\/public\/hero-640\.avif 640w, \/public\/hero-1280\.avif 1280w" imagesizes="\(max-width: 640px\) 100vw, 640px" fetchpriority="high"\/><meta name="application-name"/,
    );
    assert.equal(head.match(/rel="preload"/g).length, 2);
    // A Link the route set itself is kept, the preloads follow it.
    assert.equal(
        response.headers.Link,
        '</other>; rel=preconnect, ' +
            '</public/fonts/figtree-latin.1a2b3c4d.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous, ' +
            '</public/hero-640.avif>; rel=preload; as=image; type="image/avif"; ' +
            'imagesrcset="/public/hero-640.avif 640w, /public/hero-1280.avif 1280w"; imagesizes="(max-width: 640px) 100vw, 640px"; fetchpriority=high',
    );
});

test('a page with no preload and no declared font sets no Link header', async () => {
    manifest = { ...manifest, preloadFonts: [] };
    const response = createResponse();
    const document = await createRenderer().page('<main></main>', createPage(), response);

    assert.equal(response.headers.Link, undefined);
    assert.doesNotMatch(document, /rel="preload"/);
});

test('a preload Node would refuse in a header stays in the HTML only', () => {
    const preloads = [
        { href: '/public/café.avif', as: 'image' },
        { href: '/public/a.avif', as: 'image', imagesizes: 'calc(100vw\n- 2rem)' },
        { href: '/public/ok.avif', as: 'image', media: '(min-width: "x")' },
    ];

    assert.equal(buildPreloadLinkHeader(preloads), '</public/ok.avif>; rel=preload; as=image; media="(min-width: \\"x\\")"');
    assert.deepEqual(dedupePreloads([{ href: '/a', as: 'image' }, { href: '/a', as: 'fetch' }, { href: '/a', as: 'image' }]).length, 2);
    // Art direction: the same file for another medium is a preload of its own.
    assert.equal(dedupePreloads([{ href: '/a', as: 'image', media: '(max-width: 600px)' }, { href: '/a', as: 'image' }]).length, 2);
    assert.deepEqual(fontPreloads(undefined), []);
});
