/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { UsageError } from 'clipanion';

// Configs
import cli from '..';
import { renderRows } from '../presentation/layout';
import { isLikelyProteumAppRoot } from '../presentation/commands';
import { renderStep, renderSuccess, renderTitle, renderWarning } from '../presentation/ink';
import { configureProjectAgentSymlinks, type TConfigureProjectAgentSymlinksResult } from '../utils/agents';

/*----------------------------------
- HELPERS
----------------------------------*/

const findLikelyRepoRoot = (startPath: string) => {
    let currentPath = path.resolve(startPath);

    while (true) {
        if (fs.existsSync(path.join(currentPath, '.git'))) return currentPath;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const resolveCanonicalPath = (inputPath: string) => {
    const resolvedPath = path.resolve(inputPath);

    try {
        return fs.realpathSync(resolvedPath);
    } catch {
        return resolvedPath;
    }
};

const isInsideDirectory = ({ child, parent }: { child: string; parent: string }) => {
    const relativePath = path.relative(parent, child);
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};

const assertProteumAppRoot = (appRoot: string) => {
    if (isLikelyProteumAppRoot(appRoot)) return;

    throw new UsageError(
        `This command expects a Proteum app root. Missing one or more required entries in ${appRoot}.`,
    );
};

const promptMonorepoRoot = async ({
    appRoot,
    defaultRoot,
}: {
    appRoot: string;
    defaultRoot?: string;
}) => {
    const response = await prompts(
        {
            type: 'text',
            name: 'value',
            message: 'Monorepo root path',
            initial: defaultRoot,
            validate: (input) => {
                const resolvedRoot = resolveCanonicalPath(String(input || defaultRoot || ''));

                if (!input && !defaultRoot) return 'A monorepo root path is required.';
                if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory())
                    return `Directory not found: ${resolvedRoot}`;
                if (!isInsideDirectory({ child: appRoot, parent: resolvedRoot }))
                    return `The Proteum app root must be inside the monorepo root: ${resolvedRoot}`;

                return true;
            },
        },
        {
            onCancel: () => {
                throw new UsageError('Cancelled `proteum configure agents`.');
            },
        },
    );

    return resolveCanonicalPath(String(response.value || defaultRoot || ''));
};

const promptBlockedOverwritePaths = async (blockedPaths: string[]) => {
    if (blockedPaths.length === 0) return [];

    console.info(await renderWarning('Proteum found existing non-managed instruction paths.'));
    console.info(['Choose whether to overwrite each path with a Proteum-managed symlink:', ...blockedPaths.map((entry) => `- ${entry}`)].join('\n'));

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
                    throw new UsageError('Cancelled `proteum configure agents`.');
                },
            },
        );

        if (response.value === true) overwriteBlockedPaths.push(blockedPath);
    }

    return overwriteBlockedPaths;
};

const renderConfigureResultSections = (result: TConfigureProjectAgentSymlinksResult) => {
    const sections: string[] = [];

    sections.push(
        renderRows(
            [
                { label: 'mode', value: result.mode },
                ...(result.monorepoRoot ? [{ label: 'monorepo root', value: result.monorepoRoot }] : []),
            ],
            { minLabelWidth: 16, maxLabelWidth: 16 },
        ),
    );

    if (result.created.length > 0) sections.push(['Created:', ...result.created.map((entry) => `- ${entry}`)].join('\n'));
    if (result.updated.length > 0) sections.push(['Updated:', ...result.updated.map((entry) => `- ${entry}`)].join('\n'));
    if (result.overwritten.length > 0)
        sections.push(['Overwritten:', ...result.overwritten.map((entry) => `- ${entry}`)].join('\n'));
    if (result.updatedGitignores.length > 0)
        sections.push(['Updated .gitignore:', ...result.updatedGitignores.map((entry) => `- ${entry}`)].join('\n'));
    if (result.blocked.length > 0)
        sections.push(
            [
                'Skipped existing non-managed paths:',
                ...result.blocked.map((entry) => `- ${entry}`),
            ].join('\n'),
        );

    return sections;
};

/*----------------------------------
- COMMAND
----------------------------------*/

export const run = async (): Promise<void> => {
    if (cli.args.action !== 'agents') throw new UsageError('Usage: `proteum configure agents`');

    const appRoot = resolveCanonicalPath(cli.paths.appRoot);
    assertProteumAppRoot(appRoot);

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new UsageError('`proteum configure agents` is interactive and requires a TTY.');
    }

    const likelyRepoRoot = findLikelyRepoRoot(appRoot);
    const defaultMonorepoRoot =
        likelyRepoRoot && likelyRepoRoot !== appRoot && isInsideDirectory({ child: appRoot, parent: likelyRepoRoot })
            ? likelyRepoRoot
            : undefined;
    console.info(
        [
            await renderTitle('PROTEUM CONFIGURE AGENTS', 'Configure Proteum-managed instruction symlinks.'),
            renderRows([{ label: 'app', value: appRoot === process.cwd() ? '.' : appRoot }]),
        ].join('\n\n'),
    );

    const monorepoResponse = await prompts(
        {
            type: 'confirm',
            name: 'value',
            message: 'Is this Proteum app part of a monorepo?',
            initial: defaultMonorepoRoot !== undefined,
        },
        {
            onCancel: () => {
                throw new UsageError('Cancelled `proteum configure agents`.');
            },
        },
    );
    const isMonorepo = monorepoResponse.value === true;
    const monorepoRoot = isMonorepo
        ? await promptMonorepoRoot({
              appRoot,
              defaultRoot: defaultMonorepoRoot,
          })
        : undefined;

    const preview = configureProjectAgentSymlinks({
        appRoot,
        coreRoot: cli.paths.core.root,
        dryRun: true,
        monorepoRoot,
    });
    const overwriteBlockedPaths = await promptBlockedOverwritePaths(preview.blocked);

    console.info(
        await renderStep(
            '[1/1]',
            isMonorepo
                ? `Writing monorepo-aware instruction symlinks using ${monorepoRoot}.`
                : 'Writing standalone instruction symlinks.',
        ),
    );

    const result = configureProjectAgentSymlinks({
        appRoot,
        coreRoot: cli.paths.core.root,
        monorepoRoot,
        overwriteBlockedPaths,
    });
    const sections = renderConfigureResultSections(result);

    console.info(await renderSuccess('Proteum-managed instruction symlinks are configured.'));

    if (sections.length > 0) console.info(`\n${sections.join('\n\n')}`);
};
