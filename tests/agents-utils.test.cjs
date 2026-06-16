const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const {
    configureMonorepoProjectAgentInstructions,
    configureProjectAgentInstructions,
    resolveProjectAgentMonorepoRoot,
} = require('../cli/utils/agents.ts');

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const assertClaudeSymlink = (root, relativeDir = '') => {
    const linkPath = path.join(root, relativeDir, 'CLAUDE.md');
    const stats = fs.lstatSync(linkPath);

    assert.equal(stats.isSymbolicLink(), true, `${linkPath} should be a symlink`);
    assert.equal(fs.readlinkSync(linkPath), 'AGENTS.md');
};

const pathEntryExists = (filepath) => {
    try {
        fs.lstatSync(filepath);
        return true;
    } catch {
        return false;
    }
};

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-agents-'));

const normalizePath = (value) => value.replace(/\\/g, '/');

const createCoreFixture = (root = makeTempRoot()) => {
    const agentsRoot = path.join(root, 'agents', 'project');

    writeFile(path.join(agentsRoot, 'AGENTS.md'), '# Root Contract\n\n- Root rule\n');
    writeFile(path.join(agentsRoot, 'CODING_STYLE.md'), '# Coding Style\n\n- Style rule\n');
    writeFile(path.join(agentsRoot, 'DOCUMENTATION.md'), '# Documentation\n\n- Documentation rule\n');
    writeFile(path.join(agentsRoot, 'diagnostics.md'), '# Diagnostics\n\n- Diagnostics rule\n');
    writeFile(path.join(agentsRoot, 'optimizations.md'), '# Optimizations\n\n- Optimization rule\n');
    writeFile(path.join(agentsRoot, 'client', 'AGENTS.md'), '# Client Rules\n\n- Client rule\n');
    writeFile(path.join(agentsRoot, 'client', 'pages', 'AGENTS.md'), '# Page Rules\n\n- Page rule\n');
    writeFile(path.join(agentsRoot, 'server', 'routes', 'AGENTS.md'), '# Route Rules\n\n- Route rule\n');
    writeFile(path.join(agentsRoot, 'server', 'services', 'AGENTS.md'), '# Service Rules\n\n- Service rule\n');
    writeFile(path.join(agentsRoot, 'tests', 'AGENTS.md'), '# Test Rules\n\n- Test rule\n');
    writeFile(path.join(agentsRoot, 'tests', 'e2e', 'AGENTS.md'), '# E2E Rules\n\n- E2E rule\n');
    writeFile(
        path.join(agentsRoot, 'tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md'),
        '# Real World Journey Tests\n\n- Journey rule\n',
    );

    return root;
};

const expectedSourceMapPath = ({ coreRoot, instructionRoot, projectPath }) =>
    normalizePath(path.relative(instructionRoot, path.join(coreRoot, 'agents', 'project', projectPath)));

const assertSourceMapPath = ({ content, coreRoot, instructionRoot, label, projectPath }) => {
    assert.equal(
        content.includes(`- ${label}: ${expectedSourceMapPath({ coreRoot, instructionRoot, projectPath })}`),
        true,
    );
};

const assertNoAbsoluteCoreSourceMapPath = ({ content, coreRoot }) => {
    assert.equal(content.includes(normalizePath(path.join(coreRoot, 'agents', 'project'))), false);
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
            '/CLAUDE.md',
            '/CODING_STYLE.md',
            '/DOCUMENTATION.md',
            '# End Proteum-managed instruction files',
            '/.proteum',
            '',
        ].join('\n'),
    );

    return appRoot;
};

test('project instruction sources require unit tests for applicable production changes', () => {
    const projectAgentsRoot = path.join(coreRoot, 'agents', 'project');

    assert.match(
        fs.readFileSync(path.join(projectAgentsRoot, 'AGENTS.md'), 'utf8'),
        /production changes must always add or update focused unit tests/,
    );
    assert.match(
        fs.readFileSync(path.join(projectAgentsRoot, 'tests', 'AGENTS.md'), 'utf8'),
        /For every production change, add or update focused unit tests/,
    );
});

test('standalone configure creates tracked instruction files with routing contract and split docs', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    const result = configureProjectAgentInstructions({ appRoot, coreRoot });
    const agentsContent = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    const codingStyleContent = fs.readFileSync(path.join(appRoot, 'CODING_STYLE.md'), 'utf8');
    const documentationContent = fs.readFileSync(path.join(appRoot, 'DOCUMENTATION.md'), 'utf8');
    const gitignoreContent = fs.readFileSync(path.join(appRoot, '.gitignore'), 'utf8');

    assert.equal(result.blocked.length, 0);
    assert.match(agentsContent, /^# Proteum Instructions/m);
    assert.match(agentsContent, /<!-- proteum-instructions:start -->/);
    assert.match(agentsContent, /## Agent Routing Contract/);
    assert.match(agentsContent, /npx proteum runtime status/);
    assert.match(agentsContent, /MCP `workflow_start`/);
    assert.match(agentsContent, /project_resolve \{ cwd \}/);
    assert.match(agentsContent, /instructions_resolve \{ projectId \}/);
    assert.match(agentsContent, /Do not run CLI equivalents after a successful MCP result/);
    assert.match(agentsContent, /Read full files only before edits or git writes/);
    assert.match(agentsContent, /explain_summary/);
    assert.match(agentsContent, /\/__proteum\/mcp/);
    assert.match(agentsContent, /central MCP ready banner/);
    assert.match(agentsContent, /proteum-mcp-v1/);
    assert.match(agentsContent, /## Explicit App-Building Contract/);
    assert.match(agentsContent, /defineApplication\(\{ services, router, models, commands \}\)/);
    assert.match(agentsContent, /definePageRoute\(\{ path, options, data, render \}\)/);
    assert.match(agentsContent, /defineController\(\{ path, actions \}\)/);
    assert.match(agentsContent, /Never import `@app` in page, route, or controller files/);
    assert.match(agentsContent, /Never call top-level `Router\.page\(\.\.\.\)`/);
    assert.match(agentsContent, /## Triggered Instruction Reads/);
    assert.match(agentsContent, /Worktree Preflight/);
    assert.match(agentsContent, /npx proteum worktree init --source <source-app-root>/);
    assert.match(agentsContent, /--skip-deps --reason/);
    assert.match(agentsContent, /Git lifecycle/);
    assert.match(agentsContent, /read Root contract fallback before any git write/);
    assert.match(agentsContent, /Before git writes after a bug fix, behavior change, decision change, or docs-relevant production change/);
    assert.match(agentsContent, /add or update focused unit tests/);
    assert.match(agentsContent, /read Root contract fallback, `DOCUMENTATION\.md`, `CODING_STYLE\.md`, `tests\/AGENTS\.md`/);
    assert.match(agentsContent, /Bug fixes, regressions, incidents, broken public routes, auth\/OAuth failures/);
    assert.match(agentsContent, /docs\/fixes\/YYYY-MM-DD-short-bug-name\.md/);
    assert.match(agentsContent, /GEO\/SEO\/crawler\/structured-data\/AI-source changes/);
    assert.match(agentsContent, /MCP-selected previews are enough/);
    assert.doesNotMatch(agentsContent, /Conventional Commits/);
    assert.match(agentsContent, /They are not deleted/);
    assert.doesNotMatch(agentsContent, /## Source: CODING_STYLE\.md/);
    assert.match(codingStyleContent, /## Source: CODING_STYLE\.md/);
    assert.match(codingStyleContent, /## Coding Style/);
    assert.doesNotMatch(codingStyleContent, /## Source: client\/AGENTS\.md/);
    assert.match(documentationContent, /## Source: DOCUMENTATION\.md/);
    assert.match(documentationContent, /## Documentation/);
    assert.equal(fs.existsSync(path.join(appRoot, 'tests', 'AGENTS.md')), true);
    assert.match(fs.readFileSync(path.join(appRoot, 'tests', 'AGENTS.md'), 'utf8'), /Test rule/);
    assert.equal(fs.existsSync(path.join(appRoot, 'tests', 'e2e', 'AGENTS.md')), true);
    assert.equal(fs.existsSync(path.join(appRoot, 'tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md')), true);
    assert.match(fs.readFileSync(path.join(appRoot, 'tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md'), 'utf8'), /Journey rule/);
    assert.doesNotMatch(fs.readFileSync(path.join(appRoot, 'tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md'), 'utf8'), /## Source: CODING_STYLE\.md/);
    assertClaudeSymlink(appRoot);
    assertClaudeSymlink(appRoot, 'client');
    assertClaudeSymlink(appRoot, 'client/pages');
    assertClaudeSymlink(appRoot, 'server/routes');
    assertClaudeSymlink(appRoot, 'server/services');
    assertClaudeSymlink(appRoot, 'tests');
    assertClaudeSymlink(appRoot, 'tests/e2e');
    assert.doesNotMatch(agentsContent, /Before reading or applying instructions from this file/);
    assert.doesNotMatch(gitignoreContent, /Proteum-managed instruction files/);
    assert.doesNotMatch(gitignoreContent, /^\/AGENTS\.md$/m);
    assert.doesNotMatch(gitignoreContent, /^\/CLAUDE\.md$/m);
    assert.doesNotMatch(gitignoreContent, /^\/DOCUMENTATION\.md$/m);
});

test('standalone configure writes install-relative source map fallbacks', () => {
    const appRoot = createAppFixture();
    const coreRoot = createCoreFixture(path.join(appRoot, 'node_modules', 'proteum'));
    const result = configureProjectAgentInstructions({ appRoot, coreRoot });
    const agentsContent = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');

    assert.equal(result.blocked.length, 0);
    assertSourceMapPath({
        content: agentsContent,
        coreRoot,
        instructionRoot: appRoot,
        label: 'Root contract fallback',
        projectPath: 'AGENTS.md',
    });
    assertSourceMapPath({
        content: agentsContent,
        coreRoot,
        instructionRoot: appRoot,
        label: 'Documentation fallback',
        projectPath: 'DOCUMENTATION.md',
    });
    assertNoAbsoluteCoreSourceMapPath({ content: agentsContent, coreRoot });
    assert.match(agentsContent, /Root contract fallback: node_modules\/proteum\/agents\/project\/AGENTS\.md/);
});

test('standalone configure source map prefers project install over active external core', () => {
    const activeCoreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    createCoreFixture(path.join(appRoot, 'node_modules', 'proteum'));

    configureProjectAgentInstructions({ appRoot, coreRoot: activeCoreRoot });

    const agentsContent = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    assert.match(agentsContent, /Root contract fallback: node_modules\/proteum\/agents\/project\/AGENTS\.md/);
    assert.equal(
        agentsContent.includes(
            `Root contract fallback: ${expectedSourceMapPath({
                coreRoot: activeCoreRoot,
                instructionRoot: appRoot,
                projectPath: 'AGENTS.md',
            })}`,
        ),
        false,
    );
    assertNoAbsoluteCoreSourceMapPath({ content: agentsContent, coreRoot: activeCoreRoot });
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
    assert.match(content, /## Agent Routing Contract/);
    assert.doesNotMatch(content, /## Source: CODING_STYLE\.md/);
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
    assert.match(content, /## Agent Routing Contract/);
    assert.doesNotMatch(content, /## Source: CODING_STYLE\.md/);
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
    fs.mkdirSync(path.join(appRoot, 'server'), { recursive: true });
    writeFile(path.join(appRoot, 'package.json'), '{"name":"product"}\n');
    writeFile(path.join(appRoot, 'identity.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');

    configureProjectAgentInstructions({ appRoot, coreRoot });

    const result = configureProjectAgentInstructions({ appRoot, coreRoot, monorepoRoot });

    assert.equal(result.mode, 'monorepo');
    assert.equal(resolveProjectAgentMonorepoRoot(appRoot), fs.realpathSync(monorepoRoot));
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), /## Agent Routing Contract/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), /## Known Proteum Apps/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), /apps\/product/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), /Eligible Proteum commands run across the apps below/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), /Worktree Preflight/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'CODING_STYLE.md'), 'utf8'), /## Source: CODING_STYLE\.md/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'DOCUMENTATION.md'), 'utf8'), /## Source: DOCUMENTATION\.md/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'diagnostics.md'), 'utf8'), /## Source: diagnostics\.md/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'optimizations.md'), 'utf8'), /## Source: optimizations\.md/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'tests', 'AGENTS.md'), 'utf8'), /## Source: tests\/AGENTS\.md/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'tests', 'e2e', 'AGENTS.md'), 'utf8'), /## Source: tests\/e2e\/AGENTS\.md/);
    assert.match(fs.readFileSync(path.join(monorepoRoot, 'tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md'), 'utf8'), /## Source: tests\/e2e\/REAL_WORLD_JOURNEY_TESTS\.md/);
    assert.doesNotMatch(fs.readFileSync(path.join(monorepoRoot, 'tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md'), 'utf8'), /## Source: CODING_STYLE\.md/);
    assertClaudeSymlink(monorepoRoot);
    assertClaudeSymlink(monorepoRoot, 'tests');
    assertClaudeSymlink(monorepoRoot, 'tests/e2e');
    assert.equal(fs.existsSync(path.join(appRoot, 'tests', 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'tests', 'e2e', 'AGENTS.md')), false);
    assert.equal(pathEntryExists(path.join(appRoot, 'tests', 'CLAUDE.md')), false);
    assert.equal(pathEntryExists(path.join(appRoot, 'tests', 'e2e', 'CLAUDE.md')), false);
    const appAgentsContent = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    assert.match(appAgentsContent, /## Agent Routing Contract/);
    assert.doesNotMatch(appAgentsContent, /## Known Proteum Apps/);
    assert.doesNotMatch(appAgentsContent, /Eligible Proteum commands run across the apps below/);
    assertSourceMapPath({
        content: fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'),
        coreRoot,
        instructionRoot: monorepoRoot,
        label: 'Root contract fallback',
        projectPath: 'AGENTS.md',
    });
    assertSourceMapPath({
        content: appAgentsContent,
        coreRoot,
        instructionRoot: appRoot,
        label: 'Root contract fallback',
        projectPath: 'AGENTS.md',
    });
    assertNoAbsoluteCoreSourceMapPath({ content: fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8'), coreRoot });
    assertNoAbsoluteCoreSourceMapPath({ content: appAgentsContent, coreRoot });
    assert.match(fs.readFileSync(path.join(appRoot, 'client', 'AGENTS.md'), 'utf8'), /## Source: client\/AGENTS\.md/);
    assertClaudeSymlink(appRoot);
    assertClaudeSymlink(appRoot, 'client');
    assert.equal(fs.existsSync(path.join(appRoot, 'CODING_STYLE.md')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'DOCUMENTATION.md')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'diagnostics.md')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'optimizations.md')), false);
    assert.equal(result.removed.some((entry) => entry.endsWith('/apps/product/CODING_STYLE.md')), true);
});

test('monorepo configure source map uses workspace install from root and nested apps', () => {
    const activeCoreRoot = createCoreFixture();
    const monorepoRoot = makeTempRoot();
    const appRoot = path.join(monorepoRoot, 'apps', 'product');

    createCoreFixture(path.join(monorepoRoot, 'node_modules', 'proteum'));
    fs.mkdirSync(path.join(monorepoRoot, '.git'));
    fs.mkdirSync(path.join(appRoot, 'client'), { recursive: true });
    writeFile(path.join(appRoot, 'package.json'), '{"name":"product"}\n');
    writeFile(path.join(appRoot, 'identity.config.ts'), 'export default {};\n');
    writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');

    configureProjectAgentInstructions({ appRoot, coreRoot: activeCoreRoot, monorepoRoot });

    const rootAgentsContent = fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8');
    const appAgentsContent = fs.readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8');
    assert.match(rootAgentsContent, /Root contract fallback: node_modules\/proteum\/agents\/project\/AGENTS\.md/);
    assert.match(appAgentsContent, /Root contract fallback: \.\.\/\.\.\/node_modules\/proteum\/agents\/project\/AGENTS\.md/);
    assertNoAbsoluteCoreSourceMapPath({ content: rootAgentsContent, coreRoot: activeCoreRoot });
    assertNoAbsoluteCoreSourceMapPath({ content: appAgentsContent, coreRoot: activeCoreRoot });
});

test('monorepo-wide configure writes shared root once and all app instruction files', () => {
    const coreRoot = createCoreFixture();
    const monorepoRoot = makeTempRoot();
    const productRoot = path.join(monorepoRoot, 'apps', 'product');
    const websiteRoot = path.join(monorepoRoot, 'apps', 'website');

    for (const appRoot of [productRoot, websiteRoot]) {
        fs.mkdirSync(path.join(appRoot, 'client'), { recursive: true });
        fs.mkdirSync(path.join(appRoot, 'server'), { recursive: true });
        writeFile(path.join(appRoot, 'package.json'), '{"name":"fixture"}\n');
        writeFile(path.join(appRoot, 'identity.config.ts'), 'export default {};\n');
        writeFile(path.join(appRoot, 'proteum.config.ts'), 'export default {};\n');
    }

    const result = configureMonorepoProjectAgentInstructions({
        appRoots: [websiteRoot, productRoot],
        coreRoot,
        monorepoRoot,
    });
    const rootAgentsContent = fs.readFileSync(path.join(monorepoRoot, 'AGENTS.md'), 'utf8');

    assert.equal(result.mode, 'monorepo');
    assert.deepEqual(result.appRoots, [productRoot, websiteRoot]);
    assert.match(rootAgentsContent, /apps\/product/);
    assert.match(rootAgentsContent, /apps\/website/);
    assert.doesNotMatch(rootAgentsContent, /current configured app/);
    assert.match(fs.readFileSync(path.join(productRoot, 'AGENTS.md'), 'utf8'), /## Agent Routing Contract/);
    assert.match(fs.readFileSync(path.join(websiteRoot, 'AGENTS.md'), 'utf8'), /## Agent Routing Contract/);
    assert.equal(fs.existsSync(path.join(productRoot, 'CODING_STYLE.md')), false);
    assert.equal(fs.existsSync(path.join(websiteRoot, 'CODING_STYLE.md')), false);
});

test('monorepo-wide configure dedupes app roots and blocked paths', () => {
    const coreRoot = createCoreFixture();
    const monorepoRoot = makeTempRoot();
    const productRoot = path.join(monorepoRoot, 'apps', 'product');
    const blockedClaudePath = path.join(productRoot, 'CLAUDE.md');

    fs.mkdirSync(path.join(productRoot, 'client'), { recursive: true });
    fs.mkdirSync(path.join(productRoot, 'server'), { recursive: true });
    writeFile(path.join(productRoot, 'package.json'), '{"name":"fixture"}\n');
    writeFile(path.join(productRoot, 'identity.config.ts'), 'export default {};\n');
    writeFile(path.join(productRoot, 'proteum.config.ts'), 'export default {};\n');
    writeFile(blockedClaudePath, '# Local Claude Notes\n');

    const result = configureMonorepoProjectAgentInstructions({
        appRoots: [productRoot, productRoot],
        coreRoot,
        dryRun: true,
        monorepoRoot,
    });

    assert.deepEqual(result.appRoots, [productRoot]);
    assert.equal(result.blocked.filter((entry) => entry === blockedClaudePath).length, 1);
});

test('monorepo configure preserves local app-root documents', () => {
    const coreRoot = createCoreFixture();
    const monorepoRoot = makeTempRoot();
    const appRoot = path.join(monorepoRoot, 'apps', 'product');
    const localCodingStylePath = path.join(appRoot, 'CODING_STYLE.md');

    fs.mkdirSync(path.join(monorepoRoot, '.git'));
    writeFile(localCodingStylePath, '# Local Coding Style\n\n- Keep this app-local override.\n');

    const result = configureProjectAgentInstructions({ appRoot, coreRoot, monorepoRoot });

    assert.match(fs.readFileSync(path.join(monorepoRoot, 'CODING_STYLE.md'), 'utf8'), /## Source: CODING_STYLE\.md/);
    assert.match(fs.readFileSync(localCodingStylePath, 'utf8'), /Keep this app-local override/);
    assert.equal(result.removed.some((entry) => entry.endsWith('/apps/product/CODING_STYLE.md')), false);
});

test('monorepo configure strips retired managed sections from local app-root documents', () => {
    const coreRoot = createCoreFixture();
    const monorepoRoot = makeTempRoot();
    const appRoot = path.join(monorepoRoot, 'apps', 'product');
    const localCodingStylePath = path.join(appRoot, 'CODING_STYLE.md');

    fs.mkdirSync(path.join(monorepoRoot, '.git'));
    fs.mkdirSync(appRoot, { recursive: true });
    configureProjectAgentInstructions({ appRoot, coreRoot });

    const managedContent = fs.readFileSync(localCodingStylePath, 'utf8');
    writeFile(
        localCodingStylePath,
        [
            '# Local Coding Style',
            '',
            '- Keep this app-local override.',
            '',
            managedContent,
        ].join('\n'),
    );

    const result = configureProjectAgentInstructions({ appRoot, coreRoot, monorepoRoot });
    const retainedContent = fs.readFileSync(localCodingStylePath, 'utf8');

    assert.match(retainedContent, /Keep this app-local override/);
    assert.doesNotMatch(retainedContent, /proteum-instructions:start/);
    assert.equal(result.updated.some((entry) => entry.endsWith('/apps/product/CODING_STYLE.md')), true);
});

test('configure migrates legacy managed symlinks to tracked files', () => {
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
    assertClaudeSymlink(appRoot);
});

test('configure migrates one-line Claude pointer files to symlinks', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    const linkPath = path.join(appRoot, 'CLAUDE.md');

    writeFile(linkPath, '@AGENTS.md\n');

    const result = configureProjectAgentInstructions({ appRoot, coreRoot });

    assert.equal(result.updated.some((entry) => entry.endsWith('/CLAUDE.md')), true);
    assertClaudeSymlink(appRoot);
});

test('configure reports blocked Claude companion paths unless overwrite is allowed', () => {
    const coreRoot = createCoreFixture();
    const appRoot = createAppFixture();
    const blockedPath = path.join(appRoot, 'CLAUDE.md');

    writeFile(blockedPath, '# Local Claude Notes\n\n- Keep this local rule.\n');

    const preview = configureProjectAgentInstructions({ appRoot, coreRoot, dryRun: true });
    assert.equal(preview.blocked.some((entry) => entry.endsWith('/CLAUDE.md')), true);

    const blockedResult = configureProjectAgentInstructions({ appRoot, coreRoot });
    assert.equal(blockedResult.blocked.some((entry) => entry.endsWith('/CLAUDE.md')), true);
    assert.equal(fs.lstatSync(blockedPath).isFile(), true);
    assert.match(fs.readFileSync(blockedPath, 'utf8'), /Keep this local rule/);

    const result = configureProjectAgentInstructions({
        appRoot,
        coreRoot,
        overwriteBlockedPaths: [blockedPath],
    });

    assert.equal(result.overwritten.some((entry) => entry.endsWith('/CLAUDE.md')), true);
    assertClaudeSymlink(appRoot);
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
    assert.match(fs.readFileSync(blockedPath, 'utf8'), /## Source: CODING_STYLE\.md/);
});
