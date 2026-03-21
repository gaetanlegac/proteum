/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs-extra';
import path from 'path';

/*----------------------------------
- TYPES
----------------------------------*/

type TEnsureProjectAgentSymlinksArgs = { appRoot: string; coreRoot: string };

type TAgentLinkDefinition = { projectPath: string; sourcePath: string; ensureParentDir?: boolean };

/*----------------------------------
- CONSTANTS
----------------------------------*/

// Project-local AGENTS entrypoints mapped to their framework-owned source files.
const codexAgentLinkDefinitions: TAgentLinkDefinition[] = [
    { projectPath: 'AGENTS.md', sourcePath: 'AGENTS.md' },
    { projectPath: 'CODING_STYLE.md', sourcePath: 'CODING_STYLE.md' },
    { projectPath: path.join('client', 'AGENTS.md'), sourcePath: path.join('client', 'AGENTS.md') },
    { projectPath: path.join('client', 'pages', 'AGENTS.md'), sourcePath: path.join('client', 'pages', 'AGENTS.md') },
    {
        projectPath: path.join('server', 'services', 'AGENTS.md'),
        sourcePath: path.join('server', 'services', 'AGENTS.md'),
    },
    { projectPath: path.join('server', 'routes', 'AGENTS.md'), sourcePath: path.join('server', 'routes', 'AGENTS.md') },
    { projectPath: path.join('tests', 'e2e', 'AGENTS.md'), sourcePath: path.join('tests', 'AGENTS.md') },
];

/*----------------------------------
- PUBLIC API
----------------------------------*/

export function ensureProjectAgentSymlinks({ appRoot, coreRoot }: TEnsureProjectAgentSymlinksArgs) {
    const agentSourceRoot = path.join(coreRoot, 'agents', 'codex');
    const agentLinks = codexAgentLinkDefinitions.map((linkDefinition) => ({
        ...linkDefinition,
        sourcePath: path.join(agentSourceRoot, linkDefinition.sourcePath),
    }));

    ensureSymlinks(appRoot, agentLinks, '[agents]');
    ensureProjectSkillSymlinks({ appRoot, coreRoot });
}

/*----------------------------------
- HELPERS
----------------------------------*/

function ensureProjectSkillSymlinks({ appRoot, coreRoot }: TEnsureProjectAgentSymlinksArgs) {
    const frameworkSkillsRoot = path.join(coreRoot, 'skills');
    if (!fs.existsSync(frameworkSkillsRoot)) return;

    const skillLinks: TAgentLinkDefinition[] = fs
        .readdirSync(frameworkSkillsRoot, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => ({
            projectPath: path.join('skills', dirent.name),
            sourcePath: path.join(frameworkSkillsRoot, dirent.name),
            ensureParentDir: true,
        }))
        .filter((linkDefinition) => pathEntryExists(path.join(linkDefinition.sourcePath, 'SKILL.md')));

    ensureSymlinks(appRoot, skillLinks, '[skills]');
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
            throw new Error(`Missing framework asset: ${sourceFilepath}`);
        }

        const symlinkTarget = path.relative(projectParentDir, sourceFilepath);
        fs.symlinkSync(symlinkTarget, projectFilepath);

        console.info(`${logPrefix} Created ${path.relative(appRoot, projectFilepath) || '.'} -> ${symlinkTarget}`);
    }
}

function pathEntryExists(filepath: string) {
    try {
        fs.lstatSync(filepath);
        return true;
    } catch {
        return false;
    }
}
