import cp from 'child_process';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { findProteumAppRootsUnder } from '../utils/appRoots';

/*----------------------------------
- TYPES
----------------------------------*/

export type TWorktreeBootstrapStepStatus = 'failed' | 'ok' | 'skipped' | 'up-to-date' | 'installed';

export type TWorktreeBootstrapMarker = {
    agentsHash?: string;
    createdAt: string;
    dependencies: {
        nodeModulesPresent: boolean;
        packageLockHash?: string;
        ranAt?: string;
        reason?: string;
        status: TWorktreeBootstrapStepStatus;
    };
    env: {
        copied: boolean;
        copiedAt?: string;
        present: boolean;
        root?: {
            copied: boolean;
            copiedAt?: string;
            filepath: string;
            present: boolean;
            source?: string;
        };
        source?: string;
    };
    packageLockHash?: string;
    proteumConfigHash?: string;
    proteumVersion: string;
    refresh: {
        ranAt: string;
        status: TWorktreeBootstrapStepStatus;
    };
    runtimeStatus: {
        checkedAt: string;
        status: TWorktreeBootstrapStepStatus;
        summary?: string;
    };
    skips?: {
        dependencies?: {
            at: string;
            reason: string;
        };
    };
    updatedAt: string;
    version: 1;
};

export type TWorktreeBootstrapStaleReason = {
    code: string;
    message: string;
};

export type TWorktreeBootstrapStatus = {
    blocking: boolean;
    bypassed: boolean;
    guarded: boolean;
    marker?: TWorktreeBootstrapMarker;
    markerFilepath: string;
    nextAction: {
        command: string;
        label: string;
        reason: string;
    };
    ok: boolean;
    staleReasons: TWorktreeBootstrapStaleReason[];
    state: 'bypassed' | 'fresh' | 'missing' | 'not-codex-worktree' | 'stale';
};

export type TWorktreeBootstrapDiagnostic = {
    code: string;
    filepath: string;
    fixHint?: string;
    level: 'error' | 'warning';
    message: string;
};

type TWorktreeBootstrapInputs = {
    agentsHash?: string;
    envPresent: boolean;
    manifestPresent: boolean;
    nodeModulesPresent: boolean;
    packageLockHash?: string;
    proteumConfigHash?: string;
    proteumVersion: string;
    rootEnv?: {
        filepath: string;
        present: boolean;
        required: boolean;
    };
};

type TRunCaptureResult = {
    stderr: string;
    stdout: string;
    summary?: string;
};

export type TRunWorktreeBootstrapInitOptions = {
    appRoot: string;
    coreRoot: string;
    json?: boolean;
    proteumVersion: string;
    reason?: string;
    refresh?: boolean;
    runDependencies?: (appRoot: string) => Promise<void>;
    runRefresh?: (appRoot: string, coreRoot: string) => Promise<TRunCaptureResult>;
    runRuntimeStatus?: (appRoot: string, coreRoot: string) => Promise<TRunCaptureResult>;
    skipDeps?: boolean;
    source?: string;
};

export type TRunWorktreeBootstrapCreateOptions = TRunWorktreeBootstrapInitOptions & {
    base?: string;
    branch: string;
    targetRepoRoot: string;
};

export type TMonorepoWorktreeBootstrapAppResult = {
    appRoot: string;
    error?: string;
    markerFilepath?: string;
    ok: boolean;
    refresh?: string;
    relativeAppRoot: string;
    runtimeStatus?: string;
    sourceAppRoot?: string;
    status?: TWorktreeBootstrapStatus;
};

export type TRunMonorepoWorktreeBootstrapInitOptions = Omit<TRunWorktreeBootstrapInitOptions, 'appRoot' | 'source'> & {
    appRoots?: string[];
    monorepoRoot: string;
    source?: string;
};

export type TRunMonorepoWorktreeBootstrapCreateOptions = TRunMonorepoWorktreeBootstrapInitOptions & {
    base?: string;
    branch: string;
    targetRepoRoot: string;
};

/*----------------------------------
- CONSTANTS
----------------------------------*/

export const worktreeBootstrapMarkerRelativePath = path.join('.proteum', 'worktree-bootstrap.json');

const allowUnbootstrappedEnv = 'PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE';
const codexWorktreeSegment = `${path.sep}.codex${path.sep}worktrees${path.sep}`;

/*----------------------------------
- HELPERS
----------------------------------*/

const normalizePath = (value: string) => path.normalize(path.resolve(value));

const normalizeExistingPath = (value: string) => {
    const normalized = normalizePath(value);

    try {
        return path.normalize(fs.realpathSync(normalized));
    } catch {
        return normalized;
    }
};

const isTruthyEnv = (value: string | undefined) => value === '1' || value === 'true' || value === 'yes';

const nowIso = () => new Date().toISOString();

export const isCodexWorktreePath = (value: string) => normalizePath(value).includes(codexWorktreeSegment);

const findNearestExistingPath = (startPath: string, filename: string) => {
    let currentPath = normalizePath(startPath);

    while (true) {
        const candidate = path.join(currentPath, filename);
        if (fs.existsSync(candidate)) return candidate;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const findVisibleDirectory = (startPath: string, directoryName: string) => {
    let currentPath = normalizePath(startPath);

    while (true) {
        const candidate = path.join(currentPath, directoryName);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const readJsonFile = (filepath: string) => {
    try {
        return fs.readJSONSync(filepath) as Record<string, unknown>;
    } catch {
        return {};
    }
};

const hasWorkspaceRootTooling = (workspaceRoot: string) => {
    if (fs.existsSync(path.join(workspaceRoot, 'prisma.config.ts'))) return true;

    const packageJson = readJsonFile(path.join(workspaceRoot, 'package.json'));
    return Array.isArray(packageJson.workspaces);
};

const resolveWorkspaceRootEnv = (appRoot: string) => {
    const packageLockFilepath = findNearestExistingPath(appRoot, 'package-lock.json');
    if (!packageLockFilepath) return undefined;

    const workspaceRoot = path.dirname(packageLockFilepath);
    if (workspaceRoot === normalizePath(appRoot)) return undefined;
    if (!hasWorkspaceRootTooling(workspaceRoot)) return undefined;

    return path.join(workspaceRoot, '.env');
};

const hashFile = (filepath: string | undefined) => {
    if (!filepath || !fs.existsSync(filepath)) return undefined;

    return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
};

const readMarker = (markerFilepath: string) => {
    if (!fs.existsSync(markerFilepath)) return { marker: undefined, invalid: false };

    try {
        return { marker: fs.readJSONSync(markerFilepath) as TWorktreeBootstrapMarker, invalid: false };
    } catch {
        return { marker: undefined, invalid: true };
    }
};

const readInputs = (appRoot: string, proteumVersion: string): TWorktreeBootstrapInputs => {
    const packageLockFilepath = findNearestExistingPath(appRoot, 'package-lock.json');
    const rootEnvFilepath = resolveWorkspaceRootEnv(appRoot);

    return {
        agentsHash: hashFile(path.join(appRoot, 'AGENTS.md')),
        envPresent: fs.existsSync(path.join(appRoot, '.env')),
        manifestPresent: fs.existsSync(path.join(appRoot, '.proteum', 'manifest.json')),
        nodeModulesPresent: findVisibleDirectory(appRoot, 'node_modules') !== undefined,
        packageLockHash: hashFile(packageLockFilepath),
        proteumConfigHash: hashFile(path.join(appRoot, 'proteum.config.ts')),
        proteumVersion,
        rootEnv: rootEnvFilepath
            ? {
                  filepath: rootEnvFilepath,
                  present: fs.existsSync(rootEnvFilepath),
                  required: true,
              }
            : undefined,
    };
};

const dependenciesWereIntentionallySkipped = (marker: TWorktreeBootstrapMarker | undefined, inputs: TWorktreeBootstrapInputs) =>
    marker?.dependencies.status === 'skipped' &&
    marker.dependencies.packageLockHash === inputs.packageLockHash &&
    Boolean(marker.skips?.dependencies?.reason);

const collectStaleReasons = ({
    inputs,
    invalid,
    marker,
}: {
    inputs: TWorktreeBootstrapInputs;
    invalid: boolean;
    marker?: TWorktreeBootstrapMarker;
}) => {
    const reasons: TWorktreeBootstrapStaleReason[] = [];

    if (invalid) reasons.push({ code: 'worktree-bootstrap/invalid-marker', message: 'The bootstrap marker is unreadable.' });
    if (!marker) return reasons;

    if (marker.proteumVersion !== inputs.proteumVersion)
        reasons.push({ code: 'worktree-bootstrap/proteum-version-changed', message: 'Proteum version changed since bootstrap.' });
    if (marker.packageLockHash !== inputs.packageLockHash)
        reasons.push({ code: 'worktree-bootstrap/package-lock-changed', message: 'package-lock.json changed since bootstrap.' });
    if (marker.proteumConfigHash !== inputs.proteumConfigHash)
        reasons.push({ code: 'worktree-bootstrap/proteum-config-changed', message: 'proteum.config.ts changed since bootstrap.' });
    if (marker.agentsHash !== inputs.agentsHash)
        reasons.push({ code: 'worktree-bootstrap/agents-changed', message: 'AGENTS.md changed since bootstrap.' });
    if (!inputs.envPresent) reasons.push({ code: 'worktree-bootstrap/env-missing', message: '.env is missing.' });
    if (inputs.rootEnv?.required && !inputs.rootEnv.present)
        reasons.push({ code: 'worktree-bootstrap/root-env-missing', message: 'Workspace root .env is missing.' });
    if (!inputs.manifestPresent)
        reasons.push({ code: 'worktree-bootstrap/manifest-missing', message: '.proteum/manifest.json is missing.' });
    if (!inputs.nodeModulesPresent && !dependenciesWereIntentionallySkipped(marker, inputs))
        reasons.push({ code: 'worktree-bootstrap/node-modules-missing', message: 'node_modules is missing.' });
    if (marker.refresh.status !== 'ok')
        reasons.push({ code: 'worktree-bootstrap/refresh-not-ok', message: 'The last bootstrap refresh did not complete.' });
    if (marker.runtimeStatus.status !== 'ok')
        reasons.push({ code: 'worktree-bootstrap/runtime-status-not-ok', message: 'The last bootstrap runtime status check did not complete.' });

    return reasons;
};

const createNextAction = (state: TWorktreeBootstrapStatus['state']) => ({
    label: state === 'stale' ? 'Refresh Worktree Bootstrap' : 'Initialize Worktree Bootstrap',
    command: `npx proteum worktree init --source <source-app-root>${state === 'stale' ? ' --refresh' : ''}`,
    reason:
        state === 'stale'
            ? 'Refresh the Proteum worktree bootstrap marker before running runtime or verification commands.'
            : 'Complete Proteum worktree bootstrap before running runtime or verification commands.',
});

const runCapture = (command: string, args: string[], { cwd, env }: { cwd: string; env?: NodeJS.ProcessEnv }) =>
    new Promise<TRunCaptureResult>((resolve, reject) => {
        const child = cp.spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');

            if (signal) {
                reject(new Error(`Command "${command}" was interrupted by signal ${signal}.`));
                return;
            }

            if (code === 0) {
                const outputLines = stdout.trim().split(/\r?\n/).filter(Boolean);
                resolve({ stdout, stderr, summary: outputLines[outputLines.length - 1] });
                return;
            }

            reject(new Error([`Command "${command}" exited with code ${code ?? 'unknown'}.`, stdout, stderr].filter(Boolean).join('\n')));
        });
    });

const runProteumCli = async (appRoot: string, coreRoot: string, args: string[]) =>
    await runCapture(process.execPath, [path.join(coreRoot, 'cli', 'bin.js'), ...args], {
        cwd: appRoot,
        env: { [allowUnbootstrappedEnv]: '1' },
    });

const runNpmInstall = (appRoot: string) =>
    new Promise<void>((resolve, reject) => {
        const child = cp.spawn('npm', ['install'], { cwd: appRoot, stdio: 'inherit' });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Command "npm install" was interrupted by signal ${signal}.`));
                return;
            }

            if (code === 0) resolve();
            else reject(new Error(`Command "npm install" exited with code ${code ?? 'unknown'}.`));
        });
    });

const defaultRunRefresh = async (appRoot: string, coreRoot: string) => await runProteumCli(appRoot, coreRoot, ['refresh']);

const defaultRunRuntimeStatus = async (appRoot: string, coreRoot: string) =>
    await runProteumCli(appRoot, coreRoot, ['runtime', 'status', '--full']);

const resolveDependencyAction = ({
    inputs,
    marker,
}: {
    inputs: TWorktreeBootstrapInputs;
    marker?: TWorktreeBootstrapMarker;
}) => {
    if (!inputs.nodeModulesPresent) return 'install';
    if (marker && marker.packageLockHash !== inputs.packageLockHash) return 'install';
    return 'up-to-date';
};

const resolveSourceRootEnv = (source: string) => {
    const sourceWorkspaceRootEnv = resolveWorkspaceRootEnv(source);
    if (sourceWorkspaceRootEnv && fs.existsSync(sourceWorkspaceRootEnv)) return sourceWorkspaceRootEnv;

    const sourceEnvFilepath = path.join(path.resolve(source), '.env');
    return fs.existsSync(sourceEnvFilepath) ? sourceEnvFilepath : undefined;
};

const requireSourceEnvWhenNeeded = ({ appRoot, source }: { appRoot: string; source?: string }) => {
    const envFilepath = path.join(appRoot, '.env');
    const rootEnvFilepath = resolveWorkspaceRootEnv(appRoot);
    let copied = false;
    let copiedAt: string | undefined;
    let sourceForEnv: string | undefined;

    if (!fs.existsSync(envFilepath)) {
        if (!source) throw new Error('This worktree is missing .env. Pass --source <app-root> with a readable source .env.');

        const sourceEnvFilepath = path.join(path.resolve(source), '.env');
        if (!fs.existsSync(sourceEnvFilepath)) throw new Error(`Source .env does not exist: ${sourceEnvFilepath}`);

        fs.copyFileSync(sourceEnvFilepath, envFilepath);
        copied = true;
        copiedAt = nowIso();
        sourceForEnv = path.resolve(source);
    }

    const root: TWorktreeBootstrapMarker['env']['root'] | undefined = rootEnvFilepath
        ? {
              copied: false,
              filepath: rootEnvFilepath,
              present: fs.existsSync(rootEnvFilepath),
          }
        : undefined;

    if (root && !root.present) {
        if (!source) throw new Error('This worktree is missing workspace root .env. Pass --source <app-root> with a readable source .env.');

        const sourceRootEnvFilepath = resolveSourceRootEnv(source);
        if (!sourceRootEnvFilepath) {
            throw new Error(`Source workspace root .env does not exist and source app .env is missing: ${path.resolve(source)}`);
        }

        fs.copyFileSync(sourceRootEnvFilepath, root.filepath);
        root.copied = true;
        root.copiedAt = nowIso();
        root.present = true;
        root.source = sourceRootEnvFilepath;
    }

    return {
        copied,
        ...(copiedAt ? { copiedAt } : {}),
        present: fs.existsSync(envFilepath),
        ...(root ? { root } : {}),
        ...(sourceForEnv ? { source: sourceForEnv } : {}),
    };
};

const writeMarker = (appRoot: string, marker: TWorktreeBootstrapMarker) => {
    const markerFilepath = path.join(appRoot, worktreeBootstrapMarkerRelativePath);

    fs.ensureDirSync(path.dirname(markerFilepath));
    fs.writeJSONSync(markerFilepath, marker, { spaces: 2 });
};

const findGitRepoRoot = async (cwd: string) => {
    const result = await runCapture('git', ['rev-parse', '--show-toplevel'], { cwd });
    return result.stdout.trim();
};

/*----------------------------------
- PUBLIC API
----------------------------------*/

export const getWorktreeBootstrapStatus = ({
    appRoot,
    proteumVersion,
}: {
    appRoot: string;
    proteumVersion: string;
}): TWorktreeBootstrapStatus => {
    const normalizedAppRoot = normalizePath(appRoot);
    const markerFilepath = path.join(normalizedAppRoot, worktreeBootstrapMarkerRelativePath);
    const guarded = isCodexWorktreePath(normalizedAppRoot);
    const bypassed = guarded && isTruthyEnv(process.env[allowUnbootstrappedEnv]);
    const { invalid, marker } = readMarker(markerFilepath);
    const inputs = readInputs(normalizedAppRoot, proteumVersion);

    if (!guarded) {
        return {
            blocking: false,
            bypassed: false,
            guarded,
            marker,
            markerFilepath,
            nextAction: createNextAction('not-codex-worktree'),
            ok: true,
            staleReasons: [],
            state: 'not-codex-worktree',
        };
    }

    const missing = !marker && !invalid;
    const staleReasons = missing
        ? [{ code: 'worktree-bootstrap/missing-marker', message: 'The bootstrap marker is missing.' }]
        : collectStaleReasons({ inputs, invalid, marker });
    const actualState: TWorktreeBootstrapStatus['state'] = staleReasons.length === 0 ? 'fresh' : missing ? 'missing' : 'stale';
    const blocking = !bypassed && actualState !== 'fresh';

    return {
        blocking,
        bypassed,
        guarded,
        marker,
        markerFilepath,
        nextAction: createNextAction(actualState),
        ok: !blocking,
        staleReasons,
        state: bypassed && actualState !== 'fresh' ? 'bypassed' : actualState,
    };
};

export const compactWorktreeBootstrapStatus = (status: TWorktreeBootstrapStatus) => ({
    blocking: status.blocking,
    bypassed: status.bypassed,
    guarded: status.guarded,
    markerFilepath: status.markerFilepath,
    staleReasons: status.staleReasons,
    state: status.state,
    updatedAt: status.marker?.updatedAt,
    dependencies: status.marker?.dependencies
        ? {
              status: status.marker.dependencies.status,
              reason: status.marker.dependencies.reason,
          }
        : undefined,
    skips: status.marker?.skips,
});

export const createWorktreeBootstrapBlockResponse = (status: TWorktreeBootstrapStatus) => ({
    ok: false,
    format: 'proteum-agent-v1',
    summary:
        status.state === 'stale'
            ? 'This worktree bootstrap is stale. Run: npx proteum worktree init --source <source-app-root> --refresh'
            : 'This worktree has not completed Proteum worktree bootstrap. Run: npx proteum worktree init --source <source-app-root>',
    data: {
        worktreeBootstrap: compactWorktreeBootstrapStatus(status),
    },
    nextActions: [status.nextAction],
});

export const createWorktreeBootstrapMcpBlockResponse = (status: TWorktreeBootstrapStatus, project?: object) => ({
    ok: false,
    format: 'proteum-mcp-v1',
    summary:
        status.state === 'stale'
            ? 'This worktree bootstrap is stale. Run: npx proteum worktree init --source <source-app-root> --refresh'
            : 'This worktree has not completed Proteum worktree bootstrap. Run: npx proteum worktree init --source <source-app-root>',
    data: {
        project,
        worktreeBootstrap: compactWorktreeBootstrapStatus(status),
    },
    nextActions: [status.nextAction],
});

export const createWorktreeBootstrapDiagnostics = ({
    appRoot,
    status,
}: {
    appRoot: string;
    status: TWorktreeBootstrapStatus;
}): TWorktreeBootstrapDiagnostic[] => {
    if (!status.guarded) return [];

    const diagnostics: TWorktreeBootstrapDiagnostic[] = [];
    const level = status.bypassed ? 'warning' : 'error';

    if (status.bypassed) {
        diagnostics.push({
            code: 'worktree-bootstrap/bypassed',
            filepath: appRoot,
            fixHint: status.nextAction.command,
            level: 'warning',
            message: 'Worktree bootstrap enforcement is bypassed by PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE.',
        });
    }

    for (const reason of status.staleReasons) {
        diagnostics.push({
            code: reason.code,
            filepath: appRoot,
            fixHint: status.nextAction.command,
            level,
            message: reason.message,
        });
    }

    if (status.marker?.dependencies.status === 'skipped' && status.marker.skips?.dependencies?.reason) {
        diagnostics.push({
            code: 'worktree-bootstrap/dependencies-skipped',
            filepath: appRoot,
            fixHint: 'npx proteum worktree init --source <source-app-root> --refresh',
            level: 'warning',
            message: `Dependency install was skipped during worktree bootstrap: ${status.marker.skips.dependencies.reason}`,
        });
    }

    return diagnostics;
};

export const runWorktreeBootstrapInit = async ({
    appRoot,
    coreRoot,
    proteumVersion,
    reason,
    refresh = false,
    runDependencies = runNpmInstall,
    runRefresh = defaultRunRefresh,
    runRuntimeStatus = defaultRunRuntimeStatus,
    skipDeps = false,
    source,
}: TRunWorktreeBootstrapInitOptions) => {
    const normalizedAppRoot = normalizePath(appRoot);
    const beforeStatus = getWorktreeBootstrapStatus({ appRoot: normalizedAppRoot, proteumVersion });

    if (skipDeps && !reason?.trim()) throw new Error('--skip-deps requires a non-empty --reason.');
    if (beforeStatus.state === 'stale' && !refresh) {
        throw new Error(
            [
                'This worktree bootstrap is stale. Run: npx proteum worktree init --source <source-app-root> --refresh',
                ...beforeStatus.staleReasons.map((entry) => `- ${entry.message}`),
            ].join('\n'),
        );
    }

    const existingMarker = beforeStatus.marker;
    const timestamp = nowIso();
    const env = requireSourceEnvWhenNeeded({ appRoot: normalizedAppRoot, source });
    const refreshResult = await runRefresh(normalizedAppRoot, coreRoot);
    const dependencyInputs = readInputs(normalizedAppRoot, proteumVersion);
    const dependencyAction = resolveDependencyAction({ inputs: dependencyInputs, marker: existingMarker });
    let dependencyStatus: TWorktreeBootstrapMarker['dependencies'];
    let skips: TWorktreeBootstrapMarker['skips'] | undefined;

    if (dependencyAction === 'install' && skipDeps) {
        skips = { dependencies: { at: nowIso(), reason: reason?.trim() || '' } };
        dependencyStatus = {
            nodeModulesPresent: dependencyInputs.nodeModulesPresent,
            packageLockHash: dependencyInputs.packageLockHash,
            ranAt: nowIso(),
            reason: reason?.trim(),
            status: 'skipped',
        };
    } else if (dependencyAction === 'install') {
        await runDependencies(normalizedAppRoot);
        const afterInstallInputs = readInputs(normalizedAppRoot, proteumVersion);
        dependencyStatus = {
            nodeModulesPresent: afterInstallInputs.nodeModulesPresent,
            packageLockHash: afterInstallInputs.packageLockHash,
            ranAt: nowIso(),
            status: 'installed',
        };
    } else {
        dependencyStatus = {
            nodeModulesPresent: dependencyInputs.nodeModulesPresent,
            packageLockHash: dependencyInputs.packageLockHash,
            ranAt: nowIso(),
            status: 'up-to-date',
        };
    }

    const runtimeStatus = await runRuntimeStatus(normalizedAppRoot, coreRoot);
    const finalInputs = readInputs(normalizedAppRoot, proteumVersion);
    const marker: TWorktreeBootstrapMarker = {
        agentsHash: finalInputs.agentsHash,
        createdAt: existingMarker?.createdAt || timestamp,
        dependencies: dependencyStatus,
        env,
        packageLockHash: finalInputs.packageLockHash,
        proteumConfigHash: finalInputs.proteumConfigHash,
        proteumVersion,
        refresh: {
            ranAt: timestamp,
            status: 'ok',
        },
        runtimeStatus: {
            checkedAt: nowIso(),
            status: 'ok',
            summary: runtimeStatus.summary,
        },
        skips,
        updatedAt: nowIso(),
        version: 1,
    };

    writeMarker(normalizedAppRoot, marker);

    return {
        appRoot: normalizedAppRoot,
        marker,
        markerFilepath: path.join(normalizedAppRoot, worktreeBootstrapMarkerRelativePath),
        refresh: refreshResult.summary,
        runtimeStatus: runtimeStatus.summary,
        status: getWorktreeBootstrapStatus({ appRoot: normalizedAppRoot, proteumVersion }),
    };
};

export const runWorktreeBootstrapCreate = async ({
    appRoot,
    base = 'HEAD',
    branch,
    targetRepoRoot,
    ...initOptions
}: TRunWorktreeBootstrapCreateOptions) => {
    if (!branch.trim()) throw new Error('worktree create requires --branch <branch>.');
    if (!targetRepoRoot.trim()) throw new Error('worktree create requires <target-repo-root>.');

    const normalizedSourceAppRoot = normalizePath(appRoot);
    const sourceRepoRoot = await findGitRepoRoot(normalizedSourceAppRoot);
    const sourceAppRelativePath = path.relative(sourceRepoRoot, normalizedSourceAppRoot);
    const normalizedTargetRepoRoot = path.resolve(targetRepoRoot);

    await runCapture('git', ['worktree', 'add', '-b', branch, normalizedTargetRepoRoot, base], { cwd: sourceRepoRoot });

    const targetAppRoot = path.join(normalizedTargetRepoRoot, sourceAppRelativePath);
    const initResult = await runWorktreeBootstrapInit({
        ...initOptions,
        appRoot: targetAppRoot,
        source: normalizedSourceAppRoot,
    });

    return {
        branch,
        sourceAppRoot: normalizedSourceAppRoot,
        sourceRepoRoot,
        targetAppRoot,
        targetRepoRoot: normalizedTargetRepoRoot,
        worktreeBootstrap: initResult,
    };
};

const findBootstrapInstallRoot = (appRoot: string) => {
    const packageLockFilepath = findNearestExistingPath(appRoot, 'package-lock.json');
    return packageLockFilepath ? path.dirname(packageLockFilepath) : normalizePath(appRoot);
};

const createSharedDependencyRunner = (runDependencies: (appRoot: string) => Promise<void> = runNpmInstall) => {
    const completedInstallRoots = new Set<string>();

    return async (appRoot: string) => {
        const installRoot = findBootstrapInstallRoot(appRoot);
        if (completedInstallRoots.has(installRoot)) return;

        completedInstallRoots.add(installRoot);
        await runDependencies(installRoot);
    };
};

const resolveSourceAppRoot = ({
    relativeAppRoot,
    sourceRoot,
}: {
    relativeAppRoot: string;
    sourceRoot?: string;
}) => {
    if (!sourceRoot) return undefined;

    const normalizedSourceRoot = normalizeExistingPath(sourceRoot);
    const sourceAppRoot = path.join(normalizedSourceRoot, relativeAppRoot);

    if (fs.existsSync(sourceAppRoot)) return sourceAppRoot;

    return undefined;
};

export const runMonorepoWorktreeBootstrapInit = async ({
    appRoots,
    monorepoRoot,
    runDependencies,
    source,
    ...initOptions
}: TRunMonorepoWorktreeBootstrapInitOptions) => {
    const normalizedMonorepoRoot = normalizeExistingPath(monorepoRoot);
    const targetAppRoots = (appRoots || findProteumAppRootsUnder(normalizedMonorepoRoot))
        .map((appRoot) => normalizeExistingPath(appRoot))
        .sort((left, right) => left.localeCompare(right));
    const sharedDependencyRunner = createSharedDependencyRunner(runDependencies);
    const apps: TMonorepoWorktreeBootstrapAppResult[] = [];

    if (targetAppRoots.length === 0) throw new Error(`No Proteum app roots were found under ${normalizedMonorepoRoot}.`);

    for (const appRoot of targetAppRoots) {
        const relativeAppRoot = path.relative(normalizedMonorepoRoot, appRoot) || '.';
        const sourceAppRoot = resolveSourceAppRoot({
            relativeAppRoot,
            sourceRoot: source,
        });

        try {
            const result = await runWorktreeBootstrapInit({
                ...initOptions,
                appRoot,
                runDependencies: sharedDependencyRunner,
                source: sourceAppRoot,
            });

            apps.push({
                appRoot,
                markerFilepath: result.markerFilepath,
                ok: true,
                refresh: result.refresh,
                relativeAppRoot,
                runtimeStatus: result.runtimeStatus,
                sourceAppRoot,
                status: result.status,
            });
        } catch (error) {
            apps.push({
                appRoot,
                error: error instanceof Error ? error.message : String(error),
                ok: false,
                relativeAppRoot,
                sourceAppRoot,
            });
        }
    }

    return {
        appRoots: targetAppRoots,
        apps,
        failed: apps.filter((entry) => !entry.ok).length,
        monorepoRoot: normalizedMonorepoRoot,
        ok: apps.every((entry) => entry.ok),
        sourceRoot: source ? normalizeExistingPath(source) : undefined,
    };
};

export const runMonorepoWorktreeBootstrapCreate = async ({
    base = 'HEAD',
    branch,
    source,
    targetRepoRoot,
    ...initOptions
}: TRunMonorepoWorktreeBootstrapCreateOptions) => {
    if (!branch.trim()) throw new Error('worktree create requires --branch <branch>.');
    if (!targetRepoRoot.trim()) throw new Error('worktree create requires <target-repo-root>.');

    const normalizedSourceRoot = normalizeExistingPath(source || initOptions.monorepoRoot);
    const normalizedTargetRepoRoot = path.resolve(targetRepoRoot);
    const sourceRepoRoot = await findGitRepoRoot(normalizedSourceRoot);

    await runCapture('git', ['worktree', 'add', '-b', branch, normalizedTargetRepoRoot, base], { cwd: sourceRepoRoot });

    const initResult = await runMonorepoWorktreeBootstrapInit({
        ...initOptions,
        monorepoRoot: normalizedTargetRepoRoot,
        refresh: true,
        source: normalizedSourceRoot,
    });

    return {
        branch,
        sourceMonorepoRoot: normalizedSourceRoot,
        sourceRepoRoot,
        targetRepoRoot: normalizedTargetRepoRoot,
        worktreeBootstrap: initResult,
    };
};
