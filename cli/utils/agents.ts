/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs-extra';
import path from 'path';
import { logVerbose } from '../runtime/verbose';

/*----------------------------------
- TYPES
----------------------------------*/

type TProjectInstructionArgs = { coreRoot: string };
type TConfigureProjectAgentSymlinksArgs = {
    appRoot: string;
    coreRoot: string;
    dryRun?: boolean;
    monorepoRoot?: string;
    overwriteBlockedPaths?: string[];
};

type TAgentLinkDefinition = { projectPath: string; sourcePath: string; ensureParentDir?: boolean };

type TEnsureSymlinksResult = {
    blocked: string[];
    created: string[];
    overwritten: string[];
    skipped: string[];
    updated: string[];
};

export type TConfigureProjectAgentSymlinksResult = {
    appRoot: string;
    blocked: string[];
    created: string[];
    monorepoRoot?: string;
    mode: 'monorepo' | 'standalone';
    overwritten: string[];
    skipped: string[];
    updated: string[];
    updatedGitignores: string[];
};

export type TProjectAgentFileInspection = {
    existing: string[];
    missing: string[];
};

/*----------------------------------
- CONSTANTS
----------------------------------*/

const sharedAppAgentLinkDefinitions: TAgentLinkDefinition[] = [
    { projectPath: 'CODING_STYLE.md', sourcePath: 'CODING_STYLE.md' },
    { projectPath: 'diagnostics.md', sourcePath: 'diagnostics.md' },
    { projectPath: 'optimizations.md', sourcePath: 'optimizations.md' },
    { projectPath: path.join('client', 'AGENTS.md'), sourcePath: path.join('client', 'AGENTS.md') },
    { projectPath: path.join('client', 'pages', 'AGENTS.md'), sourcePath: path.join('client', 'pages', 'AGENTS.md') },
    {
        projectPath: path.join('server', 'services', 'AGENTS.md'),
        sourcePath: path.join('server', 'services', 'AGENTS.md'),
    },
    { projectPath: path.join('server', 'routes', 'AGENTS.md'), sourcePath: path.join('server', 'routes', 'AGENTS.md') },
    { projectPath: path.join('tests', 'e2e', 'AGENTS.md'), sourcePath: path.join('tests', 'AGENTS.md') },
];

const standaloneAppAgentLinkDefinitions: TAgentLinkDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: 'AGENTS.md' },
    ...sharedAppAgentLinkDefinitions,
];

const monorepoAppAgentLinkDefinitions: TAgentLinkDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: path.join('app-root', 'AGENTS.md') },
    ...sharedAppAgentLinkDefinitions,
];

const monorepoRootAgentLinkDefinitions: TAgentLinkDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: path.join('root', 'AGENTS.md') },
];

const projectInstructionGitignoreBlockStart = '# Proteum-managed instruction symlinks';
const projectInstructionGitignoreBlockEnd = '# End Proteum-managed instruction symlinks';

/*----------------------------------
- PUBLIC API
----------------------------------*/

export function configureProjectAgentSymlinks({
    appRoot,
    coreRoot,
    dryRun = false,
    monorepoRoot,
    overwriteBlockedPaths = [],
}: TConfigureProjectAgentSymlinksArgs): TConfigureProjectAgentSymlinksResult {
    const normalizedAppRoot = path.resolve(appRoot);
    const normalizedMonorepoRoot = monorepoRoot ? path.resolve(monorepoRoot) : undefined;
    const normalizedOverwriteBlockedPaths = new Set(
        overwriteBlockedPaths.map((blockedPath) => normalizeAbsolutePath(path.resolve(blockedPath))),
    );
    const mode =
        normalizedMonorepoRoot && normalizedMonorepoRoot !== normalizedAppRoot ? ('monorepo' as const) : ('standalone' as const);
    const result: TConfigureProjectAgentSymlinksResult = {
        appRoot: normalizedAppRoot,
        blocked: [],
        created: [],
        mode,
        overwritten: [],
        skipped: [],
        updated: [],
        updatedGitignores: [],
    };

    if (mode === 'monorepo' && normalizedMonorepoRoot) {
        result.monorepoRoot = normalizedMonorepoRoot;

        const rootLinks = getRootAgentLinkDefinitions({ coreRoot });
        const rootSymlinks = ensureSymlinks(normalizedMonorepoRoot, rootLinks, '[agents]', path.join(coreRoot, 'agents', 'project'), {
            dryRun,
            overwriteBlockedPaths: normalizedOverwriteBlockedPaths,
        });
        mergeSymlinkResults(result, rootSymlinks, normalizedMonorepoRoot);

        if (!dryRun && ensureInstructionGitignoreEntries({ rootDir: normalizedMonorepoRoot, linkDefinitions: rootLinks }))
            result.updatedGitignores.push(path.join(normalizedMonorepoRoot, '.gitignore'));
    }

    const appLinks = getAppAgentLinkDefinitions({ coreRoot, mode });
    const appSymlinks = ensureSymlinks(normalizedAppRoot, appLinks, '[agents]', path.join(coreRoot, 'agents', 'project'), {
        dryRun,
        overwriteBlockedPaths: normalizedOverwriteBlockedPaths,
    });
    mergeSymlinkResults(result, appSymlinks, normalizedAppRoot);

    if (!dryRun && ensureInstructionGitignoreEntries({ rootDir: normalizedAppRoot, linkDefinitions: appLinks }))
        result.updatedGitignores.push(path.join(normalizedAppRoot, '.gitignore'));

    return result;
}

export function getProjectInstructionGitignoreEntries({ coreRoot }: TProjectInstructionArgs) {
    return Array.from(
        new Set(
            getAppAgentLinkDefinitions({ coreRoot, mode: 'standalone' }).map((linkDefinition) =>
                `/${normalizeProjectPathForGitignore(linkDefinition.projectPath)}`,
            ),
        ),
    );
}

export function renderProjectInstructionGitignoreBlock({ coreRoot }: TProjectInstructionArgs) {
    return renderInstructionGitignoreBlock({ linkDefinitions: getAppAgentLinkDefinitions({ coreRoot, mode: 'standalone' }) });
}

export function inspectProjectAgentFiles({ appRoot }: { appRoot: string }): TProjectAgentFileInspection {
    const normalizedAppRoot = path.resolve(appRoot);
    const expectedAgentPaths = Array.from(
        new Set(
            standaloneAppAgentLinkDefinitions
                .map((linkDefinition) => linkDefinition.projectPath)
                .filter((projectPath) => projectPath.endsWith('AGENTS.md')),
        ),
    );
    const result: TProjectAgentFileInspection = {
        existing: [],
        missing: [],
    };

    for (const projectPath of expectedAgentPaths) {
        const absolutePath = path.join(normalizedAppRoot, projectPath);
        const parentPath = path.dirname(absolutePath);

        if (projectPath !== 'AGENTS.md' && !fs.existsSync(parentPath)) continue;

        if (fs.existsSync(absolutePath)) {
            result.existing.push(projectPath);
            continue;
        }

        result.missing.push(projectPath);
    }

    return result;
}

/*----------------------------------
- HELPERS
----------------------------------*/

function getAppAgentLinkDefinitions({
    coreRoot,
    mode,
}: TProjectInstructionArgs & { mode: 'monorepo' | 'standalone' }) {
    const agentSourceRoot = path.join(coreRoot, 'agents', 'project');
    const sourceDefinitions = mode === 'monorepo' ? monorepoAppAgentLinkDefinitions : standaloneAppAgentLinkDefinitions;

    return resolveAgentLinkDefinitions({
        agentSourceRoot,
        linkDefinitions: sourceDefinitions,
    });
}

function getRootAgentLinkDefinitions({ coreRoot }: TProjectInstructionArgs) {
    return resolveAgentLinkDefinitions({
        agentSourceRoot: path.join(coreRoot, 'agents', 'project'),
        linkDefinitions: monorepoRootAgentLinkDefinitions,
    });
}

function resolveAgentLinkDefinitions({
    agentSourceRoot,
    linkDefinitions,
}: {
    agentSourceRoot: string;
    linkDefinitions: TAgentLinkDefinition[];
}) {
    return linkDefinitions.map((linkDefinition) => ({
        ...linkDefinition,
        sourcePath: path.join(agentSourceRoot, linkDefinition.sourcePath),
    }));
}

function renderInstructionGitignoreBlock({ linkDefinitions }: { linkDefinitions: TAgentLinkDefinition[] }) {
    const entries = Array.from(
        new Set(linkDefinitions.map((linkDefinition) => `/${normalizeProjectPathForGitignore(linkDefinition.projectPath)}`)),
    );

    return [projectInstructionGitignoreBlockStart, ...entries, projectInstructionGitignoreBlockEnd].join('\n');
}

function ensureInstructionGitignoreEntries({
    rootDir,
    linkDefinitions,
}: {
    rootDir: string;
    linkDefinitions: TAgentLinkDefinition[];
}) {
    const gitignoreFilepath = path.join(rootDir, '.gitignore');
    if (!pathEntryExists(gitignoreFilepath)) return false;

    const managedEntries = new Set(linkDefinitions.map((linkDefinition) => normalizeGitignoreEntry(linkDefinition.projectPath)));
    const lines = fs.readFileSync(gitignoreFilepath, 'utf8').split(/\r?\n/);
    const filteredLines: string[] = [];
    let insideManagedBlock = false;

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine === projectInstructionGitignoreBlockStart) {
            insideManagedBlock = true;
            continue;
        }

        if (trimmedLine === projectInstructionGitignoreBlockEnd) {
            insideManagedBlock = false;
            continue;
        }

        if (insideManagedBlock) continue;
        if (shouldSkipLegacyManagedGitignoreLine(line, managedEntries)) continue;

        filteredLines.push(line);
    }

    const baseContent = trimTrailingBlankLines(filteredLines).join('\n');
    const managedBlock = renderInstructionGitignoreBlock({ linkDefinitions });
    const nextContent = baseContent ? `${baseContent}\n\n${managedBlock}\n` : `${managedBlock}\n`;

    if (nextContent === fs.readFileSync(gitignoreFilepath, 'utf8')) return false;

    fs.writeFileSync(gitignoreFilepath, nextContent);
    logVerbose(`[agents] Updated ${path.relative(rootDir, gitignoreFilepath) || '.gitignore'} with Proteum-managed instruction ignore entries.`);

    return true;
}

function ensureSymlinks(
    rootDir: string,
    linkDefinitions: TAgentLinkDefinition[],
    logPrefix: string,
    managedSourceRoot: string,
    {
        dryRun,
        overwriteBlockedPaths,
    }: {
        dryRun: boolean;
        overwriteBlockedPaths: Set<string>;
    },
): TEnsureSymlinksResult {
    const result: TEnsureSymlinksResult = {
        blocked: [],
        created: [],
        overwritten: [],
        skipped: [],
        updated: [],
    };

    for (const linkDefinition of linkDefinitions) {
        const projectFilepath = path.join(rootDir, linkDefinition.projectPath);
        const projectParentDir = path.dirname(projectFilepath);
        const relativeProjectPath = path.relative(rootDir, projectFilepath) || '.';

        if (linkDefinition.ensureParentDir) fs.ensureDirSync(projectParentDir);
        else if (!fs.existsSync(projectParentDir)) {
            result.skipped.push(relativeProjectPath);
            continue;
        }

        const sourceFilepath = linkDefinition.sourcePath;
        if (!fs.existsSync(sourceFilepath)) throw new Error(`Missing project instruction asset: ${sourceFilepath}`);

        const existingState = inspectExistingPath({
            managedSourceRoot,
            projectFilepath,
            sourceFilepath,
        });

        if (existingState.kind === 'match') {
            result.skipped.push(relativeProjectPath);
            continue;
        }

        const normalizedProjectFilepath = normalizeAbsolutePath(projectFilepath);
        if (existingState.kind === 'blocked' && !overwriteBlockedPaths.has(normalizedProjectFilepath)) {
            result.blocked.push(relativeProjectPath);
            continue;
        }

        const symlinkTarget = path.relative(projectParentDir, sourceFilepath);

        if (existingState.kind === 'managed-different') {
            if (!dryRun) {
                fs.unlinkSync(projectFilepath);
                fs.symlinkSync(symlinkTarget, projectFilepath);
            }
            result.updated.push(relativeProjectPath);
            logVerbose(`${logPrefix} Updated ${relativeProjectPath} -> ${symlinkTarget}`);
            continue;
        }

        if (existingState.kind === 'blocked') {
            if (!dryRun) {
                fs.removeSync(projectFilepath);
                fs.symlinkSync(symlinkTarget, projectFilepath);
            }
            result.overwritten.push(relativeProjectPath);
            logVerbose(`${logPrefix} Replaced ${relativeProjectPath} -> ${symlinkTarget}`);
            continue;
        }

        if (!dryRun) fs.symlinkSync(symlinkTarget, projectFilepath);
        result.created.push(relativeProjectPath);
        logVerbose(`${logPrefix} Created ${relativeProjectPath} -> ${symlinkTarget}`);
    }

    return result;
}

function inspectExistingPath({
    managedSourceRoot,
    projectFilepath,
    sourceFilepath,
}: {
    managedSourceRoot: string;
    projectFilepath: string;
    sourceFilepath: string;
}) {
    if (!pathEntryExists(projectFilepath)) return { kind: 'missing' as const };

    const stats = fs.lstatSync(projectFilepath);
    if (!stats.isSymbolicLink()) return { kind: 'blocked' as const };

    const existingTarget = resolveSymlinkTarget(projectFilepath);
    const normalizedExistingTarget = normalizeAbsolutePath(existingTarget);
    const normalizedSourceFilepath = normalizeAbsolutePath(sourceFilepath);
    const normalizedManagedSourceRoot = normalizeAbsolutePath(managedSourceRoot);

    if (normalizedExistingTarget === normalizedSourceFilepath) return { kind: 'match' as const };
    if (
        normalizedExistingTarget === normalizedManagedSourceRoot ||
        normalizedExistingTarget.startsWith(`${normalizedManagedSourceRoot}/`)
    )
        return { kind: 'managed-different' as const };

    return { kind: 'blocked' as const };
}

function resolveSymlinkTarget(projectFilepath: string) {
    const projectParentDir = path.dirname(projectFilepath);
    const rawTarget = fs.readlinkSync(projectFilepath);
    return path.resolve(projectParentDir, rawTarget);
}

function mergeSymlinkResults(
    result: TConfigureProjectAgentSymlinksResult,
    next: TEnsureSymlinksResult,
    rootDir: string,
) {
    result.created.push(...next.created.map((entry) => formatResultPath(rootDir, entry)));
    result.overwritten.push(...next.overwritten.map((entry) => formatResultPath(rootDir, entry)));
    result.updated.push(...next.updated.map((entry) => formatResultPath(rootDir, entry)));
    result.skipped.push(...next.skipped.map((entry) => formatResultPath(rootDir, entry)));
    result.blocked.push(...next.blocked.map((entry) => formatResultPath(rootDir, entry)));
}

function formatResultPath(rootDir: string, relativePath: string) {
    return normalizeProjectPathForGitignore(path.join(rootDir, relativePath));
}

function normalizeAbsolutePath(filepath: string) {
    return filepath.replace(/\\/g, '/');
}

function normalizeProjectPathForGitignore(projectPath: string) {
    return projectPath.replace(/\\/g, '/');
}

function normalizeGitignoreEntry(value: string) {
    return value.trim().replace(/#.*/, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldSkipLegacyManagedGitignoreLine(line: string, managedNormalizedEntries: Set<string>) {
    const normalizedLine = normalizeGitignoreEntry(line);
    if (!normalizedLine) return false;
    if (line.trim().startsWith('#')) return false;

    return managedNormalizedEntries.has(normalizedLine);
}

function trimTrailingBlankLines(lines: string[]) {
    const trimmedLines = [...lines];

    while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].trim() === '') trimmedLines.pop();

    return trimmedLines;
}

function pathEntryExists(filepath: string) {
    try {
        fs.lstatSync(filepath);
        return true;
    } catch {
        return false;
    }
}
