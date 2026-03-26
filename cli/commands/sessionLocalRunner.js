const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const tsNode = require('ts-node');

const resultMarker = '__PROTEUM_SESSION_RESULT__';

const printPayload = (payload) => {
    process.stdout.write(`${resultMarker}${JSON.stringify(payload)}\n`);
};

const fail = (error) => {
    printPayload({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
};

const getAvailablePort = async () =>
    await new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();

            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Could not determine a local port for the session runner.')));
                return;
            }

            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(address.port);
            });
        });
    });

const closeMultiCompiler = async (multiCompiler) =>
    await new Promise((resolve, reject) => {
        multiCompiler.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

const runCompiler = async (compiler) => {
    const multiCompiler = await compiler.create();

    try {
        await new Promise((resolve, reject) => {
            multiCompiler.run((error, stats) => {
                if (error) {
                    reject(error);
                    return;
                }

                if (stats && stats.hasErrors()) {
                    reject(new Error('Compilation failed for the local dev session runner.'));
                    return;
                }

                resolve();
            });
        });
    } finally {
        compiler.dispose();
        await closeMultiCompiler(multiCompiler);
    }
};

const waitForServerReady = async (child) =>
    await new Promise((resolve, reject) => {
        let settled = false;

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            child.off('message', onMessage);
            child.off('error', onError);
            child.off('exit', onExit);
            callback(value);
        };

        const onMessage = (message) => {
            if (!message || message.type !== 'proteum:server-ready' || typeof message.publicUrl !== 'string') return;
            finish(resolve, message.publicUrl);
        };

        const onError = (error) => finish(reject, error);
        const onExit = (code, signal) =>
            finish(reject, new Error(`Local session server exited before becoming ready (code=${code}, signal=${signal}).`));
        const timeout = setTimeout(
            () => finish(reject, new Error('Timed out while waiting for the local session server to become ready.')),
            30000,
        );

        child.on('message', onMessage);
        child.once('error', onError);
        child.once('exit', onExit);
    });

const stopServerProcess = async (child) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    child.kill('SIGTERM');

    await new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 5000);

        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
};

const requestSession = async (baseUrl, email, role) => {
    const response = await fetch(`${baseUrl}/__proteum/session/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(role ? { email, role } : { email }),
    });
    const body = await response.json();

    if (response.status >= 400) {
        throw new Error((body && body.error) || `Session request failed with status ${response.status}.`);
    }

    return { baseUrl, response: body };
};

(async () => {
    const [, , appRootArg = '', email = '', role = ''] = process.argv;
    const appRoot = path.resolve(appRootArg);

    if (!appRootArg || !email) {
        fail(new Error('sessionLocalRunner requires <appRoot> and <email>.'));
        return;
    }

    process.chdir(appRoot);

    tsNode.register({
        transpileOnly: true,
        project: path.join(__dirname, '..', 'tsconfig.json'),
        files: true,
    });

    const port = await getAvailablePort();
    const cli = require('../context.ts').default;
    cli.setArgs({ workdir: appRoot, port: String(port), url: '', json: true });

    const app = require('../app/index.ts').default;
    const Compiler = require('../compiler/index.ts').default;

    if (app.env.profile !== 'dev') {
        fail(new Error(`Proteum sessions are only available when ENV_PROFILE=dev. Current profile: ${app.env.profile}.`));
        return;
    }

    const compiler = new Compiler('dev');
    await runCompiler(compiler);

    const serverProcess = spawn(process.execPath, ['--preserve-symlinks', path.join(app.outputPath('dev'), 'server.js')], {
        cwd: app.paths.root,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });

    try {
        const baseUrl = await waitForServerReady(serverProcess);
        const session = await requestSession(baseUrl, email, role);
        printPayload({ session });
    } finally {
        await stopServerProcess(serverProcess);
    }
})().catch((error) => {
    fail(error);
});
