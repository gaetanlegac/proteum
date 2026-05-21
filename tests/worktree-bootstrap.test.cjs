const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const {
    createWorktreeBootstrapDiagnostics,
    getWorktreeBootstrapStatus,
    runWorktreeBootstrapInit,
    worktreeBootstrapMarkerRelativePath,
} = require('../cli/runtime/worktreeBootstrap.ts');

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const createCodexAppRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-worktree-bootstrap-'));
    const appRoot = path.join(root, '.codex', 'worktrees', 'fixture-app');

    fs.mkdirSync(appRoot, { recursive: true });
    return appRoot;
};

const writeBootstrapFixture = (appRoot, { env = true, manifest = true, nodeModules = true } = {}) => {
    writeFile(path.join(appRoot, 'package.json'), '{"name":"fixture"}\n');
    writeFile(path.join(appRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'AGENTS.md'), '# Agents\n');
    if (env) writeFile(path.join(appRoot, '.env'), 'PORT=3020\n');
    if (manifest) writeFile(path.join(appRoot, '.proteum', 'manifest.json'), '{"version":10}\n');
    if (nodeModules) fs.mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
};

const noOpRefresh = async () => ({ stdout: '', stderr: '', summary: 'refresh ok' });
const noOpRuntime = async () => ({ stdout: '', stderr: '', summary: 'runtime ok' });
const noOpDeps = async () => {};

test('worktree bootstrap status blocks Codex worktrees without a marker', () => {
    const appRoot = createCodexAppRoot();
    writeBootstrapFixture(appRoot);

    const status = getWorktreeBootstrapStatus({ appRoot, proteumVersion: 'test' });

    assert.equal(status.guarded, true);
    assert.equal(status.blocking, true);
    assert.equal(status.state, 'missing');
    assert.equal(status.staleReasons[0].code, 'worktree-bootstrap/missing-marker');
});

test('worktree bootstrap init writes a fresh marker with hashes and runtime status', async () => {
    const appRoot = createCodexAppRoot();
    writeBootstrapFixture(appRoot);

    const result = await runWorktreeBootstrapInit({
        appRoot,
        coreRoot,
        proteumVersion: 'test',
        runDependencies: noOpDeps,
        runRefresh: noOpRefresh,
        runRuntimeStatus: noOpRuntime,
    });

    assert.equal(fs.existsSync(path.join(appRoot, worktreeBootstrapMarkerRelativePath)), true);
    assert.equal(result.status.blocking, false);
    assert.equal(result.marker.proteumVersion, 'test');
    assert.equal(result.marker.refresh.status, 'ok');
    assert.equal(result.marker.runtimeStatus.summary, 'runtime ok');
});

test('worktree bootstrap becomes stale when tracked inputs change', async () => {
    const appRoot = createCodexAppRoot();
    writeBootstrapFixture(appRoot);

    await runWorktreeBootstrapInit({
        appRoot,
        coreRoot,
        proteumVersion: 'test',
        runDependencies: noOpDeps,
        runRefresh: noOpRefresh,
        runRuntimeStatus: noOpRuntime,
    });

    writeFile(path.join(appRoot, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');

    const status = getWorktreeBootstrapStatus({ appRoot, proteumVersion: 'test' });

    assert.equal(status.blocking, true);
    assert.equal(
        status.staleReasons.some((reason) => reason.code === 'worktree-bootstrap/package-lock-changed'),
        true,
    );
});

test('worktree bootstrap accepts intentional dependency skips with a reason', async () => {
    const appRoot = createCodexAppRoot();
    writeBootstrapFixture(appRoot, { nodeModules: false });

    const result = await runWorktreeBootstrapInit({
        appRoot,
        coreRoot,
        proteumVersion: 'test',
        reason: 'dependencies are shared by the parent workspace',
        runDependencies: noOpDeps,
        runRefresh: noOpRefresh,
        runRuntimeStatus: noOpRuntime,
        skipDeps: true,
    });

    assert.equal(result.status.blocking, false);
    assert.equal(result.marker.dependencies.status, 'skipped');
    assert.equal(result.marker.skips.dependencies.reason, 'dependencies are shared by the parent workspace');
});

test('worktree bootstrap requires a source env only when .env is missing', async () => {
    const appRoot = createCodexAppRoot();
    writeBootstrapFixture(appRoot, { env: false });

    await assert.rejects(
        () =>
            runWorktreeBootstrapInit({
                appRoot,
                coreRoot,
                proteumVersion: 'test',
                runDependencies: noOpDeps,
                runRefresh: noOpRefresh,
                runRuntimeStatus: noOpRuntime,
            }),
        /missing \.env/,
    );

    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-worktree-source-'));
    writeFile(path.join(sourceRoot, '.env'), 'PORT=3021\n');

    const result = await runWorktreeBootstrapInit({
        appRoot,
        coreRoot,
        proteumVersion: 'test',
        runDependencies: noOpDeps,
        runRefresh: noOpRefresh,
        runRuntimeStatus: noOpRuntime,
        source: sourceRoot,
    });

    assert.equal(fs.readFileSync(path.join(appRoot, '.env'), 'utf8'), 'PORT=3021\n');
    assert.equal(result.marker.env.copied, true);
    assert.equal(result.status.blocking, false);
});

test('worktree bootstrap detects missing env manifest node_modules and version changes', async () => {
    const appRoot = createCodexAppRoot();
    writeBootstrapFixture(appRoot);

    await runWorktreeBootstrapInit({
        appRoot,
        coreRoot,
        proteumVersion: 'test',
        runDependencies: noOpDeps,
        runRefresh: noOpRefresh,
        runRuntimeStatus: noOpRuntime,
    });

    fs.rmSync(path.join(appRoot, '.env'));
    fs.rmSync(path.join(appRoot, '.proteum', 'manifest.json'));
    fs.rmSync(path.join(appRoot, 'node_modules'), { force: true, recursive: true });

    const status = getWorktreeBootstrapStatus({ appRoot, proteumVersion: 'next' });
    const codes = status.staleReasons.map((reason) => reason.code);

    assert.equal(status.blocking, true);
    assert.equal(codes.includes('worktree-bootstrap/env-missing'), true);
    assert.equal(codes.includes('worktree-bootstrap/manifest-missing'), true);
    assert.equal(codes.includes('worktree-bootstrap/node-modules-missing'), true);
    assert.equal(codes.includes('worktree-bootstrap/proteum-version-changed'), true);
});

test('worktree bootstrap bypass keeps status visible without blocking', () => {
    const appRoot = createCodexAppRoot();
    const previous = process.env.PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE;
    process.env.PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE = '1';

    try {
        writeBootstrapFixture(appRoot);
        const status = getWorktreeBootstrapStatus({ appRoot, proteumVersion: 'test' });

        assert.equal(status.bypassed, true);
        assert.equal(status.blocking, false);
        assert.equal(status.state, 'bypassed');
        assert.equal(status.staleReasons.length > 0, true);
        assert.equal(
            createWorktreeBootstrapDiagnostics({ appRoot, status }).some(
                (diagnostic) => diagnostic.code === 'worktree-bootstrap/bypassed',
            ),
            true,
        );
    } finally {
        if (previous === undefined) delete process.env.PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE;
        else process.env.PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE = previous;
    }
});
