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
type TConfigureProjectAgentInstructionsArgs = {
    appRoot: string;
    coreRoot: string;
    dryRun?: boolean;
    monorepoRoot?: string;
    overwriteBlockedPaths?: string[];
};

type TAgentInstructionDefinition = {
    includeWorktreeBootstrap?: boolean;
    projectPath: string;
    sourcePath: string;
    ensureParentDir?: boolean;
};

type TEnsureInstructionStubsResult = {
    blocked: string[];
    created: string[];
    overwritten: string[];
    skipped: string[];
    updated: string[];
};

export type TConfigureProjectAgentInstructionsResult = {
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

const managedInstructionStubHeader = '# Proteum Managed Instructions';
const managedInstructionStubIntro = 'This file is managed by `proteum configure agents`.';
const newProteumWorktreeBootstrapBlock = [
    '## New Proteum Worktree Bootstrap',
    '',
    'When starting work in a newly created Proteum worktree, immediately copy the `.env` file from the main worktree, change it to use a different free port by updating `PORT`, `URL`, and `URL_INTERNAL`, and run:',
    '',
    '```',
    'npx proteum configure agents',
    'npm i',
    'npx prisma generate',
    'npx proteum refresh',
    '```',
    '',
    'Run it before reading project-specific AGENTS files or making code changes. If the command is interactive, answer according to the current repository layout, then continue by reading the generated AGENTS.md files.',
];

const sharedAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
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

const standaloneAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: 'AGENTS.md', includeWorktreeBootstrap: true },
    ...sharedAppAgentInstructionDefinitions,
];

const monorepoAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: path.join('app-root', 'AGENTS.md') },
    ...sharedAppAgentInstructionDefinitions,
];

const monorepoRootAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: path.join('root', 'AGENTS.md'), includeWorktreeBootstrap: true },
];

const legacyProjectInstructionGitignoreBlockStart = '# Proteum-managed instruction symlinks';
const legacyProjectInstructionGitignoreBlockEnd = '# End Proteum-managed instruction symlinks';
const projectInstructionGitignoreBlockStart = '# Proteum-managed instruction files';
const projectInstructionGitignoreBlockEnd = '# End Proteum-managed instruction files';

/*----------------------------------
- PUBLIC API
----------------------------------*/

export function configureProjectAgentInstructions({
    appRoot,
    coreRoot,
    dryRun = false,
    monorepoRoot,
    overwriteBlockedPaths = [],
}: TConfigureProjectAgentInstructionsArgs): TConfigureProjectAgentInstructionsResult {
    const normalizedAppRoot = path.resolve(appRoot);
    const normalizedMonorepoRoot = monorepoRoot ? path.resolve(monorepoRoot) : undefined;
    const normalizedOverwriteBlockedPaths = new Set(
        overwriteBlockedPaths.map((blockedPath) => normalizeAbsolutePath(path.resolve(blockedPath))),
    );
    const mode =
        normalizedMonorepoRoot && normalizedMonorepoRoot !== normalizedAppRoot ? ('monorepo' as const) : ('standalone' as const);
    const result: TConfigureProjectAgentInstructionsResult = {
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

        const rootInstructions = getRootAgentInstructionDefinitions({ coreRoot });
        const rootStubs = ensureInstructionStubs(
            normalizedMonorepoRoot,
            rootInstructions,
            '[agents]',
            path.join(coreRoot, 'agents', 'project'),
            {
                dryRun,
                overwriteBlockedPaths: normalizedOverwriteBlockedPaths,
            },
        );
        mergeInstructionResults(result, rootStubs, normalizedMonorepoRoot);

        if (!dryRun && ensureInstructionGitignoreEntries({ rootDir: normalizedMonorepoRoot, instructionDefinitions: rootInstructions }))
            result.updatedGitignores.push(path.join(normalizedMonorepoRoot, '.gitignore'));
    }

    const appInstructions = getAppAgentInstructionDefinitions({ coreRoot, mode });
    const appStubs = ensureInstructionStubs(
        normalizedAppRoot,
        appInstructions,
        '[agents]',
        path.join(coreRoot, 'agents', 'project'),
        {
            dryRun,
            overwriteBlockedPaths: normalizedOverwriteBlockedPaths,
        },
    );
    mergeInstructionResults(result, appStubs, normalizedAppRoot);

    if (!dryRun && ensureInstructionGitignoreEntries({ rootDir: normalizedAppRoot, instructionDefinitions: appInstructions }))
        result.updatedGitignores.push(path.join(normalizedAppRoot, '.gitignore'));

    return result;
}

export const configureProjectAgentSymlinks = configureProjectAgentInstructions;

export function getProjectInstructionGitignoreEntries({ coreRoot }: TProjectInstructionArgs) {
    return Array.from(
        new Set(
            getAppAgentInstructionDefinitions({ coreRoot, mode: 'standalone' }).map((instructionDefinition) =>
                `/${normalizeProjectPathForGitignore(instructionDefinition.projectPath)}`,
            ),
        ),
    );
}

export function renderProjectInstructionGitignoreBlock({ coreRoot }: TProjectInstructionArgs) {
    return renderInstructionGitignoreBlock({
        instructionDefinitions: getAppAgentInstructionDefinitions({ coreRoot, mode: 'standalone' }),
    });
}

export function inspectProjectAgentFiles({ appRoot }: { appRoot: string }): TProjectAgentFileInspection {
    const normalizedAppRoot = path.resolve(appRoot);
    const expectedAgentPaths = Array.from(
        new Set(
            standaloneAppAgentInstructionDefinitions
                .map((instructionDefinition) => instructionDefinition.projectPath)
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

function getAppAgentInstructionDefinitions({
    coreRoot,
    mode,
}: TProjectInstructionArgs & { mode: 'monorepo' | 'standalone' }) {
    const agentSourceRoot = path.join(coreRoot, 'agents', 'project');
    const sourceDefinitions =
        mode === 'monorepo' ? monorepoAppAgentInstructionDefinitions : standaloneAppAgentInstructionDefinitions;

    return resolveAgentInstructionDefinitions({
        agentSourceRoot,
        instructionDefinitions: sourceDefinitions,
    });
}

function getRootAgentInstructionDefinitions({ coreRoot }: TProjectInstructionArgs) {
    return resolveAgentInstructionDefinitions({
        agentSourceRoot: path.join(coreRoot, 'agents', 'project'),
        instructionDefinitions: monorepoRootAgentInstructionDefinitions,
    });
}

function resolveAgentInstructionDefinitions({
    agentSourceRoot,
    instructionDefinitions,
}: {
    agentSourceRoot: string;
    instructionDefinitions: TAgentInstructionDefinition[];
}) {
    return instructionDefinitions.map((instructionDefinition) => ({
        ...instructionDefinition,
        sourcePath: path.join(agentSourceRoot, instructionDefinition.sourcePath),
    }));
}

function renderInstructionGitignoreBlock({ instructionDefinitions }: { instructionDefinitions: TAgentInstructionDefinition[] }) {
    const entries = Array.from(
        new Set(
            instructionDefinitions.map(
                (instructionDefinition) => `/${normalizeProjectPathForGitignore(instructionDefinition.projectPath)}`,
            ),
        ),
    );

    return [projectInstructionGitignoreBlockStart, ...entries, projectInstructionGitignoreBlockEnd].join('\n');
}

function ensureInstructionGitignoreEntries({
    rootDir,
    instructionDefinitions,
}: {
    rootDir: string;
    instructionDefinitions: TAgentInstructionDefinition[];
}) {
    const gitignoreFilepath = path.join(rootDir, '.gitignore');
    if (!pathEntryExists(gitignoreFilepath)) return false;

    const managedEntries = new Set(
        instructionDefinitions.map((instructionDefinition) => normalizeGitignoreEntry(instructionDefinition.projectPath)),
    );
    const lines = fs.readFileSync(gitignoreFilepath, 'utf8').split(/\r?\n/);
    const filteredLines: string[] = [];
    let insideManagedBlock = false;

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine === projectInstructionGitignoreBlockStart || trimmedLine === legacyProjectInstructionGitignoreBlockStart) {
            insideManagedBlock = true;
            continue;
        }

        if (trimmedLine === projectInstructionGitignoreBlockEnd || trimmedLine === legacyProjectInstructionGitignoreBlockEnd) {
            insideManagedBlock = false;
            continue;
        }

        if (insideManagedBlock) continue;
        if (shouldSkipLegacyManagedGitignoreLine(line, managedEntries)) continue;

        filteredLines.push(line);
    }

    const baseContent = trimTrailingBlankLines(filteredLines).join('\n');
    const managedBlock = renderInstructionGitignoreBlock({ instructionDefinitions });
    const nextContent = baseContent ? `${baseContent}\n\n${managedBlock}\n` : `${managedBlock}\n`;

    if (nextContent === fs.readFileSync(gitignoreFilepath, 'utf8')) return false;

    fs.writeFileSync(gitignoreFilepath, nextContent);
    logVerbose(`[agents] Updated ${path.relative(rootDir, gitignoreFilepath) || '.gitignore'} with Proteum-managed instruction ignore entries.`);

    return true;
}

function ensureInstructionStubs(
    rootDir: string,
    instructionDefinitions: TAgentInstructionDefinition[],
    logPrefix: string,
    managedSourceRoot: string,
    {
        dryRun,
        overwriteBlockedPaths,
    }: {
        dryRun: boolean;
        overwriteBlockedPaths: Set<string>;
    },
): TEnsureInstructionStubsResult {
    const result: TEnsureInstructionStubsResult = {
        blocked: [],
        created: [],
        overwritten: [],
        skipped: [],
        updated: [],
    };

    for (const instructionDefinition of instructionDefinitions) {
        const projectFilepath = path.join(rootDir, instructionDefinition.projectPath);
        const projectParentDir = path.dirname(projectFilepath);
        const relativeProjectPath = path.relative(rootDir, projectFilepath) || '.';

        if (instructionDefinition.ensureParentDir) fs.ensureDirSync(projectParentDir);
        else if (!fs.existsSync(projectParentDir)) {
            result.skipped.push(relativeProjectPath);
            continue;
        }

        const sourceFilepath = instructionDefinition.sourcePath;
        if (!fs.existsSync(sourceFilepath)) throw new Error(`Missing project instruction asset: ${sourceFilepath}`);

        const stubContent = renderInstructionStub({
            includeWorktreeBootstrap: instructionDefinition.includeWorktreeBootstrap === true,
            projectFilepath,
            sourceFilepath,
        });

        const existingState = inspectExistingPath({
            managedSourceRoot,
            projectFilepath,
            sourceFilepath,
            stubContent,
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

        if (existingState.kind === 'managed-different') {
            if (!dryRun) {
                fs.removeSync(projectFilepath);
                fs.writeFileSync(projectFilepath, stubContent);
            }
            result.updated.push(relativeProjectPath);
            logVerbose(`${logPrefix} Updated ${relativeProjectPath}`);
            continue;
        }

        if (existingState.kind === 'blocked') {
            if (!dryRun) {
                fs.removeSync(projectFilepath);
                fs.writeFileSync(projectFilepath, stubContent);
            }
            result.overwritten.push(relativeProjectPath);
            logVerbose(`${logPrefix} Replaced ${relativeProjectPath}`);
            continue;
        }

        if (!dryRun) fs.writeFileSync(projectFilepath, stubContent);
        result.created.push(relativeProjectPath);
        logVerbose(`${logPrefix} Created ${relativeProjectPath}`);
    }

    return result;
}

function renderInstructionStub({
    includeWorktreeBootstrap,
    projectFilepath,
    sourceFilepath,
}: {
    includeWorktreeBootstrap: boolean;
    projectFilepath: string;
    sourceFilepath: string;
}) {
    const sourcePath = normalizeProjectPathForGitignore(path.relative(path.dirname(projectFilepath), sourceFilepath));
    const lines = [
        ...(includeWorktreeBootstrap ? [...newProteumWorktreeBootstrapBlock, ''] : []),
        managedInstructionStubHeader,
        '',
        managedInstructionStubIntro,
        '',
        'Before reading or applying instructions from this file, read and follow the canonical Proteum instruction file at:',
        '',
        `\`${sourcePath}\``,
        '',
        'Resolve that path relative to this file. Treat the canonical file as if its full contents were written here.',
        '',
        'If the canonical file cannot be read, stop and run `npx proteum configure agents` before continuing.',
        '',
    ];

    return lines.join('\n');
}

function inspectExistingPath({
    managedSourceRoot,
    projectFilepath,
    sourceFilepath,
    stubContent,
}: {
    managedSourceRoot: string;
    projectFilepath: string;
    sourceFilepath: string;
    stubContent: string;
}) {
    if (!pathEntryExists(projectFilepath)) return { kind: 'missing' as const };

    const stats = fs.lstatSync(projectFilepath);
    if (!stats.isSymbolicLink()) {
        if (!stats.isFile()) return { kind: 'blocked' as const };

        const existingContent = fs.readFileSync(projectFilepath, 'utf8');
        if (existingContent === stubContent) return { kind: 'match' as const };
        if (isManagedInstructionStub(existingContent)) return { kind: 'managed-different' as const };

        return { kind: 'blocked' as const };
    }

    const existingTarget = resolveSymlinkTarget(projectFilepath);
    const normalizedExistingTarget = normalizeAbsolutePath(existingTarget);
    const normalizedSourceFilepath = normalizeAbsolutePath(sourceFilepath);
    const normalizedManagedSourceRoot = normalizeAbsolutePath(managedSourceRoot);

    if (
        normalizedExistingTarget === normalizedSourceFilepath ||
        normalizedExistingTarget === normalizedManagedSourceRoot ||
        normalizedExistingTarget.startsWith(`${normalizedManagedSourceRoot}/`)
    )
        return { kind: 'managed-different' as const };

    return { kind: 'blocked' as const };
}

function isManagedInstructionStub(content: string) {
    return content.includes(`${managedInstructionStubHeader}\n\n${managedInstructionStubIntro}\n`);
}

function resolveSymlinkTarget(projectFilepath: string) {
    const projectParentDir = path.dirname(projectFilepath);
    const rawTarget = fs.readlinkSync(projectFilepath);
    return path.resolve(projectParentDir, rawTarget);
}

function mergeInstructionResults(
    result: TConfigureProjectAgentInstructionsResult,
    next: TEnsureInstructionStubsResult,
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
