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
    projectPath: string;
    ensureParentDir?: boolean;
};

type TEnsureInstructionFilesResult = {
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

/*----------------------------------
- CONSTANTS
----------------------------------*/

const managedInstructionStubHeader = '# Proteum Managed Instructions';
const managedInstructionStubFinalLine =
    'If the canonical file cannot be read, stop and run `npx proteum configure agents` before continuing.';
const managedInstructionSectionHeader = '# Proteum Instructions';
const managedInstructionSectionStart = '<!-- proteum-instructions:start -->';
const managedInstructionSectionEnd = '<!-- proteum-instructions:end -->';
const managedInstructionSectionIntro = 'This section is managed by `proteum configure agents`.';

const sharedAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'CODING_STYLE.md' },
    { projectPath: 'diagnostics.md' },
    { projectPath: 'optimizations.md' },
    { projectPath: path.join('client', 'AGENTS.md') },
    { projectPath: path.join('client', 'pages', 'AGENTS.md') },
    { projectPath: path.join('server', 'services', 'AGENTS.md') },
    { projectPath: path.join('server', 'routes', 'AGENTS.md') },
    { projectPath: path.join('tests', 'e2e', 'AGENTS.md') },
];

const standaloneAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md' },
    ...sharedAppAgentInstructionDefinitions,
];

const monorepoAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md' },
    ...sharedAppAgentInstructionDefinitions,
];

const monorepoRootAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md' },
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
    const embeddedInstructions = renderEmbeddedProjectInstructions({ coreRoot });

    if (mode === 'monorepo' && normalizedMonorepoRoot) {
        result.monorepoRoot = normalizedMonorepoRoot;

        const rootInstructions = getRootAgentInstructionDefinitions();
        const rootFiles = ensureInstructionFiles(
            normalizedMonorepoRoot,
            rootInstructions,
            '[agents]',
            path.join(coreRoot, 'agents', 'project'),
            embeddedInstructions,
            {
                dryRun,
                overwriteBlockedPaths: normalizedOverwriteBlockedPaths,
            },
        );
        mergeInstructionResults(result, rootFiles, normalizedMonorepoRoot);

        if (!dryRun && removeInstructionGitignoreEntries({ rootDir: normalizedMonorepoRoot, instructionDefinitions: rootInstructions }))
            result.updatedGitignores.push(path.join(normalizedMonorepoRoot, '.gitignore'));
    }

    const appInstructions = getAppAgentInstructionDefinitions({ mode });
    const appFiles = ensureInstructionFiles(
        normalizedAppRoot,
        appInstructions,
        '[agents]',
        path.join(coreRoot, 'agents', 'project'),
        embeddedInstructions,
        {
            dryRun,
            overwriteBlockedPaths: normalizedOverwriteBlockedPaths,
        },
    );
    mergeInstructionResults(result, appFiles, normalizedAppRoot);

    if (!dryRun && removeInstructionGitignoreEntries({ rootDir: normalizedAppRoot, instructionDefinitions: appInstructions }))
        result.updatedGitignores.push(path.join(normalizedAppRoot, '.gitignore'));

    return result;
}

export const configureProjectAgentSymlinks = configureProjectAgentInstructions;

export function resolveProjectAgentMonorepoRoot(appRoot: string) {
    const normalizedAppRoot = resolveCanonicalPath(appRoot);
    const likelyRepoRoot = findLikelyRepoRoot(normalizedAppRoot);

    if (!likelyRepoRoot) return undefined;
    if (likelyRepoRoot === normalizedAppRoot) return undefined;
    if (!isInsideDirectory({ child: normalizedAppRoot, parent: likelyRepoRoot })) return undefined;

    return likelyRepoRoot;
}

/*----------------------------------
- HELPERS
----------------------------------*/

function getAppAgentInstructionDefinitions({
    mode,
}: { mode: 'monorepo' | 'standalone' }) {
    const sourceDefinitions =
        mode === 'monorepo' ? monorepoAppAgentInstructionDefinitions : standaloneAppAgentInstructionDefinitions;

    return sourceDefinitions.map((instructionDefinition) => ({ ...instructionDefinition }));
}

function getRootAgentInstructionDefinitions() {
    return monorepoRootAgentInstructionDefinitions.map((instructionDefinition) => ({ ...instructionDefinition }));
}

function removeInstructionGitignoreEntries({
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
    const nextContent = baseContent ? `${baseContent}\n` : '';

    if (nextContent === fs.readFileSync(gitignoreFilepath, 'utf8')) return false;

    fs.writeFileSync(gitignoreFilepath, nextContent);
    logVerbose(`[agents] Removed Proteum-managed instruction ignore entries from ${path.relative(rootDir, gitignoreFilepath) || '.gitignore'}.`);

    return true;
}

function ensureInstructionFiles(
    rootDir: string,
    instructionDefinitions: TAgentInstructionDefinition[],
    logPrefix: string,
    managedSourceRoot: string,
    managedSectionContent: string,
    {
        dryRun,
        overwriteBlockedPaths,
    }: {
        dryRun: boolean;
        overwriteBlockedPaths: Set<string>;
    },
): TEnsureInstructionFilesResult {
    const result: TEnsureInstructionFilesResult = {
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

        const existingState = inspectExistingPath({
            managedSourceRoot,
            projectFilepath,
        });

        if (existingState.kind === 'file') {
            const nextContent = upsertManagedInstructionSection(existingState.content, managedSectionContent);
            if (nextContent === existingState.content) {
                result.skipped.push(relativeProjectPath);
                continue;
            }

            if (!dryRun) fs.writeFileSync(projectFilepath, nextContent);
            result.updated.push(relativeProjectPath);
            logVerbose(`${logPrefix} Updated ${relativeProjectPath}`);
            continue;
        }

        if (existingState.kind === 'managed-different') {
            if (!dryRun) {
                fs.removeSync(projectFilepath);
                fs.writeFileSync(projectFilepath, managedSectionContent);
            }
            result.updated.push(relativeProjectPath);
            logVerbose(`${logPrefix} Updated ${relativeProjectPath}`);
            continue;
        }

        const normalizedProjectFilepath = normalizeAbsolutePath(projectFilepath);
        if (existingState.kind === 'blocked' && !overwriteBlockedPaths.has(normalizedProjectFilepath)) {
            result.blocked.push(relativeProjectPath);
            continue;
        }

        if (existingState.kind === 'blocked') {
            if (!dryRun) {
                fs.removeSync(projectFilepath);
                fs.writeFileSync(projectFilepath, managedSectionContent);
            }
            result.overwritten.push(relativeProjectPath);
            logVerbose(`${logPrefix} Replaced ${relativeProjectPath}`);
            continue;
        }

        if (!dryRun) fs.writeFileSync(projectFilepath, managedSectionContent);
        result.created.push(relativeProjectPath);
        logVerbose(`${logPrefix} Created ${relativeProjectPath}`);
    }

    return result;
}

function inspectExistingPath({
    managedSourceRoot,
    projectFilepath,
}: {
    managedSourceRoot: string;
    projectFilepath: string;
}) {
    if (!pathEntryExists(projectFilepath)) return { kind: 'missing' as const };

    const stats = fs.lstatSync(projectFilepath);
    if (!stats.isSymbolicLink()) {
        if (!stats.isFile()) return { kind: 'blocked' as const };

        const content = fs.readFileSync(projectFilepath, 'utf8');

        return { kind: 'file' as const, content };
    }

    const existingTarget = resolveSymlinkTarget(projectFilepath);
    const normalizedExistingTarget = normalizeAbsolutePath(existingTarget);
    const normalizedManagedSourceRoot = normalizeAbsolutePath(managedSourceRoot);

    if (isManagedInstructionSymlinkTarget({ normalizedExistingTarget, normalizedManagedSourceRoot }))
        return { kind: 'managed-different' as const };

    return { kind: 'blocked' as const };
}

function isManagedInstructionSymlinkTarget({
    normalizedExistingTarget,
    normalizedManagedSourceRoot,
}: {
    normalizedExistingTarget: string;
    normalizedManagedSourceRoot: string;
}) {
    if (normalizedExistingTarget === normalizedManagedSourceRoot) return true;
    if (normalizedExistingTarget.startsWith(`${normalizedManagedSourceRoot}/`)) return true;

    const targetSegments = normalizedExistingTarget.split('/');
    return targetSegments.some(
        (segment, index) => segment === 'agents' && targetSegments[index + 1] === 'project',
    );
}

function resolveSymlinkTarget(projectFilepath: string) {
    const projectParentDir = path.dirname(projectFilepath);
    const rawTarget = fs.readlinkSync(projectFilepath);
    return path.resolve(projectParentDir, rawTarget);
}

function mergeInstructionResults(
    result: TConfigureProjectAgentInstructionsResult,
    next: TEnsureInstructionFilesResult,
    rootDir: string,
) {
    result.created.push(...next.created.map((entry) => formatResultPath(rootDir, entry)));
    result.overwritten.push(...next.overwritten.map((entry) => formatResultPath(rootDir, entry)));
    result.updated.push(...next.updated.map((entry) => formatResultPath(rootDir, entry)));
    result.skipped.push(...next.skipped.map((entry) => formatResultPath(rootDir, entry)));
    result.blocked.push(...next.blocked.map((entry) => formatResultPath(rootDir, entry)));
}

function renderEmbeddedProjectInstructions({ coreRoot }: TProjectInstructionArgs) {
    const agentSourceRoot = path.join(coreRoot, 'agents', 'project');
    if (!fs.existsSync(agentSourceRoot)) throw new Error(`Missing project instruction source root: ${agentSourceRoot}`);

    const sourceFiles = collectMarkdownFiles(agentSourceRoot).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const lines = [
        managedInstructionSectionHeader,
        managedInstructionSectionStart,
        '',
        managedInstructionSectionIntro,
        '',
    ];

    for (const sourceFile of sourceFiles) {
        const content = fs.readFileSync(sourceFile.filepath, 'utf8');
        const demotedContent = demoteMarkdownHeadings(content).trim();

        lines.push(`## Source: ${sourceFile.relativePath}`, '');
        if (demotedContent) lines.push(demotedContent, '');
    }

    lines.push(managedInstructionSectionEnd, '');

    return lines.join('\n');
}

function collectMarkdownFiles(rootDir: string, currentDir = rootDir): { filepath: string; relativePath: string }[] {
    const files: { filepath: string; relativePath: string }[] = [];

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const filepath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectMarkdownFiles(rootDir, filepath));
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

        files.push({
            filepath,
            relativePath: normalizeProjectPathForGitignore(path.relative(rootDir, filepath)),
        });
    }

    return files;
}

function demoteMarkdownHeadings(content: string) {
    const lines = content.split(/\r?\n/);
    let activeFence: string | undefined;

    return lines
        .map((line) => {
            const fenceMatch = line.match(/^\s*(```+|~~~+)/);
            if (fenceMatch) {
                const marker = fenceMatch[1].startsWith('`') ? '`' : '~';
                activeFence = activeFence === marker ? undefined : marker;
                return line;
            }

            if (activeFence) return line;

            return line.replace(/^(#{1,5})(\s+)/, '#$1$2');
        })
        .join('\n');
}

function upsertManagedInstructionSection(content: string, managedSectionContent: string) {
    const existingRange = findManagedInstructionSectionRange(content);

    if (!existingRange) {
        const legacyStubRange = findLegacyManagedInstructionStubRange(content);

        if (legacyStubRange) {
            const before = content.slice(0, legacyStubRange.start);
            const after = content.slice(legacyStubRange.end);

            return joinMarkdownSections([before, managedSectionContent, after]);
        }

        return joinMarkdownSections([content, managedSectionContent]);
    }

    const before = content.slice(0, existingRange.start);
    const after = content.slice(existingRange.end);

    return joinMarkdownSections([before, managedSectionContent, after]);
}

function findManagedInstructionSectionRange(content: string) {
    const markerStartIndex = content.indexOf(managedInstructionSectionStart);
    if (markerStartIndex === -1) return undefined;

    const markerEndIndex = content.indexOf(managedInstructionSectionEnd, markerStartIndex);
    if (markerEndIndex === -1) return undefined;

    const rangeEnd = markerEndIndex + managedInstructionSectionEnd.length;
    const contentThroughStartMarker = content.slice(0, markerStartIndex + managedInstructionSectionStart.length);
    const headerPattern = new RegExp(
        `(^|\\n)${escapeRegExp(managedInstructionSectionHeader)}\\s*\\n(?:[ \\t]*\\n)*${escapeRegExp(managedInstructionSectionStart)}$`,
    );
    const headerMatch = contentThroughStartMarker.match(headerPattern);

    if (!headerMatch) return { start: markerStartIndex, end: rangeEnd };

    const matchedContent = headerMatch[0];
    const leadingNewlineOffset = matchedContent.startsWith('\n') ? 1 : 0;
    const rangeStart = markerStartIndex + managedInstructionSectionStart.length - matchedContent.length + leadingNewlineOffset;

    return { start: rangeStart, end: rangeEnd };
}

function findLegacyManagedInstructionStubRange(content: string) {
    const lines = content.split(/(?<=\n)/);
    let offset = 0;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        if (line.trim() !== managedInstructionStubHeader) {
            offset += line.length;
            continue;
        }

        let endOffset = content.length;
        let scanOffset = offset + line.length;

        for (let scanIndex = index + 1; scanIndex < lines.length; scanIndex++) {
            const currentLine = lines[scanIndex];

            scanOffset += currentLine.length;
            if (currentLine.trim() !== managedInstructionStubFinalLine) continue;

            let blankIndex = scanIndex + 1;
            let blankOffset = scanOffset;

            while (blankIndex < lines.length && lines[blankIndex].trim() === '') {
                blankOffset += lines[blankIndex].length;
                blankIndex += 1;
            }

            endOffset = blankOffset;
            break;
        }

        return { start: offset, end: endOffset };
    }

    return undefined;
}

function joinMarkdownSections(sections: string[]) {
    return `${sections
        .map((section) => trimBlankLines(section.split(/\r?\n/)).join('\n'))
        .filter(Boolean)
        .join('\n\n')}\n`;
}

function trimBlankLines(lines: string[]) {
    const trimmedLines = trimTrailingBlankLines(lines);

    while (trimmedLines.length > 0 && trimmedLines[0].trim() === '') trimmedLines.shift();

    return trimmedLines;
}

function formatResultPath(rootDir: string, relativePath: string) {
    return normalizeProjectPathForGitignore(path.join(rootDir, relativePath));
}

export function resolveCanonicalPath(inputPath: string) {
    const resolvedPath = path.resolve(inputPath);

    try {
        return fs.realpathSync(resolvedPath);
    } catch {
        return resolvedPath;
    }
}

export function isInsideDirectory({ child, parent }: { child: string; parent: string }) {
    const relativePath = path.relative(parent, child);
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

export function findLikelyRepoRoot(startPath: string) {
    let currentPath = path.resolve(startPath);

    while (true) {
        if (pathEntryExists(path.join(currentPath, '.git'))) return resolveCanonicalPath(currentPath);

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
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

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathEntryExists(filepath: string) {
    try {
        fs.lstatSync(filepath);
        return true;
    } catch {
        return false;
    }
}
