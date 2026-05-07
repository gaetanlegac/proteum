const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const coreRoot = path.resolve(__dirname, '..');
const cliBin = path.join(coreRoot, 'cli', 'bin.js');

test('top-level help lists the machine-scope mcp router', () => {
    const result = spawnSync(process.execPath, [cliBin, '--help'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /proteum mcp\b/);
    assert.match(result.stdout, /machine-scope MCP router/);
});

test('mcp help describes projectId routing', () => {
    const result = spawnSync(process.execPath, [cliBin, 'mcp', '--help'], {
        cwd: coreRoot,
        encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /machine-scope MCP router/);
    assert.match(output, /projectId/);
    assert.match(output, /--daemon/);
    assert.match(output, /--stdio/);
});
