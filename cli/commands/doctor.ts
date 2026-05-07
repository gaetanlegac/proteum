import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildContractsDoctorResponse } from '@common/dev/contractsDoctor';
import { buildDoctorResponse, renderDoctorHuman, renderDoctorResponseHuman } from '@common/dev/diagnostics';
import { compactList, printAgentResponse, printJson, truncateForAgent } from '../utils/agentOutput';

const allowedDoctorArgs = new Set(['contracts', 'full', 'human', 'json', 'strict']);

const validateDoctorArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedDoctorArgs.has(arg));

    if (invalidArgs.length > 0) {
        throw new Error(
            `Unknown doctor argument(s): ${invalidArgs.join(', ')}. Allowed values: ${[...allowedDoctorArgs].join(', ')}.`,
        );
    }
};

const compactDiagnostic = (diagnostic: ReturnType<typeof buildDoctorResponse>['diagnostics'][number]) => ({
    level: diagnostic.level,
    code: diagnostic.code,
    message: truncateForAgent(diagnostic.message),
    filepath: diagnostic.filepath,
    sourceLocation: diagnostic.sourceLocation,
    fixHint: diagnostic.fixHint ? truncateForAgent(diagnostic.fixHint) : undefined,
});

export const run = async (): Promise<void> => {
    validateDoctorArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const response =
        cli.args.contracts === true
            ? buildContractsDoctorResponse(manifest, cli.args.strict === true)
            : buildDoctorResponse(manifest, cli.args.strict === true);

    if (cli.args.full === true) {
        printJson(response);
    } else if (cli.args.human === true) {
        console.log(
            cli.args.contracts === true
                ? renderDoctorResponseHuman({
                      emptyMessage: 'No contract diagnostics were found.',
                      manifest,
                      response,
                      title: 'Proteum doctor contracts',
                  })
                : renderDoctorHuman(manifest, cli.args.strict === true),
        );
    } else {
        printAgentResponse({
            summary: `${cli.args.contracts === true ? 'Doctor contracts' : 'Doctor'}: ${response.summary.errors} errors, ${response.summary.warnings} warnings`,
            data: {
                summary: response.summary,
                diagnostics: compactList(response.diagnostics, 10).map(compactDiagnostic),
                totalDiagnostics: response.diagnostics.length,
            },
            fullDetailCommand: `proteum doctor${cli.args.contracts === true ? ' --contracts' : ''} --full`,
        });
    }

    if (cli.args.strict === true && response.diagnostics.length > 0) {
        throw new Error(
            `Proteum doctor failed in strict mode with ${response.summary.errors} errors and ${response.summary.warnings} warnings.`,
        );
    }
};
