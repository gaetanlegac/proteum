import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildConnectResponse, renderConnectHuman } from '@common/dev/connect';
import { compactList, printAgentResponse, printJson, truncateForAgent } from '../utils/agentOutput';

const allowedConnectArgs = new Set(['controllers', 'full', 'human', 'json', 'strict']);

const validateConnectArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedConnectArgs.has(arg));

    if (invalidArgs.length > 0) {
        throw new Error(
            `Unknown connect argument(s): ${invalidArgs.join(', ')}. Allowed values: ${[...allowedConnectArgs].join(', ')}.`,
        );
    }
};

const compactDiagnostic = (diagnostic: ReturnType<typeof buildConnectResponse>['diagnostics'][number]) => ({
    level: diagnostic.level,
    code: diagnostic.code,
    message: truncateForAgent(diagnostic.message),
    filepath: diagnostic.filepath,
    sourceLocation: diagnostic.sourceLocation,
});

const compactProject = (project: ReturnType<typeof buildConnectResponse>['projects'][number]) => ({
    namespace: project.namespace,
    identityIdentifier: project.identityIdentifier,
    identityName: project.identityName,
    sourceKind: project.sourceKind,
    sourceConfigured: project.sourceConfigured,
    urlInternalConfigured: project.urlInternalConfigured,
    urlInternal: project.urlInternal,
    controllerCount: project.controllerCount,
    cachedContractExists: project.cachedContractExists,
    cachedContractFilepath: project.cachedContractFilepath,
    typingMode: project.typingMode,
    controllers: project.controllers ? compactList(project.controllers, 8) : undefined,
});

export const run = async (): Promise<void> => {
    validateConnectArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const response = buildConnectResponse(manifest, {
        includeControllers: cli.args.controllers === true,
        strict: cli.args.strict === true,
    });

    if (cli.args.full === true) {
        printJson(response);
    } else if (cli.args.human === true) {
        console.log(renderConnectHuman(manifest, response));
    } else {
        printAgentResponse({
            summary: `Connect: ${response.summary.connectedProjects} projects, ${response.summary.importedControllers} controllers, ${response.summary.errors} errors, ${response.summary.warnings} warnings`,
            data: {
                app: response.app,
                summary: response.summary,
                projects: response.projects.map(compactProject),
                diagnostics: compactList(response.diagnostics, 10).map(compactDiagnostic),
                totalDiagnostics: response.diagnostics.length,
            },
            fullDetailCommand: `proteum connect${cli.args.controllers === true ? ' --controllers' : ''} --full`,
        });
    }

    if (cli.args.strict === true && response.diagnostics.length > 0) {
        throw new Error(
            `Proteum connect failed in strict mode with ${response.summary.errors} errors and ${response.summary.warnings} warnings.`,
        );
    }
};
