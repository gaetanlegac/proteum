const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');
require('../cli/context.ts');

const {
    createDevSessionRecord,
    prepareDevSessionStart,
    resolveDevSessionFilePath,
    writeDevSessionRecord,
} = require('../cli/runtime/devSessions.ts');

const createTempAppRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-dev-session-app-'));

const createSessionRecord = ({ appRoot, pid = process.pid, port = 3101, sessionFilePath }) => ({
    ...createDevSessionRecord({ appRoot, port, sessionFilePath }),
    pid,
    publicUrl: `http://localhost:${port}`,
    state: 'ready',
});

test('prepareDevSessionStart cleans stale and invalid same-worktree sessions', async () => {
    const appRoot = createTempAppRoot();
    const staleSessionFilePath = resolveDevSessionFilePath({ appRoot, port: 3101 });
    const invalidSessionFilePath = resolveDevSessionFilePath({ appRoot, port: 3102 });
    const requestedSessionFilePath = resolveDevSessionFilePath({ appRoot, port: 3103 });

    await writeDevSessionRecord(
        createSessionRecord({
            appRoot,
            pid: 999999,
            port: 3101,
            sessionFilePath: staleSessionFilePath,
        }),
    );
    fs.mkdirSync(path.dirname(invalidSessionFilePath), { recursive: true });
    fs.writeFileSync(invalidSessionFilePath, '{ invalid json');

    const result = await prepareDevSessionStart({
        appRoot,
        replaceExisting: false,
        sessionFilePath: requestedSessionFilePath,
    });

    assert.equal(result.blocking.length, 0);
    assert.equal(result.cleaned.length, 2);
    assert.equal(fs.existsSync(staleSessionFilePath), false);
    assert.equal(fs.existsSync(invalidSessionFilePath), false);
});

test('prepareDevSessionStart blocks another live same-worktree session', async () => {
    const appRoot = createTempAppRoot();
    const blockingSessionFilePath = resolveDevSessionFilePath({ appRoot, port: 3101 });
    const requestedSessionFilePath = resolveDevSessionFilePath({ appRoot, port: 3102 });

    await writeDevSessionRecord(
        createSessionRecord({
            appRoot,
            pid: process.pid,
            port: 3101,
            sessionFilePath: blockingSessionFilePath,
        }),
    );

    const result = await prepareDevSessionStart({
        appRoot,
        currentPid: process.pid + 1,
        replaceExisting: false,
        sessionFilePath: requestedSessionFilePath,
    });

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0].sessionFilePath, blockingSessionFilePath);
    assert.equal(fs.existsSync(blockingSessionFilePath), true);
});

test('prepareDevSessionStart replaces the exact requested session file only with replaceExisting', async () => {
    const appRoot = createTempAppRoot();
    const requestedSessionFilePath = resolveDevSessionFilePath({ appRoot, port: 3101 });
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
    });

    try {
        await writeDevSessionRecord(
            createSessionRecord({
                appRoot,
                pid: child.pid,
                port: 3101,
                sessionFilePath: requestedSessionFilePath,
            }),
        );

        const result = await prepareDevSessionStart({
            appRoot,
            replaceExisting: true,
            sessionFilePath: requestedSessionFilePath,
        });

        assert.equal(result.blocking.length, 0);
        assert.equal(result.replaced?.stopped, true);
        assert.equal(fs.existsSync(requestedSessionFilePath), false);
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
});
