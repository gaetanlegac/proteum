const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const tsNode = require('ts-node');

const resultMarker = '__PROTEUM_COMMAND_RESULT__';

const printPayload = (payload) => {
    process.stdout.write(`${resultMarker}${JSON.stringify(payload)}\n`);
};

const fail = (error, execution) => {
    if (execution) {
        printPayload({ execution });
        process.exitCode = 1;
        return;
    }

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
                server.close(() => reject(new Error('Could not determine a local port for the command runner.')));
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
                    reject(new Error('Compilation failed for the local dev command runner.'));
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
            finish(reject, new Error(`Local command server exited before becoming ready (code=${code}, signal=${signal}).`));
        const timeout = setTimeout(
            () => finish(reject, new Error('Timed out while waiting for the local command server to become ready.')),
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

const requestCommand = async (baseUrl, commandPath) => {
    const response = await fetch(`${baseUrl}/__proteum/commands/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: commandPath }),
    });
    const body = await response.json();

    if (body && typeof body === 'object' && body.execution) {
        return { statusCode: response.status, execution: body.execution };
    }

    throw new Error((body && body.error) || `Command request failed with status ${response.status}.`);
};

(async () => {
    const [, , appRootArg = '', commandPath = ''] = process.argv;
    const appRoot = path.resolve(appRootArg);

    if (!appRootArg || !commandPath) {
        fail(new Error('commandLocalRunner requires <appRoot> and <commandPath>.'));
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
    cli.setArgs({ workdir: appRoot, path: commandPath, port: String(port), url: '', json: true });

    const app = require('../app/index.ts').default;
    const Compiler = require('../compiler/index.ts').default;

    if (app.env.profile !== 'dev') {
        fail(new Error(`Proteum commands are only available when ENV_PROFILE=dev. Current profile: ${app.env.profile}.`));
        return;
    }

    const compiler = new Compiler('dev');
    await runCompiler(compiler);

    const serverProcess = spawn(process.execPath, ['--preserve-symlinks', path.join(app.outputPath('dev'), 'server.js')], {
        cwd: app.paths.root,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });

    try {
        const publicUrl = await waitForServerReady(serverProcess);
        const { statusCode, execution } = await requestCommand(publicUrl, commandPath);

        printPayload({ execution });
        if (statusCode >= 400 || execution.status === 'error') {
            process.exitCode = 1;
        }
    } finally {
        await stopServerProcess(serverProcess);
    }
})().catch((error) => {
    fail(error);
});
