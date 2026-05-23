const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
const cliBin = path.join(coreRoot, 'cli', 'bin.js');

process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { buildChangedVerificationPlan, runChangedVerification } = require('../cli/verification/changed.ts');

const createRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-verify-changed-'));

const writeFile = (root, filepath, content = '') => {
    const fullPath = path.join(root, filepath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
};

const planCommands = (plan) => plan.selectedChecks.map((check) => check.command);
const planIds = (plan) => plan.selectedChecks.map((check) => check.id);

test('changed verification planner runs changed test files directly', () => {
    const root = createRoot();
    writeFile(root, 'tests/unit/session.test.ts', 'test("session", () => {});\n');

    const plan = buildChangedVerificationPlan({
        cwd: root,
        changedFiles: ['tests/unit/session.test.ts'],
    });

    assert.deepEqual(planCommands(plan), ["npx vitest run 'tests/unit/session.test.ts'"]);
    assert.deepEqual(plan.selectedChecks[0].matchedFiles, ['tests/unit/session.test.ts']);
});

test('changed verification planner runs related tests for source files', () => {
    const root = createRoot();
    writeFile(root, 'packages/auth/src/session.ts', 'export const session = true;\n');

    const plan = buildChangedVerificationPlan({
        cwd: root,
        changedFiles: ['packages/auth/src/session.ts'],
    });

    assert.deepEqual(planCommands(plan), ["npx vitest related 'packages/auth/src/session.ts'"]);
    assert.deepEqual(plan.selectedChecks[0].matchedFiles, ['packages/auth/src/session.ts']);
});

test('changed verification planner loads project config and applies Klair-style MCP rules', () => {
    const root = createRoot();
    writeFile(
        root,
        'proteum.verify.config.ts',
        `import { defineVerificationConfig } from 'proteum/config';

export default defineVerificationConfig({
    suites: {
        mcpFast: 'npm run test:mcp:fast',
        mcpBranches: 'npm run test:mcp:branches',
    },
    rules: [
        {
            id: 'mcp-fast',
            match: ['packages/mcp/src/**', 'packages/2_usecases/src/mcp-v7/**'],
            run: ['mcpFast'],
            reason: 'MCP behavior changed.',
        },
        {
            id: 'mcp-branches',
            match: [
                'packages/mcp/src/**/catalog*.ts',
                'packages/mcp/src/**/dispatcher*.ts',
                'packages/mcp/src/**/fallback*.ts',
                'packages/mcp/src/**/validation*.ts',
                'packages/2_usecases/src/mcp-v7/**/catalog*.ts',
                'packages/2_usecases/src/mcp-v7/**/dispatcher*.ts',
                'packages/2_usecases/src/mcp-v7/**/fallback*.ts',
                'packages/2_usecases/src/mcp-v7/**/validation*.ts',
            ],
            run: ['mcpBranches'],
            reason: 'MCP branch-risk behavior changed.',
        },
    ],
});
`,
    );
    writeFile(root, 'packages/mcp/src/server.ts', 'export const server = true;\n');
    writeFile(root, 'packages/mcp/src/dispatcher.ts', 'export const dispatcher = true;\n');

    const normalPlan = buildChangedVerificationPlan({
        cwd: root,
        changedFiles: ['packages/mcp/src/server.ts'],
    });
    assert.ok(planCommands(normalPlan).includes('npm run test:mcp:fast'));
    assert.equal(planCommands(normalPlan).includes('npm run test:mcp:branches'), false);

    const branchRiskPlan = buildChangedVerificationPlan({
        cwd: root,
        changedFiles: ['packages/mcp/src/dispatcher.ts'],
    });
    assert.ok(planCommands(branchRiskPlan).includes('npm run test:mcp:fast'));
    assert.ok(planCommands(branchRiskPlan).includes('npm run test:mcp:branches'));
});

test('changed verification planner skips tests for docs-only changes', () => {
    const root = createRoot();
    writeFile(root, 'docs/testing.md', '# Testing\n');

    const plan = buildChangedVerificationPlan({
        cwd: root,
        changedFiles: ['docs/testing.md'],
    });

    assert.deepEqual(plan.selectedChecks, []);
    assert.equal(plan.docsOnly, true);
    assert.deepEqual(plan.skippedChecks.map((check) => check.id), ['builtin:docs-only']);
});

test('changed verification dry-run reports the plan without executing checks', async () => {
    const root = createRoot();
    writeFile(
        root,
        'proteum.verify.config.ts',
        `import { defineVerificationConfig } from 'proteum/config';

export default defineVerificationConfig({
    suites: {
        fail: 'node -e "process.exit(7)"',
    },
    always: ['fail'],
});
`,
    );
    writeFile(root, 'README.md', '# Docs\n');

    const result = await runChangedVerification({
        cwd: root,
        changedFiles: ['README.md'],
        dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.executions.length, 0);
    assert.equal(result.result.ok, true);
    assert.ok(planIds(result).includes('always:fail'));
});

test('changed verification captures command failures and returns a failed result', async () => {
    const root = createRoot();
    writeFile(
        root,
        'proteum.verify.config.ts',
        `import { defineVerificationConfig } from 'proteum/config';

export default defineVerificationConfig({
    suites: {
        fail: 'node -e "process.exit(7)"',
    },
    always: ['fail'],
});
`,
    );
    writeFile(root, 'README.md', '# Docs\n');

    const result = await runChangedVerification({
        cwd: root,
        changedFiles: ['README.md'],
    });

    assert.equal(result.result.ok, false);
    assert.equal(result.result.failedChecks, 1);
    assert.deepEqual(result.executions.map((execution) => execution.status), ['failed']);
    assert.equal(result.executions[0].exitCode, 7);
});

test('verify changed CLI JSON output keeps the planner and execution shape stable', () => {
    const root = createRoot();
    spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    writeFile(root, 'docs/testing.md', '# Testing\n');

    const result = spawnSync(process.execPath, [cliBin, 'verify', 'changed', '--dry-run', '--json'], {
        cwd: root,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);

    assert.deepEqual(output.changedFiles, ['docs/testing.md']);
    assert.ok(Array.isArray(output.selectedChecks));
    assert.ok(Array.isArray(output.skippedChecks));
    assert.ok(Array.isArray(output.executions));
    assert.equal(typeof output.result.ok, 'boolean');
    assert.equal(output.result.selectedChecks, 0);
    assert.equal(output.result.failedChecks, 0);
});
