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
    content?: 'router' | 'source';
};

type TEnsureInstructionFilesResult = {
    blocked: string[];
    created: string[];
    overwritten: string[];
    removed: string[];
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
    removed: string[];
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

const sharedRootDocumentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'DOCUMENTATION.md', content: 'source' },
    { projectPath: 'CODING_STYLE.md', content: 'source' },
    { projectPath: 'diagnostics.md', content: 'source' },
    { projectPath: 'optimizations.md', content: 'source' },
];

const sharedAppAreaAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: path.join('client', 'AGENTS.md'), content: 'source' },
    { projectPath: path.join('client', 'pages', 'AGENTS.md'), content: 'source' },
    { projectPath: path.join('server', 'services', 'AGENTS.md'), content: 'source' },
    { projectPath: path.join('server', 'routes', 'AGENTS.md'), content: 'source' },
];

const sharedE2eAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: path.join('tests', 'e2e', 'AGENTS.md'), ensureParentDir: true, content: 'source' },
    { projectPath: path.join('tests', 'e2e', 'REAL_WORLD_JOURNEY_TESTS.md'), ensureParentDir: true, content: 'source' },
];

const standaloneAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md', content: 'router' },
    ...sharedRootDocumentInstructionDefinitions,
    ...sharedAppAreaAgentInstructionDefinitions,
    ...sharedE2eAgentInstructionDefinitions,
];

const monorepoAppAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md', content: 'router' },
    ...sharedAppAreaAgentInstructionDefinitions,
];

const monorepoRootAgentInstructionDefinitions: TAgentInstructionDefinition[] = [
    { projectPath: 'AGENTS.md', content: 'router' },
    ...sharedRootDocumentInstructionDefinitions,
    ...sharedE2eAgentInstructionDefinitions,
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
        removed: [],
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

    if (mode === 'monorepo') {
        const retiredAppRootFiles = removeManagedInstructionFiles(
            normalizedAppRoot,
            [...sharedRootDocumentInstructionDefinitions, ...sharedE2eAgentInstructionDefinitions],
            '[agents]',
            path.join(coreRoot, 'agents', 'project'),
            {
                dryRun,
            },
        );
        mergeInstructionResults(result, retiredAppRootFiles, normalizedAppRoot);
    }

    const appGitignoreCleanupInstructions =
        mode === 'monorepo'
            ? [...appInstructions, ...sharedRootDocumentInstructionDefinitions, ...sharedE2eAgentInstructionDefinitions]
            : appInstructions;

    if (
        !dryRun &&
        removeInstructionGitignoreEntries({
            rootDir: normalizedAppRoot,
            instructionDefinitions: appGitignoreCleanupInstructions,
        })
    )
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
        removed: [],
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

        const instructionContent = renderProjectInstructionContent({
            instructionDefinition,
            managedSourceRoot,
            managedSectionContent,
        });
        const existingState = inspectExistingPath({
            managedSourceRoot,
            projectFilepath,
        });

        if (existingState.kind === 'file') {
            const nextContent =
                instructionDefinition.content === 'source'
                    ? instructionContent
                    : upsertManagedInstructionSection(existingState.content, instructionContent);
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
                fs.writeFileSync(projectFilepath, instructionContent);
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
                fs.writeFileSync(projectFilepath, instructionContent);
            }
            result.overwritten.push(relativeProjectPath);
            logVerbose(`${logPrefix} Replaced ${relativeProjectPath}`);
            continue;
        }

        if (!dryRun) fs.writeFileSync(projectFilepath, instructionContent);
        result.created.push(relativeProjectPath);
        logVerbose(`${logPrefix} Created ${relativeProjectPath}`);
    }

    return result;
}

function removeManagedInstructionFiles(
    rootDir: string,
    instructionDefinitions: TAgentInstructionDefinition[],
    logPrefix: string,
    managedSourceRoot: string,
    {
        dryRun,
    }: {
        dryRun: boolean;
    },
): TEnsureInstructionFilesResult {
    const result: TEnsureInstructionFilesResult = {
        blocked: [],
        created: [],
        overwritten: [],
        removed: [],
        skipped: [],
        updated: [],
    };

    for (const instructionDefinition of instructionDefinitions) {
        const projectFilepath = path.join(rootDir, instructionDefinition.projectPath);
        const projectParentDir = path.dirname(projectFilepath);
        const relativeProjectPath = path.relative(rootDir, projectFilepath) || '.';

        if (!fs.existsSync(projectParentDir)) continue;

        const existingState = inspectExistingPath({
            managedSourceRoot,
            projectFilepath,
        });

        if (existingState.kind === 'missing') continue;

        if (existingState.kind === 'managed-different') {
            if (!dryRun) fs.removeSync(projectFilepath);
            result.removed.push(relativeProjectPath);
            logVerbose(`${logPrefix} Removed retired app-root ${relativeProjectPath}`);
            continue;
        }

        if (existingState.kind === 'file') {
            const retainedContent = removeManagedInstructionContent(existingState.content);

            if (retainedContent === undefined) {
                result.skipped.push(relativeProjectPath);
                continue;
            }

            if (retainedContent.trim() === '') {
                if (!dryRun) fs.removeSync(projectFilepath);
                result.removed.push(relativeProjectPath);
                logVerbose(`${logPrefix} Removed retired app-root ${relativeProjectPath}`);
                continue;
            }

            if (!dryRun) fs.writeFileSync(projectFilepath, retainedContent);
            result.updated.push(relativeProjectPath);
            logVerbose(`${logPrefix} Removed retired managed section from ${relativeProjectPath}`);
            continue;
        }

        result.skipped.push(relativeProjectPath);
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
    result.removed.push(...next.removed.map((entry) => formatResultPath(rootDir, entry)));
    result.updated.push(...next.updated.map((entry) => formatResultPath(rootDir, entry)));
    result.skipped.push(...next.skipped.map((entry) => formatResultPath(rootDir, entry)));
    result.blocked.push(...next.blocked.map((entry) => formatResultPath(rootDir, entry)));
}

function renderProjectInstructionContent({
    instructionDefinition,
    managedSourceRoot,
    managedSectionContent,
}: {
    instructionDefinition: TAgentInstructionDefinition;
    managedSourceRoot: string;
    managedSectionContent: string;
}) {
    if (instructionDefinition.content !== 'source') return managedSectionContent;

    return renderSingleProjectInstruction({
        managedSourceRoot,
        projectPath: instructionDefinition.projectPath,
    });
}

function renderSingleProjectInstruction({
    managedSourceRoot,
    projectPath,
}: {
    managedSourceRoot: string;
    projectPath: string;
}) {
    const sourceFilepath = path.join(managedSourceRoot, projectPath);
    if (!fs.existsSync(sourceFilepath)) throw new Error(`Missing project instruction source file: ${sourceFilepath}`);

    const content = fs.readFileSync(sourceFilepath, 'utf8');
    const demotedContent = demoteMarkdownHeadings(content).trim();
    const lines = [
        managedInstructionSectionHeader,
        managedInstructionSectionStart,
        '',
        managedInstructionSectionIntro,
        '',
        `## Source: ${normalizeProjectPathForGitignore(projectPath)}`,
        '',
    ];

    if (demotedContent) lines.push(demotedContent, '');
    lines.push(managedInstructionSectionEnd, '');

    return lines.join('\n');
}

function renderEmbeddedProjectInstructions({ coreRoot }: TProjectInstructionArgs) {
    const agentSourceRoot = path.join(coreRoot, 'agents', 'project');
    if (!fs.existsSync(agentSourceRoot)) throw new Error(`Missing project instruction source root: ${agentSourceRoot}`);

    const lines = [
        managedInstructionSectionHeader,
        managedInstructionSectionStart,
        '',
        managedInstructionSectionIntro,
        '',
        '## Agent Routing Contract',
        '',
        'Proteum CLI and MCP outputs are optimized for agents. Do not load the whole instruction corpus up front.',
        '',
        'Detailed Proteum contracts are intentionally split into the files listed in the routing table below. They are not deleted; load only the file that matches the current task, or use MCP `instructions_resolve { projectId }` to get the routed set.',
        '',
        '1. Start ambiguous, generated, connected, route, controller, file, or error work with `npx proteum orient <query>`.',
        '2. When a Proteum MCP client is available, call MCP `projects_list`, select the stable `projectId` for this app, and pass that `projectId` to every app-bound MCP tool.',
        '3. Read only the files returned in `mustRead` or MCP `instructions_resolve { projectId }`, plus the conditional docs that match the current task.',
        '4. Use `npx proteum runtime status` before starting a dev server, so an existing tracked session can be reused.',
        '5. During `npx proteum dev`, Proteum ensures one managed machine MCP daemon is running and routes app-bound reads to the read-only runtime endpoint at `/__proteum/mcp` instead of spawning equivalent CLI diagnostics.',
        '6. If machine MCP routing fails, run `npx proteum mcp status` and `npx proteum runtime status`; if no live session exists, start `npx proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>`.',
        '7. If a live session exists but runtime/MCP is unreachable, stop the listed session file first, then start dev again. Do not start a second dev server in the same worktree or a second managed MCP daemon. Then retry MCP `projects_list`.',
        '8. Use `npx proteum diagnose <target>` for request-time issues before raw trace, perf, browser, or broad source search.',
        '9. Use `--full`, `--manifest`, `--events`, or MCP `detail: "full"` only when compact output says the omitted detail is needed.',
        '',
        'CLI remains the reproducible surface for `dev`, `build`, `check`, `verify`, migrations, and final command evidence. MCP remains read-only and returns compact `proteum-mcp-v1` JSON.',
        '',
        '## Always-On Safety',
        '',
        '- Never edit generated files under `.proteum`.',
        '- Never create or edit Prisma migration files manually.',
        '- Never run schema-mutating SQL such as `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, or `CREATE INDEX`.',
        '- If `schema.prisma` changes, ask the user to run `npx prisma migrate dev --config ./prisma.config.ts --name <migration name>` and wait for `continue` before validation.',
        '- Do not run `git restore` or `git reset`.',
        '- Keep `proteum dev` sessions tracked with explicit session files and do not replace another live session.',
        '',
        '## Always-On Git Workflow',
        '',
        '- Treat `commit`, `and commit`, `stage`, `push`, `PR`, and pull-request requests as git lifecycle work in addition to the feature task.',
        '- Before any requested commit, use Conventional Commits: `<type>[optional scope]: <description>`.',
        '- Stage only conversation-related files and keep unrelated pre-existing user changes or incidental untracked files unstaged.',
        '- If the commit scope or type is unclear, inspect recent `git log` before choosing the message.',
        '',
        '## Routing Table',
        '',
        '- Non-trivial coding tasks, feature docs, product intent, acceptance criteria, or docs updates: read `DOCUMENTATION.md`.',
        '- Raw errors, failing requests, traces, perf, or reproduction: read `diagnostics.md`.',
        '- Implementation edits: read `CODING_STYLE.md` before editing.',
        '- Client files or pages: read `client/AGENTS.md`; for page route/data/render work also read `client/pages/AGENTS.md`.',
        '- Server services: read `server/services/AGENTS.md`.',
        '- Manual server routes: read `server/routes/AGENTS.md`.',
        '- E2E work: read `tests/e2e/AGENTS.md` and `tests/e2e/REAL_WORLD_JOURNEY_TESTS.md`.',
        '- Package, runtime, build, or client-performance decisions: read `optimizations.md` after implementation or when explicitly optimizing.',
        '',
        '## Canonical Source Map',
        '',
        `- Root contract fallback: ${normalizeProjectPathForGitignore(path.join(coreRoot, 'agents', 'project', 'AGENTS.md'))}`,
        `- Documentation fallback: ${normalizeProjectPathForGitignore(path.join(coreRoot, 'agents', 'project', 'DOCUMENTATION.md'))}`,
        `- Diagnostics fallback: ${normalizeProjectPathForGitignore(path.join(coreRoot, 'agents', 'project', 'diagnostics.md'))}`,
        `- Optimization fallback: ${normalizeProjectPathForGitignore(path.join(coreRoot, 'agents', 'project', 'optimizations.md'))}`,
        `- Coding style fallback: ${normalizeProjectPathForGitignore(path.join(coreRoot, 'agents', 'project', 'CODING_STYLE.md'))}`,
        '',
    ];

    lines.push(managedInstructionSectionEnd, '');

    return lines.join('\n');
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

function removeManagedInstructionContent(content: string) {
    const managedRange = findManagedInstructionSectionRange(content) || findLegacyManagedInstructionStubRange(content);
    if (!managedRange) return undefined;

    const before = content.slice(0, managedRange.start);
    const after = content.slice(managedRange.end);

    return joinMarkdownSections([before, after]);
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
