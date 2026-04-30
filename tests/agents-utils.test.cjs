const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { configureProjectAgentInstructions, resolveProjectAgentMonorepoRoot } = require('../cli/utils/agents.ts');

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-agents-'));

const createCoreFixture = () => {
    const root = makeTempRoot();
    const agentsRoot = path.join(root, 'agents', 'project');

    writeFile(path.join(agentsRoot, 'AGENTS.md'), '# Root Contract\n\n- Root rule\n');
    writeFile(path.join(agentsRoot, 'CODING_STYLE.md'), '# Coding Style\n\n- Style rule\n');
    writeFile(path.join(agentsRoot, 'client', 'AGENTS.md'), '# Client Rules\n\n- Client rule\n');

    return root;
};

const createAppFixture = () => {
    const appRoot = makeTempRoot();

    for (const dir of ['client/pages', 'server/routes', 'server/services', 'tests/e2e']) {
        fs.mkdirSync(path.join(appRoot, dir), { recursive: true });
    }

    writeFile(
        path.join(appRoot, '.gitignore'),
        [
            'node_modules',
            '# Proteum-managed instruction files',
            '/AGENTS.md',
            '/CODING_STYLE.md',
            '# End Proteum-managed instruction files',
            '/.proteum',
            '',
        ].join('\n'),
    );

    return appRoot;
};

test('standalone configure creates tracked instruction files with embedded corpus', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    const result = configureProjectAgentInstructions({ appRoot, coreRoot });
    const agentsContent = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    const codingStyleContent = fs.readFileSync(path.join(appRoot, 'CODING_STYLE.md'), 'utf8');
    const gitignoreContent = fs.readFileSync(path.join(appRoot, '.gitignore'), 'utf8');

    assert.equal(result.blocked.length, 0);
    assert.match(agentsContent, /^# Proteum Instructions/m);
    assert.match(agentsContent, /<!-- proteum-instructions:start -->/);
    assert.match(agentsContent, /## Source: AGENTS\.md/);
    assert.match(agentsContent, /## Root Contract/);
    assert.match(agentsContent, /## Source: CODING_STYLE\.md/);
    assert.match(codingStyleContent, /## Source: client\/AGENTS\.md/);
    assert.doesNotMatch(agentsContent, /Before reading or applying instructions from this file/);
    assert.doesNotMatch(gitignoreContent, /Proteum-managed instruction files/);
    assert.doesNotMatch(gitignoreContent, /^\/AGENTS\.md$/m);
});

test('configure preserves project content outside the managed section', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();

    writeFile(
        path.join(appRoot, 'AGENTS.md'),
        [
            '# Product Notes',
            '',
            'Keep this product note.',
            '',
            '# Proteum Instructions',
            '<!-- proteum-instructions:start -->',
            '',
            'Old managed content.',
            '',
            '<!-- proteum-instructions:end -->',
            '',
            '# Local Footer',
            '',
            'Keep this footer.',
            '',
        ].join('\n'),
    );

    configureProjectAgentInstructions({ appRoot, coreRoot });

    const content = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    assert.match(content, /# Product Notes/);
    assert.match(content, /Keep this product note\./);
    assert.match(content, /## Source: CODING_STYLE\.md/);
    assert.doesNotMatch(content, /Old managed content/);
    assert.match(content, /# Local Footer/);
    assert.match(content, /Keep this footer\./);
});

test('configure preserves project content around legacy managed stubs', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();

    writeFile(
        path.join(appRoot, 'AGENTS.md'),
        [
            '## Product Bootstrap',
            '',
            'Keep these local bootstrap notes.',
            '',
            '# Proteum Managed Instructions',
            '',
            'This file is managed by `proteum configure agents`.',
            '',
            'Before reading or applying instructions from this file, read and follow the canonical Proteum instruction file at:',
            '',
            '`node_modules/proteum/agents/project/AGENTS.md`',
            '',
            'Resolve that path relative to this file. Treat the canonical file as if its full contents were written here.',
            '',
            'If the canonical file cannot be read, stop and run `npx proteum configure agents` before continuing.',
            '',
            '## Local Footer',
            '',
            'Keep this footer too.',
            '',
        ].join('\n'),
    );

    configureProjectAgentInstructions({ appRoot, coreRoot });

    const content = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    assert.match(content, /## Product Bootstrap/);
    assert.match(content, /Keep these local bootstrap notes\./);
    assert.match(content, /# Proteum Instructions/);
    assert.match(content, /## Source: CODING_STYLE\.md/);
    assert.doesNotMatch(content, /# Proteum Managed Instructions/);
    assert.doesNotMatch(content, /Before reading or applying instructions from this file/);
    assert.match(content, /## Local Footer/);
    assert.match(content, /Keep this footer too\./);
});

test('monorepo configure writes root and app instruction files', () => {
    const coreRoot = createCoreFixture();
    const monorepoRoot = makeTempRoot();
    const appRoot = path.join(monorepoRoot, 'apps', 'product');

    fs.mkdirSync(path.join(monorepoRoot, '.git'));
    fs.mkdirSync(path.join(appRoot, 'client'), { recursive: true });

    const result = configureProjectAgentInstructions({ appRoot, coreRoot, monorepoRoot });

    assert.equal(result.mode, 'monorepo');
    assert.equal(resolveProjectAgentMonorepoRoot(appRoot), fs.realpathSync(monorepoRoot));
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), /## Source: AGENTS\.md/);
    assert.match(fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8'), /## Source: client\/AGENTS\.md/);
});

test('configure migrates legacy managed symlinks to embedded files', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    const installedCoreRoot = createCoreFixture();
    const target = path.join(installedCoreRoot, 'agents', 'project', 'AGENTS.md');
    const linkPath = path.join(appRoot, 'AGENTS.md');

    fs.symlinkSync(target, linkPath);

    const result = configureProjectAgentInstructions({ appRoot, coreRoot });
    const stats = fs.lstatSync(linkPath);
    const content = fs.readFileSync(linkPath, 'utf8');

    assert.equal(result.updated.some((entry) => entry.endsWith('/AGENTS.md')), true);
    assert.equal(stats.isSymbolicLink(), false);
    assert.match(content, /# Proteum Instructions/);
});

test('configure reports blocked paths unless overwrite is allowed', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    const blockedPath = path.join(appRoot, 'CODING_STYLE.md');

    fs.mkdirSync(blockedPath);

    const preview = configureProjectAgentInstructions({ appRoot, coreRoot, dryRun: true });
    assert.equal(preview.blocked.some((entry) => entry.endsWith('/CODING_STYLE.md')), true);

    const result = configureProjectAgentInstructions({
        appRoot,
        coreRoot,
        overwriteBlockedPaths: [blockedPath],
    });

    assert.equal(result.overwritten.some((entry) => entry.endsWith('/CODING_STYLE.md')), true);
    assert.equal(fs.lstatSync(blockedPath).isFile(), true);
    assert.match(fs.readFileSync(blockedPath, 'utf8'), /## Source: AGENTS\.md/);
});
