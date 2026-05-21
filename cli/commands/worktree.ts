import { UsageError } from 'clipanion';

import cli from '..';
import {
    compactWorktreeBootstrapStatus,
    getWorktreeBootstrapStatus,
    runWorktreeBootstrapCreate,
    runWorktreeBootstrapInit,
} from '../runtime/worktreeBootstrap';
import { printAgentResponse, printJson } from '../utils/agentOutput';

/*----------------------------------
- HELPERS
----------------------------------*/

const getAction = () => {
    const action = typeof cli.args.action === 'string' ? cli.args.action : '';
    if (action === 'init' || action === 'create') return action;

    throw new UsageError('Usage: `proteum worktree init` or `proteum worktree create <target-repo-root>`.');
};

const getStringArg = (name: string) => {
    const value = cli.args[name];
    return typeof value === 'string' ? value.trim() : '';
};

const getBooleanArg = (name: string) => cli.args[name] === true;

const printResult = ({
    data,
    json,
    summary,
}: {
    data: object;
    json: boolean;
    summary: string;
}) => {
    if (json) {
        printJson({ ok: true, format: 'proteum-agent-v1', summary, data });
        return;
    }

    printAgentResponse({ summary, data });
};

/*----------------------------------
- COMMAND
----------------------------------*/

export const run = async (): Promise<void> => {
    const action = getAction();
    const json = getBooleanArg('json');
    const source = getStringArg('source') || undefined;
    const skipDeps = getBooleanArg('skipDeps');
    const reason = getStringArg('reason') || undefined;

    if (action === 'init') {
        const result = await runWorktreeBootstrapInit({
            appRoot: cli.paths.appRoot,
            coreRoot: cli.paths.core.root,
            json,
            proteumVersion: String(cli.packageJson.version || ''),
            reason,
            refresh: getBooleanArg('refresh'),
            skipDeps,
            source,
        });

        printResult({
            data: {
                appRoot: result.appRoot,
                markerFilepath: result.markerFilepath,
                worktreeBootstrap: compactWorktreeBootstrapStatus(result.status),
            },
            json,
            summary: 'Proteum worktree bootstrap completed.',
        });
        return;
    }

    const targetRepoRoot = getStringArg('target');
    const branch = getStringArg('branch');
    if (!source) throw new UsageError('worktree create requires --source <source-app-root>.');

    const result = await runWorktreeBootstrapCreate({
        appRoot: source,
        base: getStringArg('base') || undefined,
        branch,
        coreRoot: cli.paths.core.root,
        json,
        proteumVersion: String(cli.packageJson.version || ''),
        reason,
        refresh: true,
        skipDeps,
        source,
        targetRepoRoot,
    });
    const status = getWorktreeBootstrapStatus({
        appRoot: result.targetAppRoot,
        proteumVersion: String(cli.packageJson.version || ''),
    });

    printResult({
        data: {
            branch: result.branch,
            sourceAppRoot: result.sourceAppRoot,
            sourceRepoRoot: result.sourceRepoRoot,
            targetAppRoot: result.targetAppRoot,
            targetRepoRoot: result.targetRepoRoot,
            worktreeBootstrap: compactWorktreeBootstrapStatus(status),
        },
        json,
        summary: `Created Proteum worktree at ${result.targetRepoRoot}.`,
    });
};
