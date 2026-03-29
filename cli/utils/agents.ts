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
type TEnsureProjectAgentSymlinksArgs = { appRoot: string; coreRoot: string };

type TAgentLinkDefinition = { projectPath: string; sourcePath: string; ensureParentDir?: boolean };

/*----------------------------------
- CONSTANTS
----------------------------------*/

// Project-local instruction entrypoints mapped to their canonical shipped source files.
const projectAgentLinkDefinitions: TAgentLinkDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: 'AGENTS.md' },
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
const projectInstructionGitignoreBlockStart = '# Proteum-managed instruction symlinks';
const projectInstructionGitignoreBlockEnd = '# End Proteum-managed instruction symlinks';

/*----------------------------------
- PUBLIC API
----------------------------------*/

export function ensureProjectAgentSymlinks({ appRoot, coreRoot }: TEnsureProjectAgentSymlinksArgs) {
    ensureSymlinks(appRoot, getProjectAgentLinkDefinitions({ coreRoot }), '[agents]');
    ensureSymlinks(appRoot, getProjectSkillLinkDefinitions({ coreRoot }), '[skills]');
    ensureProjectInstructionGitignoreEntries({ appRoot, coreRoot });
}

export function getProjectInstructionGitignoreEntries({ coreRoot }: TProjectInstructionArgs) {
    const entries = new Set<string>();

    for (const linkDefinition of [
        ...getProjectAgentLinkDefinitions({ coreRoot }),
        ...getProjectSkillLinkDefinitions({ coreRoot }),
    ]) {
        entries.add(`/${normalizeProjectPathForGitignore(linkDefinition.projectPath)}`);
    }

    return Array.from(entries);
}

export function renderProjectInstructionGitignoreBlock({ coreRoot }: TProjectInstructionArgs) {
    return [
        projectInstructionGitignoreBlockStart,
        ...getProjectInstructionGitignoreEntries({ coreRoot }),
        projectInstructionGitignoreBlockEnd,
    ].join('\n');
}

/*----------------------------------
- HELPERS
----------------------------------*/

function getProjectAgentLinkDefinitions({ coreRoot }: TProjectInstructionArgs) {
    const agentSourceRoot = path.join(coreRoot, 'agents', 'project');

    return projectAgentLinkDefinitions.map((linkDefinition) => ({
        ...linkDefinition,
        sourcePath: path.join(agentSourceRoot, linkDefinition.sourcePath),
    }));
}

function getProjectSkillLinkDefinitions({ coreRoot }: TProjectInstructionArgs) {
    const frameworkSkillsRoot = path.join(coreRoot, 'skills');
    if (!fs.existsSync(frameworkSkillsRoot)) return [];

    return fs
        .readdirSync(frameworkSkillsRoot, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((dirent) => ({
            projectPath: path.join('skills', dirent.name),
            sourcePath: path.join(frameworkSkillsRoot, dirent.name),
            ensureParentDir: true,
        }))
        .filter((linkDefinition) => pathEntryExists(path.join(linkDefinition.sourcePath, 'SKILL.md')));
}

function ensureProjectInstructionGitignoreEntries({ appRoot, coreRoot }: TEnsureProjectAgentSymlinksArgs) {
    const gitignoreFilepath = path.join(appRoot, '.gitignore');
    if (!pathEntryExists(gitignoreFilepath)) return;

    const managedEntries = getProjectInstructionGitignoreEntries({ coreRoot });
    const managedNormalizedEntries = new Set(managedEntries.map(normalizeGitignoreEntry));
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
        if (shouldSkipLegacyManagedGitignoreLine(line, managedNormalizedEntries)) continue;

        filteredLines.push(line);
    }

    const baseContent = trimTrailingBlankLines(filteredLines).join('\n');
    const managedBlock = renderProjectInstructionGitignoreBlock({ coreRoot });
    const nextContent = baseContent ? `${baseContent}\n\n${managedBlock}\n` : `${managedBlock}\n`;

    if (nextContent === fs.readFileSync(gitignoreFilepath, 'utf8')) return;

    fs.writeFileSync(gitignoreFilepath, nextContent);
    logVerbose(`[agents] Updated ${path.relative(appRoot, gitignoreFilepath) || '.gitignore'} with Proteum-managed instruction ignore entries.`);
}

function ensureSymlinks(appRoot: string, linkDefinitions: TAgentLinkDefinition[], logPrefix: string) {
    for (const linkDefinition of linkDefinitions) {
        const projectFilepath = path.join(appRoot, linkDefinition.projectPath);
        const projectParentDir = path.dirname(projectFilepath);

        if (linkDefinition.ensureParentDir) fs.ensureDirSync(projectParentDir);
        else if (!fs.existsSync(projectParentDir)) continue;

        if (pathEntryExists(projectFilepath)) continue;

        const sourceFilepath = linkDefinition.sourcePath;
        if (!fs.existsSync(sourceFilepath)) {
            throw new Error(`Missing project instruction asset: ${sourceFilepath}`);
        }

        const symlinkTarget = path.relative(projectParentDir, sourceFilepath);
        fs.symlinkSync(symlinkTarget, projectFilepath);

        logVerbose(`${logPrefix} Created ${path.relative(appRoot, projectFilepath) || '.'} -> ${symlinkTarget}`);
    }
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
