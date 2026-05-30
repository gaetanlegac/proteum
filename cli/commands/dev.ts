/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import { realpathSync, watch, type FSWatcher } from 'fs';
import prompts from 'prompts';
import { UsageError } from 'clipanion';

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
import { renderDevSession, renderServerReadyBanner, renderDevShutdownBanner } from '../presentation/devSession';
import { clearInteractiveConsole } from '../presentation/welcome';
import { renderWarning } from '../presentation/ink';
import {
    createDevSessionRecord,
    listDevSessionInspections,
    prepareDevSessionStart,
    removeDevSessionRecord,
    removeDevSessionRecordSync,
    resolveDevSessionFilePath,
    stopDevSessionFile,
    updateDevSessionRecord,
    writeDevSessionRecord,
    writeMachineDevSessionRecord,
    type TDevSessionInspection,
    type TStopDevSessionResult,
} from '../runtime/devSessions';
import { resolveFrameworkInstallInfo } from '../paths';
import { logVerbose } from '../runtime/verbose';
import { ensureMachineMcpDaemonProcess } from '../runtime/mcpDaemon';
import { inspectDevPort, type TDevPortInspection } from '../runtime/ports';
import { configureProjectAgentInstructions, resolveProjectAgentMonorepoRoot } from '../utils/agents';
import { quoteCommandArgument } from '../utils/agentOutput';

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
const transpileSourceWatchPattern = /\.(ts|tsx|js|jsx|css|less|scss)$/;

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

const promptBlockedAgentInstructionOverwrites = async (blockedPaths: string[]) => {
    if (blockedPaths.length === 0) return [];
    if (cli.args.json === true || !process.stdin.isTTY || !process.stdout.isTTY) {
        throw new UsageError(
            [
                'Proteum could not update managed instruction paths because existing paths are blocked:',
                ...blockedPaths.map((entry) => `- ${entry}`),
                'Run `proteum configure agents` in an interactive terminal to choose which paths can be replaced.',
            ].join('\n'),
        );
    }

    console.info(await renderWarning('Proteum found existing paths that block managed instruction updates.'));
    console.info(
        [
            'Choose whether to overwrite each blocked path with a Proteum-managed instruction path:',
            ...blockedPaths.map((entry) => `- ${entry}`),
        ].join('\n'),
    );

    const overwriteBlockedPaths: string[] = [];

    for (const blockedPath of blockedPaths) {
        const response = await prompts(
            {
                type: 'confirm',
                name: 'value',
                message: `Overwrite ${blockedPath}?`,
                initial: false,
            },
            {
                onCancel: () => {
                    throw new UsageError('Cancelled `proteum dev`.');
                },
            },
        );

        if (response.value === true) overwriteBlockedPaths.push(blockedPath);
    }

    return overwriteBlockedPaths;
};

const ensureProjectAgentInstructions = async () => {
    const monorepoRoot = resolveProjectAgentMonorepoRoot(app.paths.root);
    const preview = configureProjectAgentInstructions({
        appRoot: app.paths.root,
        coreRoot: cli.paths.core.root,
        dryRun: true,
        monorepoRoot,
    });
    const overwriteBlockedPaths = await promptBlockedAgentInstructionOverwrites(preview.blocked);

    const result = configureProjectAgentInstructions({
        appRoot: app.paths.root,
        coreRoot: cli.paths.core.root,
        monorepoRoot,
        overwriteBlockedPaths,
    });

    if (result.blocked.length === 0) return;

    throw new UsageError(
        [
            'Proteum could not update all managed instruction paths because these paths were left blocked:',
            ...result.blocked.map((entry) => `- ${entry}`),
        ].join('\n'),
    );
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

const describeBlockingDevSession = (inspection: TDevSessionInspection) => {
    if (!inspection.record) {
        return [
            '- invalid session',
            inspection.sessionFilePath,
            inspection.parseError || 'Unreadable session file.',
        ]
            .filter(Boolean)
            .join(' | ');
    }

    const publicUrl = inspection.record.publicUrl || `http://localhost:${inspection.record.routerPort}`;

    return [
        `- pid ${inspection.record.pid}`,
        `port ${inspection.record.routerPort}`,
        publicUrl,
        `session ${inspection.sessionFilePath}`,
    ].join(' | ');
};

const createBlockingDevSessionMessage = (blocking: TDevSessionInspection[]) => {
    const firstSessionFilePath = blocking[0]?.sessionFilePath || '<session-file>';

    return [
        `A Proteum dev session is already running for ${app.paths.root}.`,
        'Stop the existing session before starting another server in the same worktree:',
        ...blocking.map(describeBlockingDevSession),
        '',
        `Run: npx proteum dev stop --session-file ${quoteCommandArgument(firstSessionFilePath)}`,
        'Then start dev again with the intended session file and port.',
    ].join('\n');
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
    const startPreparation = await prepareDevSessionStart({
        appRoot: app.paths.root,
        replaceExisting: cli.args.replaceExisting === true,
        sessionFilePath,
    });

    if (startPreparation.blocking.length > 0) {
        throw new Error(createBlockingDevSessionMessage(startPreparation.blocking));
    }

    currentDevSessionFilePath = sessionFilePath;
    registerDevSessionExitCleanup();
    const sessionRecord = createDevSessionRecord({
        appRoot: app.paths.root,
        port: app.env.router.port,
        sessionFilePath,
    });

    await writeDevSessionRecord(sessionRecord);
    await writeMachineDevSessionRecord(sessionRecord);

    logVerbose(`Registered Proteum dev session at ${sessionFilePath}.`);
    if (startPreparation.cleaned.length > 0) {
        logVerbose(
            `Cleaned ${startPreparation.cleaned.length} stale Proteum dev session file${startPreparation.cleaned.length === 1 ? '' : 's'}.`,
        );
    }
    if (startPreparation.replaced) {
        logVerbose(`Replaced Proteum dev session at ${startPreparation.replaced.sessionFilePath}.`);
    }
};

const ensureMachineMcpDaemonForDev = async () => {
    try {
        const result = await ensureMachineMcpDaemonProcess({ coreRoot: cli.paths.core.root });
        const record = result.inspection.record;
        if (!record) return;

        logVerbose(
            result.started
                ? `Started Proteum machine MCP daemon at ${record.mcpUrl}.`
                : `Proteum machine MCP daemon already running at ${record.mcpUrl}.`,
        );
    } catch (error) {
        console.warn(
            `Warning: Proteum could not ensure the machine MCP daemon. ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
};

const describeDevPortBlocker = (inspection: TDevPortInspection) => {
    const lines = [
        `Proteum cannot start this dev server on port ${inspection.router.port}.`,
        `Router port ${inspection.router.port}: ${inspection.router.available ? 'free' : 'occupied'}.`,
        `HMR port ${inspection.hmr.port}: ${inspection.hmr.available ? 'free' : 'occupied'}.`,
    ];

    if (!inspection.router.available && inspection.router.proteum && inspection.router.matchesApp) {
        lines.push(
            `The router port is already serving this Proteum app${inspection.router.app?.appRoot ? ` from ${inspection.router.app.appRoot}` : ''}.`,
        );
        lines.push('Next action: run `npx proteum runtime status`, use or stop the existing runtime, then start one tracked dev session.');
        lines.push('Do not start a second dev server for the same worktree.');
    } else if (!inspection.router.available && inspection.router.proteum) {
        lines.push(
            `The router port is already serving ${inspection.router.app?.identifier || inspection.router.app?.name || 'another Proteum app'}${inspection.router.app?.appRoot ? ` from ${inspection.router.app.appRoot}` : ''}.`,
        );
        lines.push(
            inspection.recommendedPort
                ? `Next action: npx proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port ${inspection.recommendedPort}`
                : 'Next action: choose a free router/HMR port pair, then rerun proteum dev with --port <free-port>.',
        );
    } else if (!inspection.router.available) {
        lines.push('The router port is occupied by a non-Proteum or unrecognized process.');
        lines.push(
            inspection.recommendedPort
                ? `Next action: npx proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port ${inspection.recommendedPort}`
                : 'Next action: choose a free router/HMR port pair, then rerun proteum dev with --port <free-port>.',
        );
    } else if (!inspection.hmr.available) {
        lines.push('The HMR port is occupied.');
        lines.push(
            inspection.recommendedPort
                ? `Next action: npx proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port ${inspection.recommendedPort}`
                : 'Next action: choose a free router/HMR port pair, then rerun proteum dev with --port <free-port>.',
        );
    }

    lines.push('Do not inspect page bodies to identify the owner; use `npx proteum runtime status` for compact port/runtime state.');

    return lines.join('\n');
};

const ensureConfiguredDevPortsAvailable = async () => {
    const inspection = await inspectDevPort({
        appRoot: app.paths.root,
        port: app.env.router.port,
    });

    if (inspection.canStartOnConfiguredPort) return;

    if (cli.args.replaceExisting === true) {
        const requestedSessionFilePath = getResolvedDevSessionFilePath();
        const [requestedSession] = await listDevSessionInspections({
            appRoot: app.paths.root,
            sessionFilePath: requestedSessionFilePath,
        });

        if (requestedSession?.record && requestedSession.live) return;
    }

    throw new Error(describeDevPortBlocker(inspection));
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
                            connectedProjects: message.connectedProjects,
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

const resolveWatchPathAliases = (watchPath: string) => {
    const aliases = new Set([normalizeWatchPath(watchPath)]);

    try {
        aliases.add(normalizeWatchPath(realpathSync(watchPath)));
    } catch {}

    return [...aliases];
};

type TIndexedSourceWatchEvent = 'change' | 'rename';
type TIndexedSourceWatchCompilerName = 'server' | 'client';
type TIndexedSourceWatchInvalidateTarget = 'all' | TIndexedSourceWatchCompilerName;
type TIndexedSourceWatchRule = {
    compilerNames: TIndexedSourceWatchCompilerName[];
    rootPath: string;
    relativePathPattern: RegExp;
    eventTypes: TIndexedSourceWatchEvent[];
    invalidateTargets: TIndexedSourceWatchInvalidateTarget[];
};
type TNamedWatching = { compiler: { name?: string }; invalidate: () => void };
type TMultiWatchingLike = TDevWatching & { watchings?: TNamedWatching[] };

const resolveIndexedSourceWatchRules = (): TIndexedSourceWatchRule[] => {
    const transpileWatchRoots = app.transpileModuleDirectories
        .flatMap((rootPath) => resolveWatchPathAliases(rootPath))
        .filter((rootPath, index, list) => list.indexOf(rootPath) === index);

    return [
        {
            compilerNames: ['server'],
            rootPath: app.paths.root,
            relativePathPattern: /^commands(?:\/|$)/,
            eventTypes: ['rename'],
            invalidateTargets: ['all'],
        },
        {
            compilerNames: ['server'],
            rootPath: cli.paths.core.root,
            relativePathPattern: /^commands(?:\/|$)/,
            eventTypes: ['rename'],
            invalidateTargets: ['all'],
        },
        ...transpileWatchRoots.map(
            (rootPath): TIndexedSourceWatchRule => ({
                compilerNames: ['client', 'server'],
                rootPath,
                relativePathPattern: transpileSourceWatchPattern,
                eventTypes: ['change', 'rename'],
                invalidateTargets: ['all'],
            }),
        ),
    ];
};

const findCompilerWatching = (
    watching: TDevWatching,
    compilerName: TIndexedSourceWatchCompilerName,
): TNamedWatching | undefined => {
    const childWatchings = (watching as TMultiWatchingLike).watchings;

    return childWatchings?.find((childWatching) => childWatching.compiler.name === compilerName);
};

const formatInvalidateTargets = (invalidateTargets: TIndexedSourceWatchCompilerName[]) => {
    if (invalidateTargets.length === 1) return invalidateTargets[0];
    if (invalidateTargets.length === 2) return `${invalidateTargets[0]} and ${invalidateTargets[1]}`;
    return `${invalidateTargets.slice(0, -1).join(', ')}, and ${invalidateTargets[invalidateTargets.length - 1]}`;
};

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
    const pendingChanges = new Map<TIndexedSourceWatchCompilerName, Set<string>>();
    const pendingInvalidateTargets = new Set<TIndexedSourceWatchInvalidateTarget>();
    const recentQueuedChanges = new Map<string, number>();
    let invalidateTimer: NodeJS.Timeout | undefined;

    const flushInvalidate = () => {
        invalidateTimer = undefined;

        for (const [compilerName, changedFiles] of pendingChanges) {
            compiler.noteManualModifiedFiles(compilerName, [...changedFiles]);
        }

        pendingChanges.clear();

        if (pendingInvalidateTargets.has('all')) {
            pendingInvalidateTargets.clear();
            logVerbose('Indexed source files changed. Invalidating all dev compilers to refresh generated artifacts.');
            watching.invalidate();
            return;
        }

        const invalidateTargets = [...pendingInvalidateTargets].filter(
            (invalidateTarget): invalidateTarget is TIndexedSourceWatchCompilerName => invalidateTarget !== 'all',
        );
        pendingInvalidateTargets.clear();

        if (invalidateTargets.length === 0) return;

        const compilerWatchings: TNamedWatching[] = [];

        for (const invalidateTarget of invalidateTargets) {
            const compilerWatching = findCompilerWatching(watching, invalidateTarget);

            if (!compilerWatching) {
                logVerbose('Transpiled source files changed. Invalidating all dev compilers to refresh mutable package code.');
                watching.invalidate();
                return;
            }

            compilerWatchings.push(compilerWatching);
        }

        logVerbose(
            `Transpiled source files changed. Invalidating ${formatInvalidateTargets(
                invalidateTargets,
            )} compilers to refresh mutable package code.`,
        );
        for (const compilerWatching of compilerWatchings) {
            compilerWatching.invalidate();
        }
    };

    const queueInvalidate = ({
        compilerNames,
        filepath,
        invalidateTargets,
    }: {
        compilerNames: TIndexedSourceWatchCompilerName[];
        filepath: string;
        invalidateTargets: TIndexedSourceWatchInvalidateTarget[];
    }) => {
        const normalizedFilepath = normalizeWatchPath(filepath);
        const queueKey = `${invalidateTargets.join(',')}:${compilerNames.join(',')}:${normalizedFilepath}`;
        const queuedAt = recentQueuedChanges.get(queueKey);

        if (queuedAt !== undefined && Date.now() - queuedAt < 250) return;

        recentQueuedChanges.set(queueKey, Date.now());

        for (const compilerName of compilerNames) {
            const changedFiles = pendingChanges.get(compilerName) || new Set<string>();

            changedFiles.add(normalizedFilepath);
            pendingChanges.set(compilerName, changedFiles);
        }

        for (const invalidateTarget of invalidateTargets) {
            pendingInvalidateTargets.add(invalidateTarget);
        }

        if (invalidateTimer) return;
        invalidateTimer = setTimeout(flushInvalidate, 40);
    };

    for (const watchRule of resolveIndexedSourceWatchRules()) {
        const rootPath = watchRule.rootPath;
        if (!fs.existsSync(rootPath)) continue;

        watchers.push(
            watch(rootPath, { recursive: true }, (eventType, filename) => {
                const relativePath = typeof filename === 'string' ? filename.replace(/\\/g, '/').replace(/^\.\//, '') : '';
                const normalizedEventType: TIndexedSourceWatchEvent = eventType === 'change' ? 'change' : 'rename';

                if (relativePath && !watchRule.relativePathPattern.test(relativePath)) return;
                if (!watchRule.eventTypes.includes(normalizedEventType) && relativePath) return;

                queueInvalidate({
                    compilerNames: watchRule.compilerNames,
                    filepath: relativePath ? path.join(rootPath, relativePath) : rootPath,
                    invalidateTargets: watchRule.invalidateTargets,
                });
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
    await ensureConfiguredDevPortsAvailable();
    clearInteractiveConsole();
    await ensureDevSessionSlot();
    await ensureMachineMcpDaemonForDev();
    const proteumInstall = resolveFrameworkInstallInfo({
        appRoot: app.paths.root,
        framework: cli.paths.framework,
    });

    const devEventServer = await createDevEventServer(app.env.router.port + 1);
    app.devEventPort = devEventServer.port;
    console.info(
        await renderDevSession({
            appName: getDevAppName(app),
            appRoot: app.paths.root === process.cwd() ? '.' : app.paths.root,
            connectedProjects: Object.values(app.env.connectedProjects),
            routerPort: app.env.router.port,
            devEventPort: devEventServer.port,
            proteumInstallSummary: proteumInstall.summary,
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
            ignored: ignoredWatchMatcher as never,

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

    await ensureProjectAgentInstructions();
    await runDevLoop();
};
