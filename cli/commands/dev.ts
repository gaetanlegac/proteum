/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

// Cor elibs
import cli from '..';
import Keyboard from '../utils/keyboard';
import {
    isServerHotReloadResult,
    serverHotReloadMessageType,
    TServerHotReloadRequest,
} from '../../common/dev/serverHotReload';

// Configs
import Compiler from '../compiler';
import { createDevEventServer } from './devEvents';
import { ensureProjectAgentSymlinks } from '../utils/agents';
import { renderDevSession } from '../presentation/devSession';
import { logVerbose } from '../runtime/verbose';

// Core
import { app, App } from '../app';

/*----------------------------------
- CONSTANTS
----------------------------------*/

// Watch rules shared by the dev compiler and hot reload gate.
const ignoredWatchPathPatterns = /(node_modules\/(?!proteum\/))|(\.generated\/)|(\.cache\/)|(\.proteum\/)/;
const hotReloadableServerPathPatterns = [
    /^client\/pages\//,
    /^client\/components\//,
    /^client\/islands\//,
    /^server\/routes\//,
    /^server\/services\/.+\.controller\.[jt]sx?$/,
];
const hotReloadableRoots = [() => app.paths.root, () => cli.paths.core.root];

/*----------------------------------
- MAIN PROCESS
----------------------------------*/
export const run = async () => {
    ensureProjectAgentSymlinks({ appRoot: app.paths.root, coreRoot: cli.paths.core.root });

    const devEventServer = await createDevEventServer(app.env.router.port + 1);
    app.devEventPort = devEventServer.port;
    console.info(
        await renderDevSession({
            appName:
                app.identity.web?.fullTitle ||
                app.identity.web?.title ||
                app.identity.name ||
                app.packageJson.name ||
                app.paths.root,
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

    multiCompiler.watch(
        {
            // Watching may not work with NFS and machines in VirtualBox
            // Uncomment next line if it is your case (use true or interval in milliseconds)
            //poll: 1000,

            // Decrease CPU or memory usage in some file systems
            // Ignore updated from:
            // - Node modules except 5HTP core (framework dev mode)
            // - Generated files during runtime (cause infinite loop. Ex: models.d.ts)
            // - Webpack output folders (`./dev`, legacy `./bin`)
            ignored: (watchPath: string) => {
                const normalizedPath = normalizeWatchPath(watchPath);
                return (
                    ignoredWatchPathPatterns.test(normalizedPath) ||
                    ignoredOutputPaths.some(
                        (outputPath) => normalizedPath === outputPath || normalizedPath.startsWith(outputPath + '/'),
                    )
                );
            },

            //aggregateTimeout: 1000,
        },
        async (error, stats) => {
            if (error) {
                compiler.consumeRecentCompilationResults();
                console.error('Error in milticompiler.watch', error, stats?.toString());
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
                    startApp(app);
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

    Keyboard.input('ctrl+r', async () => {
        logVerbose('Waiting for compilers to be ready ...', Object.keys(compiler.compiling));
        await Promise.all(Object.values(compiler.compiling));

        logVerbose('Reloading app ...');
        startApp(app);
        devEventServer.broadcast({ type: 'reload', reason: 'manual' });
    });

    Keyboard.input('ctrl+c', () => {
        stopApp('CTRL+C Pressed');
        void devEventServer.close();
    });
};

/*----------------------------------
- STATE
----------------------------------*/

// Current server child process used by the dev loop.
let cp: ChildProcess | undefined = undefined;

/*----------------------------------
- HELPERS
----------------------------------*/

async function startApp(app: App) {
    stopApp('Restart asked');

    logVerbose('Launching new server ...');
    cp = spawn('node', ['--preserve-symlinks', app.outputPath('dev') + '/server.js'], {
        // sdin, sdout, sderr
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    cp.on('message', (message: unknown) => {
        if (!isServerHotReloadResult(message)) return;

        if (message.type === serverHotReloadMessageType.succeeded) {
            logVerbose('Server hot reload applied without restarting app.');
            return;
        }

        console.error('Server hot reload failed. Restarting app with a fresh process.', message.error || '');
        startApp(app);
    });
}

function stopApp(reason: string) {
    if (cp !== undefined) {
        logVerbose(`Killing current server instance (ID: ${cp.pid}) for the following reason:`, reason);
        cp.kill();
        cp = undefined;
    }
}

function requestServerHotReload(changedFiles: string[]) {
    if (!cp || !cp.connected) return false;

    const message: TServerHotReloadRequest = { type: serverHotReloadMessageType.request, changedFiles };

    cp.send(message);
    return true;
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
