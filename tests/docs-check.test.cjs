const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');
require('../cli/context.ts');

const { buildDocsCheckReport } = require('../cli/commands/docs.ts');

const createRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-docs-check-'));

const writeFile = (root, filepath, content) => {
    const full = path.join(root, filepath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
};

const kinds = (report, kind) => report.findings.filter((finding) => finding.kind === kind);

test('docs check accepts anchors that resolve against the corpus', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(
        root,
        'apps/product/server/controllers/search.ts',
        '/**\n * @docs docs/features/search\n */\nexport default {};\n',
    );

    const report = buildDocsCheckReport(root);

    assert.equal(kinds(report, 'unresolved-anchor').length, 0);
    assert.equal(kinds(report, 'orphan-feature-pack').length, 0);
    assert.equal(report.anchoredFiles, 1);
});

test('docs check reports an anchor pointing at a deleted document', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(
        root,
        'apps/product/server/controllers/search.ts',
        '/**\n * @docs docs/features/deleted\n */\nexport default {};\n',
    );

    const report = buildDocsCheckReport(root);
    const unresolved = kinds(report, 'unresolved-anchor');

    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].detail, '@docs docs/features/deleted');
});

test('docs check resolves anchors from an app that owns a nested docs directory', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(root, 'apps/product/docs/fixes/local.md', '# Local\n');
    writeFile(
        root,
        'apps/product/server/controllers/search.ts',
        '/**\n * @docs docs/features/search\n */\nexport default {};\n',
    );

    assert.equal(kinds(buildDocsCheckReport(root), 'unresolved-anchor').length, 0);
});

test('docs check resolves anchors aimed at the repo corpus when run from an app root', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(
        root,
        'apps/product/server/controllers/search.ts',
        '/**\n * @docs docs/features/search\n */\nexport default {};\n',
    );

    // Running from the app root must not orphan an anchor that points at the
    // repository-level corpus one directory up.
    const report = buildDocsCheckReport(path.join(root, 'apps', 'product'));

    assert.equal(kinds(report, 'unresolved-anchor').length, 0);
    assert.equal(report.anchoredFiles, 1);
});

test('docs check resolves an adr anchor against the decisions corpus', () => {
    const root = createRoot();
    writeFile(root, 'docs/decisions/ADR-0004-page-query-contracts.md', '# ADR-0004\n');
    writeFile(root, 'apps/product/server/controllers/search.ts', '/**\n * @adr ADR-0004\n */\nexport default {};\n');

    assert.equal(kinds(buildDocsCheckReport(root), 'unresolved-anchor').length, 0);
});

test('docs check reports an adr anchor matching no decision record', () => {
    const root = createRoot();
    writeFile(root, 'docs/decisions/ADR-0004-page-query-contracts.md', '# ADR-0004\n');
    writeFile(root, 'apps/product/server/controllers/search.ts', '/**\n * @adr ADR-9999\n */\nexport default {};\n');

    const unresolved = kinds(buildDocsCheckReport(root), 'unresolved-anchor');

    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].detail, '@adr ADR-9999');
});

test('docs check reports an adr identifier shared by two decision records', () => {
    const root = createRoot();
    writeFile(root, 'docs/decisions/ADR-0010-catalog-provenance.md', '# ADR-0010\n');
    writeFile(root, 'docs/decisions/ADR-0010-visual-system.md', '# ADR-0010\n');
    writeFile(root, 'apps/product/server/controllers/search.ts', '/**\n * @adr ADR-0010\n */\nexport default {};\n');

    const ambiguous = kinds(buildDocsCheckReport(root), 'ambiguous-anchor');

    assert.equal(ambiguous.length, 1);
    assert.equal(/matches 2 records/.test(ambiguous[0].detail), true);
});

test('docs check stays silent about adr anchors when a project has no decisions corpus', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(root, 'apps/product/server/controllers/search.ts', '/**\n * @adr ADR-0004\n */\nexport default {};\n');

    assert.equal(kinds(buildDocsCheckReport(root), 'unresolved-anchor').length, 0);
});

test('docs check reports a fix note whose invariant no code anchors', () => {
    const root = createRoot();
    writeFile(root, 'docs/fixes/2026-06-14-watchdog.md', '# Fix\n\n## Agent warning\n\nDo not remove the guards.\n');
    writeFile(root, 'apps/daemon/src/rdap.ts', 'export default {};\n');

    const unanchored = kinds(buildDocsCheckReport(root), 'unanchored-fix-note');

    assert.equal(unanchored.length, 1);
    assert.equal(unanchored[0].subject, 'docs/fixes/2026-06-14-watchdog.md');
});

test('docs check clears a fix note once code anchors it', () => {
    const root = createRoot();
    writeFile(root, 'docs/fixes/2026-06-14-watchdog.md', '# Fix\n\n## Agent warning\n\nDo not remove the guards.\n');
    writeFile(
        root,
        'apps/daemon/src/rdap.ts',
        '/**\n * @fix  docs/fixes/2026-06-14-watchdog.md\n * @rule Do not remove the guards.\n */\nexport default {};\n',
    );

    assert.equal(kinds(buildDocsCheckReport(root), 'unanchored-fix-note').length, 0);
});

test('docs check reports a feature pack that no code points at', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(root, 'docs/features/orphan/README.md', '# Orphan\n');
    writeFile(
        root,
        'apps/product/server/controllers/search.ts',
        '/**\n * @docs docs/features/search\n */\nexport default {};\n',
    );

    const orphans = kinds(buildDocsCheckReport(root), 'orphan-feature-pack');

    assert.deepEqual(orphans.map((finding) => finding.subject), ['docs/features/orphan']);
});

test('docs check ignores generated and vendored directories', () => {
    const root = createRoot();
    writeFile(root, 'docs/features/search/README.md', '# Search\n');
    writeFile(
        root,
        'node_modules/some-package/index.ts',
        '/**\n * @docs docs/features/nope\n */\nexport default {};\n',
    );
    writeFile(root, 'apps/product/var/generated.ts', '/**\n * @docs docs/features/nope\n */\nexport default {};\n');

    const report = buildDocsCheckReport(root);

    assert.equal(kinds(report, 'unresolved-anchor').length, 0);
    assert.equal(report.anchoredFiles, 0);
});
