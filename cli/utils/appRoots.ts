import fs from 'fs-extra';
import path from 'path';
import type { Dirent } from 'fs';

import { readProteumManifest, type TProteumManifest } from '../compiler/common/proteumManifest';

export type TProteumAppRootSummary = {
    appRoot: string;
    hasManifest: boolean;
    manifest?: {
        counts: {
            connectedProjects: number;
            controllers: number;
            routes: number;
        };
        diagnostics: {
            errors: number;
            warnings: number;
        };
        identifier: string;
        name: string;
        routerPort: number;
    };
    manifestError?: string;
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
    relativeAppRoot?: string;
};

const proteumAppRootRequiredEntries = ['package.json', 'identity.config.ts', 'proteum.config.ts', 'client', 'server'];
const ignoredSearchDirectories = new Set([
    '.cache',
    '.git',
    '.proteum',
    'bin',
    'coverage',
    'dev',
    'node_modules',
    'playwright-report',
    'test-results',
    'var',
]);

const resolveExistingPath = (value: string) => {
    const resolved = path.resolve(value);

    try {
        return fs.realpathSync(resolved);
    } catch {
        return resolved;
    }
};

const pathEntryExists = (filepath: string) => {
    try {
        fs.lstatSync(filepath);
        return true;
    } catch {
        return false;
    }
};

const isDirectory = (filepath: string) => {
    try {
        return fs.statSync(filepath).isDirectory();
    } catch {
        return false;
    }
};

const resolveSearchRoot = (value: string) => {
    const resolved = resolveExistingPath(value);
    if (isDirectory(resolved)) return resolved;
    return path.dirname(resolved);
};

export const isProteumAppRoot = (workdir: string) =>
    proteumAppRootRequiredEntries.every((entry) => pathEntryExists(path.join(workdir, entry)));

export const findNearestProteumAppRoot = (startPath: string) => {
    let currentPath = resolveSearchRoot(startPath);

    while (true) {
        if (isProteumAppRoot(currentPath)) return currentPath;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

export const findProteumAppRootsUnder = (root: string, { maxDepth = 5 }: { maxDepth?: number } = {}) => {
    const searchRoot = resolveSearchRoot(root);
    const appRoots: string[] = [];
    const seen = new Set<string>();

    const visit = (directory: string, depth: number) => {
        const canonicalDirectory = resolveExistingPath(directory);
        if (seen.has(canonicalDirectory)) return;
        seen.add(canonicalDirectory);

        if (isProteumAppRoot(canonicalDirectory)) {
            appRoots.push(canonicalDirectory);
            return;
        }

        if (depth >= maxDepth) return;

        let entries: Dirent[];
        try {
            entries = fs.readdirSync(canonicalDirectory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (ignoredSearchDirectories.has(entry.name)) continue;
            visit(path.join(canonicalDirectory, entry.name), depth + 1);
        }
    };

    visit(searchRoot, 0);

    return appRoots.sort((left, right) => left.localeCompare(right));
};

const findPackageManager = (appRoot: string): TProteumAppRootSummary['packageManager'] => {
    let currentPath = path.resolve(appRoot);

    while (true) {
        if (pathEntryExists(path.join(currentPath, 'package-lock.json'))) return 'npm';
        if (pathEntryExists(path.join(currentPath, 'pnpm-lock.yaml'))) return 'pnpm';
        if (pathEntryExists(path.join(currentPath, 'yarn.lock'))) return 'yarn';

        if (pathEntryExists(path.join(currentPath, '.git'))) return 'unknown';

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return 'unknown';
        currentPath = parentPath;
    }
};

const summarizeManifest = (manifest: TProteumManifest): NonNullable<TProteumAppRootSummary['manifest']> => {
    const errors = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warnings = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;

    return {
        counts: {
            connectedProjects: manifest.connectedProjects.length,
            controllers: manifest.controllers.length,
            routes: manifest.routes.client.length + manifest.routes.server.length,
        },
        diagnostics: { errors, warnings },
        identifier: manifest.app.identity.identifier,
        name: manifest.app.identity.name,
        routerPort: manifest.env.resolved.routerPort,
    };
};

export const readProteumAppRootSummary = (appRoot: string, baseRoot?: string): TProteumAppRootSummary => {
    const normalizedAppRoot = resolveExistingPath(appRoot);
    const relativeAppRoot = baseRoot ? path.relative(resolveExistingPath(baseRoot), normalizedAppRoot) || '.' : undefined;
    const summary: TProteumAppRootSummary = {
        appRoot: normalizedAppRoot,
        hasManifest: false,
        packageManager: findPackageManager(normalizedAppRoot),
        relativeAppRoot,
    };

    try {
        const manifest = readProteumManifest(normalizedAppRoot);
        summary.hasManifest = true;
        summary.manifest = summarizeManifest(manifest);
    } catch (error) {
        summary.manifestError = error instanceof Error ? error.message : String(error);
    }

    return summary;
};

export const resolveProteumAppRootContext = (cwd: string) => {
    const normalizedCwd = resolveSearchRoot(cwd);
    const nearestAppRoot = findNearestProteumAppRoot(normalizedCwd);
    const appRoots = nearestAppRoot ? [nearestAppRoot] : findProteumAppRootsUnder(normalizedCwd);

    return {
        cwd: normalizedCwd,
        isAppRoot: nearestAppRoot === normalizedCwd,
        isWrapper: !nearestAppRoot && appRoots.length > 0,
        nearestAppRoot,
        appRoots,
        appCandidates: appRoots.map((appRoot) => readProteumAppRootSummary(appRoot, normalizedCwd)),
    };
};

export const quoteShellPath = (value: string) => JSON.stringify(value);

const createAppScopedCommand = ({
    appRoot,
    baseRoot,
    command,
}: {
    appRoot: string;
    baseRoot?: string;
    command: string;
}) => {
    const relativeAppRoot = baseRoot ? path.relative(resolveExistingPath(baseRoot), resolveExistingPath(appRoot)) || '.' : '';

    if (!relativeAppRoot || relativeAppRoot === '.') return command;
    return `cd ${quoteShellPath(relativeAppRoot)} && ${command}`;
};

export const createStartDevCommand = ({
    appRoot,
    baseRoot,
    port,
}: {
    appRoot: string;
    baseRoot?: string;
    port?: number;
}) => {
    const command = `npx proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port ${port || '<free-port>'}`;

    return createAppScopedCommand({ appRoot, baseRoot, command });
};

export const createRuntimeStatusCommand = ({ appRoot, baseRoot }: { appRoot: string; baseRoot?: string }) =>
    createAppScopedCommand({
        appRoot,
        baseRoot,
        command: 'npx proteum runtime status',
    });
