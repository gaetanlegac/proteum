const assert = require('node:assert/strict');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { buildOrientationResponse, explainOwner } = require('../common/dev/inspection.ts');

const createRoute = (routePath, filepath) => ({
    chunkFilepath: filepath,
    chunkId: filepath.replace(/[^A-Za-z0-9]+/g, '_'),
    codeRaw: routePath,
    filepath,
    hasData: false,
    kind: 'page',
    methodName: 'page',
    normalizedOptionKeys: [],
    path: routePath,
    pathRaw: routePath,
    scope: 'app',
    sourceLocation: { line: 1, column: 1 },
    targetResolution: 'literal',
});

const createManifest = (routes) => ({
    app: {
        coreRoot,
        root: '/tmp/proteum-app',
    },
    commands: [],
    connectedProjects: [],
    controllers: [],
    diagnostics: [],
    layouts: [],
    routes: {
        client: routes,
        server: [],
    },
    services: {
        app: [],
        routerPlugins: [],
    },
});

test('root owner lookup does not match every dynamic route containing a slash', () => {
    const manifest = createManifest([
        createRoute('/domains/:slug((?!tlds$|tld$|sector$)[^/]+)', '/tmp/proteum-app/client/pages/domains/slug.tsx'),
        createRoute('/admin/data/:tab([^/]+)', '/tmp/proteum-app/client/pages/admin/data.tsx'),
    ]);

    assert.deepEqual(explainOwner(manifest, '/').matches, []);
});

test('root owner lookup returns only the literal root route when present', () => {
    const manifest = createManifest([
        createRoute('/domains/:slug((?!tlds$|tld$|sector$)[^/]+)', '/tmp/proteum-app/client/pages/domains/slug.tsx'),
        createRoute('/', '/tmp/proteum-app/client/pages/home.tsx'),
    ]);

    const matches = explainOwner(manifest, '/').matches;

    assert.equal(matches.length, 1);
    assert.equal(matches[0].label, '/');
});

test('orientation guidance of an opted-out app points at its hand-owned instruction file', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-owned-guidance-'));
    fs.mkdirSync(path.join(appRoot, '.git'));
    fs.writeFileSync(path.join(appRoot, 'AGENTS.md'), '# Owned\n');
    const manifest = createManifest([]);
    manifest.app = { coreRoot, root: appRoot, identity: { identifier: 'OwnedApp', name: 'Owned App' }, setup: { agentInstructions: false } };

    const agentsOnly = buildOrientationResponse(manifest, '/').guidance;
    assert.equal(agentsOnly.agents, path.join(appRoot, 'AGENTS.md'));
    assert.equal(agentsOnly.documentation, path.join(appRoot, 'AGENTS.md'));
    assert.deepEqual(agentsOnly.areaAgents, []);

    fs.writeFileSync(path.join(appRoot, 'CLAUDE.md'), '# Owned for Claude\n');
    assert.equal(buildOrientationResponse(manifest, '/').guidance.agents, path.join(appRoot, 'CLAUDE.md'));
});
