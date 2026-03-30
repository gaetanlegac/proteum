/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import type { FSWatcher } from 'fs';

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
import { renderDevSession, renderServerReadyBanner, renderDevShutdownBanner } from '../presentation/devSession';
import { clearInteractiveConsole } from '../presentation/welcome';
import {
    createDevSessionRecord,
    inspectDevSessionFile,
    listDevSessionInspections,
    removeDevSessionRecord,
    removeDevSessionRecordSync,
    resolveDevSessionFilePath,
    stopDevSessionFile,
    updateDevSessionRecord,
    type TDevSessionInspection,
    type TStopDevSessionResult,
} from '../runtime/devSessions';
import { logVerbose } from '../runtime/verbose';

// Core
import { app, App } from '../app';

/*----------------------------------
- CONSTANTS
----------------------------------*/

// Watch rules shared by the dev compiler and hot reload gate.
const ignoredWatchPathPatterns = /(\.generated\/)|(\.cache\/)|(\.proteum\/)|(\/var\/traces\/)/;
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
let currentDevSessionFilePath: string | undefined = undefined;
let devSessionExitCleanupRegistered = false;
type TDevWatching = ReturnType<Awaited<ReturnType<Compiler['create']>>['watch']>;
type TIndexedSourceWatching = { close: () => Promise<void> };

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

const shouldIgnoreNodeModulesWatchPath = (watchPath: string) => {
    if (!watchPath.includes('/node_modules/')) return false;
    if (watchPath.includes('/node_modules/proteum/') && !watchPath.includes('/node_modules/proteum/node_modules/')) {
        return false;
    }

    return !app.isTranspileModuleFile(watchPath);
};

const createIgnoredWatchMatcher = (outputPaths: string[]) => (watchPath: string) => {
    const normalizedWatchPath = normalizeWatchPath(watchPath);

    if (outputPaths.some((outputPath) => normalizedWatchPath === outputPath || normalizedWatchPath.startsWith(outputPath + '/'))) {
        return true;
    }

    if (shouldIgnoreNodeModulesWatchPath(normalizedWatchPath)) return true;

    return ignoredWatchPathPatterns.test(normalizedWatchPath);
};

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

const getRequestedSessionFilePath = () =>
    typeof cli.args.sessionFile === 'string' && cli.args.sessionFile.trim() ? cli.args.sessionFile : undefined;

const getResolvedDevSessionFilePath = () =>
    resolveDevSessionFilePath({
        appRoot: app.paths.root,
        port: app.env.router.port,
        sessionFilePath: getRequestedSessionFilePath(),
    });

const registerDevSessionExitCleanup = () => {
    if (devSessionExitCleanupRegistered) return;

    devSessionExitCleanupRegistered = true;
    process.once('exit', () => {
        if (!currentDevSessionFilePath) return;
        removeDevSessionRecordSync(currentDevSessionFilePath);
    });
};

const updateCurrentDevSession = async (patch: { publicUrl?: string; state?: 'starting' | 'ready' }) => {
    if (!currentDevSessionFilePath) return;

    await updateDevSessionRecord({
        sessionFilePath: currentDevSessionFilePath,
        patch,
    });
};

const cleanupCurrentDevSession = async () => {
    if (!currentDevSessionFilePath) return;

    const sessionFilePath = currentDevSessionFilePath;
    currentDevSessionFilePath = undefined;
    await removeDevSessionRecord(sessionFilePath);
};

const describeInspection = (inspection: TDevSessionInspection) => {
    if (!inspection.record) {
        return [
            'stale invalid',
            inspection.sessionFilePath,
            inspection.parseError || 'Unreadable session file.',
        ].join(' | ');
    }

    const parts = [
        inspection.live ? 'live' : 'stale',
        inspection.record.state,
        `pid ${inspection.record.pid}`,
        `port ${inspection.record.routerPort}`,
    ];

    if (inspection.record.publicUrl) parts.push(inspection.record.publicUrl);
    parts.push(inspection.sessionFilePath);

    return parts.join(' | ');
};

const describeStopResult = (result: TStopDevSessionResult) => {
    if (!result.matched) return `missing | ${result.sessionFilePath}`;
    if (result.invalid)
        return `removed stale invalid | ${result.sessionFilePath} | ${result.parseError || 'Unreadable session file.'}`;
    if (result.removed && result.stopped && !result.live) {
        return [
            result.pid !== null ? `stopped pid ${result.pid}` : 'stopped',
            result.routerPort !== null ? `port ${result.routerPort}` : '',
            result.publicUrl,
            result.sessionFilePath,
        ]
            .filter(Boolean)
            .join(' | ');
    }

    return [
        'failed',
        result.pid !== null ? `pid ${result.pid}` : '',
        result.routerPort !== null ? `port ${result.routerPort}` : '',
        result.publicUrl,
        result.sessionFilePath,
    ]
        .filter(Boolean)
        .join(' | ');
};

const printJson = (payload: unknown) => {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
};

const runListCommand = async () => {
    const inspections = await listDevSessionInspections({
        appRoot: app.paths.root,
        sessionFilePath: getRequestedSessionFilePath(),
    });
    const filteredInspections = cli.args.stale === true ? inspections.filter((inspection) => inspection.stale) : inspections;

    if (cli.args.json === true) {
        printJson({
            appRoot: app.paths.root,
            sessions: filteredInspections.map((inspection) => ({
                sessionFilePath: inspection.sessionFilePath,
                live: inspection.live,
                stale: inspection.stale,
                invalid: inspection.invalid,
                parseError: inspection.parseError,
                record: inspection.record,
            })),
        });
        return;
    }

    if (filteredInspections.length === 0) {
        console.info(`No Proteum dev sessions found for ${app.paths.root}.`);
        return;
    }

    console.info(filteredInspections.map(describeInspection).join('\n'));
};

const runStopCommand = async () => {
    const stopAll = cli.args.all === true;
    const filterStale = cli.args.stale === true;

    const targetSessionFilePaths = stopAll
        ? (await listDevSessionInspections({
              appRoot: app.paths.root,
              sessionFilePath: getRequestedSessionFilePath(),
          }))
              .filter((inspection) => !filterStale || inspection.stale)
              .map((inspection) => inspection.sessionFilePath)
        : [getResolvedDevSessionFilePath()];

    const results = await Promise.all(targetSessionFilePaths.map((sessionFilePath) => stopDevSessionFile(sessionFilePath)));
    const failedResults = results.filter((result) => result.matched && !result.stopped);

    if (cli.args.json === true) {
        printJson({ appRoot: app.paths.root, results });
    } else if (results.length === 0) {
        console.info(`No Proteum dev sessions matched for ${app.paths.root}.`);
    } else {
        console.info(results.map(describeStopResult).join('\n'));
    }

    if (failedResults.length > 0) {
        process.exitCode = 1;
    }
};

const ensureDevSessionSlot = async () => {
    const sessionFilePath = getResolvedDevSessionFilePath();
    const existingInspection = await inspectDevSessionFile(sessionFilePath);

    if (existingInspection?.record && existingInspection.live && existingInspection.record.pid !== process.pid) {
        if (cli.args.replaceExisting !== true) {
            throw new Error(
                `A Proteum dev session is already registered at ${sessionFilePath} (pid ${existingInspection.record.pid}, port ${existingInspection.record.routerPort}). ` +
                    'Use `proteum dev stop` or restart with `proteum dev --replace-existing`.',
            );
        }

        const stopResult = await stopDevSessionFile(sessionFilePath);
        if (!stopResult.stopped) {
            throw new Error(`Could not stop the existing Proteum dev session registered at ${sessionFilePath}.`);
        }
    } else if (existingInspection) {
        await stopDevSessionFile(sessionFilePath);
    }

    currentDevSessionFilePath = sessionFilePath;
    registerDevSessionExitCleanup();
    await fs.ensureDir(path.dirname(sessionFilePath));
    await fs.writeJson(
        sessionFilePath,
        createDevSessionRecord({
            appRoot: app.paths.root,
            port: app.env.router.port,
            sessionFilePath,
        }),
        { spaces: 2 },
    );

    logVerbose(`Registered Proteum dev session at ${sessionFilePath}.`);
};

async function startApp(app: App) {
    await runSerializedAppProcessOperation(async () => {
        if (devSessionStopping) return;

        await stopAppInternal('Restart asked');
        if (devSessionStopping) return;

        await updateCurrentDevSession({ state: 'starting', publicUrl: '' });
        logVerbose('Launching new server ...');
        cp = spawn('node', ['--preserve-symlinks', app.outputPath('dev') + '/server.js'], {
            // stdin, stdout, stderr
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            detached: true,
        });

        const child = cp;
        let childReady = false;

        child.on('exit', (code, signal) => {
            const isCurrentChild = cp === child;
            if (isCurrentChild) cp = undefined;
            if (!isCurrentChild || devSessionStopping || childReady) return;

            console.error(
                `Proteum dev server exited before reporting ready.${code !== null ? ` Exit code: ${code}.` : ''}${signal ? ` Signal: ${signal}.` : ''}`,
            );
            process.exit(code && code !== 0 ? code : 1);
        });

        child.on('message', (message: unknown) => {
            if (isServerReadyMessage(message)) {
                childReady = true;
                void (async () => {
                    await updateCurrentDevSession({ publicUrl: message.publicUrl, state: 'ready' });
                    console.info(
                        await renderServerReadyBanner({
                            appName: getDevAppName(app),
                            connectedProjectsCount: Object.keys(app.env.connectedProjects).length,
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

const indexedSourceWatchRules: { compilerName: 'server'; root: () => string; relativePathPattern: RegExp }[] = [
    { compilerName: 'server', root: () => app.paths.root, relativePathPattern: /^commands(?:\/|$)/ },
    { compilerName: 'server', root: () => cli.paths.core.root, relativePathPattern: /^commands(?:\/|$)/ },
];

const closeFsWatcher = async (watcher: FSWatcher) => {
    await new Promise<void>((resolve) => {
        watcher.once('close', () => resolve());
        watcher.close();
    });
};

const createIndexedSourceWatching = ({
    compiler,
    watching,
}: {
    compiler: Compiler;
    watching: TDevWatching;
}): TIndexedSourceWatching => {
    const watchers: FSWatcher[] = [];
    const pendingChanges = new Map<'server', Set<string>>();
    let invalidateTimer: NodeJS.Timeout | undefined;

    const flushInvalidate = () => {
        invalidateTimer = undefined;

        for (const [compilerName, changedFiles] of pendingChanges) {
            compiler.noteManualModifiedFiles(compilerName, [...changedFiles]);
        }

        pendingChanges.clear();
        logVerbose('Indexed source files changed. Invalidating the dev compiler to refresh generated artifacts.');
        watching.invalidate();
    };

    const queueInvalidate = (compilerName: 'server', filepath: string) => {
        const normalizedFilepath = normalizeWatchPath(filepath);
        const changedFiles = pendingChanges.get(compilerName) || new Set<string>();

        changedFiles.add(normalizedFilepath);
        pendingChanges.set(compilerName, changedFiles);

        if (invalidateTimer) return;
        invalidateTimer = setTimeout(flushInvalidate, 40);
    };

    for (const watchRule of indexedSourceWatchRules) {
        const rootPath = watchRule.root();

        watchers.push(
            fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
                const relativePath = typeof filename === 'string' ? filename.replace(/\\/g, '/').replace(/^\.\//, '') : '';
                if (relativePath && !watchRule.relativePathPattern.test(relativePath)) return;
                if (eventType !== 'rename' && relativePath) return;

                queueInvalidate(watchRule.compilerName, relativePath ? path.join(rootPath, relativePath) : rootPath);
            }),
        );
    }

    return {
        close: async () => {
            if (invalidateTimer) {
                clearTimeout(invalidateTimer);
                invalidateTimer = undefined;
            }

            await Promise.all(watchers.map((watcher) => closeFsWatcher(watcher)));
        },
    };
};

const runDevLoop = async () => {
    devSessionStopping = false;
    clearInteractiveConsole();
    ensureProjectAgentSymlinks({ appRoot: app.paths.root, coreRoot: cli.paths.core.root });
    await ensureDevSessionSlot();

    const devEventServer = await createDevEventServer(app.env.router.port + 1);
    app.devEventPort = devEventServer.port;
    console.info(
        await renderDevSession({
            appName: getDevAppName(app),
            appRoot: app.paths.root === process.cwd() ? '.' : app.paths.root,
            connectedProjects: Object.values(app.env.connectedProjects),
            routerPort: app.env.router.port,
            devEventPort: devEventServer.port,
            proteumVersion: String(cli.packageJson.version || ''),
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
    const ignoredWatchMatcher = createIgnoredWatchMatcher(ignoredOutputPaths);

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
            ignored: ignoredWatchMatcher,

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
    const indexedSourceWatching = createIndexedSourceWatching({ compiler, watching });

    let shuttingDownPromise: Promise<void> | undefined;

    const shutdown = async (reason: string) => {
        if (shuttingDownPromise) return shuttingDownPromise;

        devSessionStopping = true;
        shuttingDownPromise = (async () => {
            logVerbose('Stopping the Proteum dev session ...', reason);
            await indexedSourceWatching.close();
            await closeWatching(watching);
            compiler.dispose();
            await stopApp(reason);
            await cleanupPersistedDevTraces(app);
            await devEventServer.close();
            await cleanupCurrentDevSession();
            console.info(await renderDevShutdownBanner());
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

/*----------------------------------
- MAIN PROCESS
----------------------------------*/
export const run = async () => {
    const action = typeof cli.args.action === 'string' ? cli.args.action : 'start';

    if (action === 'list') {
        await runListCommand();
        return;
    }

    if (action === 'stop') {
        await runStopCommand();
        return;
    }

    await runDevLoop();
};
