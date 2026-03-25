/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';

// Cor elibs
import cli from '..';
import Keyboard from '../utils/keyboard';
import {
    isServerReadyMessage,
    isServerHotReloadResult,
    serverHotReloadMessageType,
    TServerHotReloadRequest,
} from '../../common/dev/serverHotReload';

// Configs
import Compiler from '../compiler';
import { createDevEventServer } from './devEvents';
import { ensureProjectAgentSymlinks } from '../utils/agents';
import { renderDevSession, renderServerReadyBanner } from '../presentation/devSession';
import { logVerbose } from '../runtime/verbose';

// Core
import { app, App } from '../app';

/*----------------------------------
- CONSTANTS
----------------------------------*/

// Watch rules shared by the dev compiler and hot reload gate.
const ignoredWatchPathPatterns = /(node_modules\/(?!proteum\/))|(\.generated\/)|(\.cache\/)|(\.proteum\/)|(\/var\/traces\/)/;
const hotReloadableServerPathPatterns = [
    /^client\/pages\//,
    /^client\/components\//,
    /^client\/islands\//,
    /^server\/routes\//,
    /^server\/services\/.+\.controller\.[jt]sx?$/,
];
const hotReloadableRoots = [() => app.paths.root, () => cli.paths.core.root];

/*----------------------------------
- STATE
----------------------------------*/

// Current server child process used by the dev loop.
let cp: ChildProcess | undefined = undefined;
let devSessionStopping = false;
let appProcessOperation: Promise<void> = Promise.resolve();
type TDevWatching = ReturnType<Awaited<ReturnType<Compiler['create']>>['watch']>;

/*----------------------------------
- HELPERS
----------------------------------*/

const closeWatching = async (watching: TDevWatching) =>
    await new Promise<void>((resolve, reject) => {
        watching.close((error?: Error | null) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

const runSerializedAppProcessOperation = async <T>(operation: () => Promise<T>) => {
    const resultPromise = appProcessOperation.catch(() => undefined).then(() => operation());
    appProcessOperation = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
};

const waitForChildExit = async (child: ChildProcess, timeoutMs: number) =>
    await new Promise<boolean>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve(true);
            return;
        }

        let settled = false;

        const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            child.off('exit', onExit);
            child.off('close', onClose);
            resolve(result);
        };

        const onExit = () => finish(true);
        const onClose = () => finish(true);
        const timeout = setTimeout(() => finish(false), timeoutMs);

        child.once('exit', onExit);
        child.once('close', onClose);
    });

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const createIgnoredWatchPattern = (outputPaths: string[]) =>
    new RegExp(
        [
            ignoredWatchPathPatterns.source,
            ...outputPaths.map((outputPath) => `(?:^${escapeForRegExp(outputPath)}(?:/|$))`),
        ].join('|'),
    );
const getDevAppName = (app: App) =>
    app.identity.web?.fullTitle || app.identity.web?.title || app.identity.name || app.packageJson.name || app.paths.root;

const cleanupPersistedDevTraces = async (app: App) => {
    const tracesRoot = path.join(app.paths.root, 'var', 'traces');
    if (!(await fs.pathExists(tracesRoot))) return;

    const entries = await fs.readdir(tracesRoot);
    const removableEntries = entries.filter((entry) => entry !== 'exports');
    if (removableEntries.length === 0) return;

    await Promise.all(removableEntries.map((entry) => fs.remove(path.join(tracesRoot, entry))));

    const remainingEntries = await fs.readdir(tracesRoot).catch(() => []);
    if (remainingEntries.length === 0) {
        await fs.remove(tracesRoot);
    }
};

const signalAppProcess = (child: ChildProcess, signal: NodeJS.Signals) => {
    try {
        if (process.platform !== 'win32' && child.pid !== undefined) {
            process.kill(-child.pid, signal);
            return true;
        }

        child.kill(signal);
        return true;
    } catch (error) {
        const errno = error as NodeJS.ErrnoException;

        if (errno.code === 'ESRCH') return false;

        throw error;
    }
};

async function startApp(app: App) {
    await runSerializedAppProcessOperation(async () => {
        if (devSessionStopping) return;

        await stopAppInternal('Restart asked');
        if (devSessionStopping) return;

        logVerbose('Launching new server ...');
        cp = spawn('node', ['--preserve-symlinks', app.outputPath('dev') + '/server.js'], {
            // stdin, stdout, stderr
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            detached: true,
        });

        const child = cp;

        child.on('exit', () => {
            if (cp === child) cp = undefined;
        });

        child.on('message', (message: unknown) => {
            if (isServerReadyMessage(message)) {
                void (async () => {
                    console.info(
                        await renderServerReadyBanner({
                            appName: getDevAppName(app),
                            publicUrl: message.publicUrl,
                            routerPort: app.env.router.port,
                        }),
                    );
                })();
                return;
            }

            if (!isServerHotReloadResult(message)) return;

            if (message.type === serverHotReloadMessageType.succeeded) {
                logVerbose('Server hot reload applied without restarting app.');
                return;
            }

            console.error('Server hot reload failed. Restarting app with a fresh process.', message.error || '');
            void startApp(app);
        });
    });
}

async function stopAppInternal(reason: string) {
    const currentApp = cp;
    if (currentApp === undefined) return;

    cp = undefined;

    logVerbose(`Killing current server instance (ID: ${currentApp.pid}) for the following reason:`, reason);

    if (!signalAppProcess(currentApp, 'SIGTERM')) return;

    if (await waitForChildExit(currentApp, 5000)) return;

    logVerbose(`Server instance ${currentApp.pid} did not stop after SIGTERM. Escalating to SIGKILL.`);

    if (!signalAppProcess(currentApp, 'SIGKILL')) return;

    await waitForChildExit(currentApp, 2000);
}

async function stopApp(reason: string) {
    await runSerializedAppProcessOperation(async () => {
        await stopAppInternal(reason);
    });
}

function requestServerHotReload(changedFiles: string[]) {
    if (!cp || !cp.connected) return false;

    const message: TServerHotReloadRequest = { type: serverHotReloadMessageType.request, changedFiles };

    try {
        cp.send(message);
        return true;
    } catch {
        return false;
    }
}

function isServerHotReloadEligible(changedFiles: string[]) {
    if (changedFiles.length === 0) return false;

    return changedFiles.every((changedFile) => {
        const normalizedChangedFile = normalizeWatchPath(changedFile);

        return hotReloadableRoots.some((getRootPath) => {
            const normalizedRootPath = normalizeWatchPath(getRootPath());
            if (
                normalizedChangedFile !== normalizedRootPath &&
                !normalizedChangedFile.startsWith(normalizedRootPath + '/')
            ) {
                return false;
            }

            const relativePath = normalizedChangedFile.substring(normalizedRootPath.length + 1);
            return hotReloadableServerPathPatterns.some((pattern) => pattern.test(relativePath));
        });
    });
}

function normalizeWatchPath(watchPath: string) {
    return path.resolve(watchPath).replace(/\\/g, '/').replace(/\/$/, '');
}

/*----------------------------------
- MAIN PROCESS
----------------------------------*/
export const run = async () => {
    devSessionStopping = false;
    ensureProjectAgentSymlinks({ appRoot: app.paths.root, coreRoot: cli.paths.core.root });

    const devEventServer = await createDevEventServer(app.env.router.port + 1);
    app.devEventPort = devEventServer.port;
    console.info(
        await renderDevSession({
            appName: getDevAppName(app),
            appRoot: app.paths.root === process.cwd() ? '.' : app.paths.root,
            routerPort: app.env.router.port,
            devEventPort: devEventServer.port,
        }),
    );

    const compiler = new Compiler('dev', {
        before: (compiler) => {
            if (compiler.name !== 'server') return;

            const changedFilesList = compiler.modifiedFiles ? [...compiler.modifiedFiles] : [];

            if (changedFilesList.length === 0) {
                logVerbose('Server compilation started. App restart will wait for a successful server build.');
            } else {
                logVerbose('Need to recompile server because files changed:\n' + changedFilesList.join('\n'));
            }
        },
        after: () => {},
    });

    const multiCompiler = await compiler.create();
    const ignoredOutputPaths = [app.paths.bin, app.paths.dev].map(normalizeWatchPath);
    const ignoredWatchPattern = createIgnoredWatchPattern(ignoredOutputPaths);

    const watching = multiCompiler.watch(
        {
            // Watching may not work with NFS and machines in VirtualBox
            // Uncomment next line if it is your case (use true or interval in milliseconds)
            //poll: 1000,

            // Decrease CPU or memory usage in some file systems
            // Ignore updated from:
            // - Node modules except 5HTP core (framework dev mode)
            // - Generated files during runtime (cause infinite loop. Ex: models.d.ts)
            // - Webpack output folders (`./dev`, legacy `./bin`)
            ignored: ignoredWatchPattern,

            //aggregateTimeout: 1000,
        },
        async (error, stats) => {
            if (error) {
                compiler.consumeRecentCompilationResults();
                console.error('Error in milticompiler.watch', error, stats ? stats.toString('errors-warnings') : '');
                return;
            }

            const recentCompilationResults = compiler.consumeRecentCompilationResults();
            const serverResult = recentCompilationResults.server;
            const clientResult = recentCompilationResults.client;

            let restartedServer = false;

            if (serverResult?.succeeded === true) {
                const changedFilesList = serverResult.modifiedFiles || [];
                const canHotReloadServer = isServerHotReloadEligible(changedFilesList);

                if (canHotReloadServer && requestServerHotReload(changedFilesList)) {
                    logVerbose(
                        'Watch callback. Server route bundle changed; hot-swapping generated routes without restarting app.',
                    );
                } else {
                    logVerbose('Watch callback. Reloading app because server bundle changed ...');
                    await startApp(app);
                    restartedServer = true;
                    devEventServer.broadcast({ type: 'reload', reason: 'server' });
                }
            }

            if (serverResult?.succeeded === false) {
                logVerbose('Watch callback. Server compilation failed; keeping current app instance.');
            }

            if (!restartedServer && clientResult?.succeeded === true) {
                logVerbose('Watch callback. Client assets updated; server restart skipped.');
                devEventServer.broadcast({ type: 'reload', reason: 'client' });
                return;
            }

            if (!restartedServer && clientResult?.succeeded === false) {
                logVerbose('Watch callback. Client compilation failed; server restart skipped.');
                return;
            }

            if (restartedServer || serverResult?.succeeded === true || serverResult?.succeeded === false) {
                return;
            }

            logVerbose('Watch callback. No compiler changes were tracked.');
        },
    );

    let shuttingDownPromise: Promise<void> | undefined;

    const shutdown = async (reason: string) => {
        if (shuttingDownPromise) return shuttingDownPromise;

        devSessionStopping = true;
        shuttingDownPromise = (async () => {
            logVerbose('Stopping the Proteum dev session ...', reason);
            await closeWatching(watching);
            compiler.dispose();
            await stopApp(reason);
            await cleanupPersistedDevTraces(app);
            await devEventServer.close();
        })();

        return shuttingDownPromise;
    };

    const exitAfterShutdown = (reason: string, exitCode: number) => {
        void (async () => {
            try {
                await shutdown(reason);
                process.exit(exitCode);
            } catch (error) {
                console.error(error);
                process.exit(1);
            }
        })();
    };

    Keyboard.input('ctrl+r', async () => {
        logVerbose('Waiting for compilers to be ready ...', Object.keys(compiler.compiling));
        await Promise.all(Object.values(compiler.compiling));

        logVerbose('Reloading app ...');
        await startApp(app);
        devEventServer.broadcast({ type: 'reload', reason: 'manual' });
    });

    Keyboard.input('ctrl+c', async () => {
        await shutdown('CTRL+C Pressed');
        process.exit(0);
    });

    process.once('SIGINT', () => exitAfterShutdown('SIGINT', 0));
    process.once('SIGTERM', () => exitAfterShutdown('SIGTERM', 0));
    process.once('SIGHUP', () => exitAfterShutdown('SIGHUP', 0));
};
