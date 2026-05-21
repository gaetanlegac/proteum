import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import {
    createWorktreeBootstrapDiagnostics,
    getWorktreeBootstrapStatus,
    type TWorktreeBootstrapDiagnostic,
} from '../runtime/worktreeBootstrap';
import { buildContractsDoctorResponse } from '@common/dev/contractsDoctor';
import { buildDoctorResponse, renderDoctorResponseHuman } from '@common/dev/diagnostics';
import { compactList, printAgentResponse, printJson, truncateForAgent } from '../utils/agentOutput';
import type { TDoctorResponse } from '@common/dev/diagnostics';

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

const mergeBootstrapDiagnostics = ({
    bootstrapDiagnostics,
    response,
    strict,
}: {
    bootstrapDiagnostics: TWorktreeBootstrapDiagnostic[];
    response: TDoctorResponse;
    strict: boolean;
}): TDoctorResponse => {
    if (bootstrapDiagnostics.length === 0) return response;

    const diagnostics = [...response.diagnostics, ...bootstrapDiagnostics];
    const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;

    return {
        diagnostics,
        summary: {
            errors,
            strictFailed: response.summary.strictFailed || (strict && diagnostics.length > 0),
            warnings,
        },
    };
};

export const run = async (): Promise<void> => {
    validateDoctorArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const rawResponse =
        cli.args.contracts === true
            ? buildContractsDoctorResponse(manifest, cli.args.strict === true)
            : buildDoctorResponse(manifest, cli.args.strict === true);
    const bootstrapStatus = getWorktreeBootstrapStatus({
        appRoot: cli.paths.appRoot,
        proteumVersion: String(cli.packageJson.version || ''),
    });
    const response =
        cli.args.contracts === true
            ? rawResponse
            : mergeBootstrapDiagnostics({
                  bootstrapDiagnostics: createWorktreeBootstrapDiagnostics({
                      appRoot: cli.paths.appRoot,
                      status: bootstrapStatus,
                  }),
                  response: rawResponse,
                  strict: cli.args.strict === true,
              });

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
                : renderDoctorResponseHuman({
                      emptyMessage: 'No diagnostics were found.',
                      manifest,
                      response,
                      title: 'Proteum doctor',
                  }),
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
