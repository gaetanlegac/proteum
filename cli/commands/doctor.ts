import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildContractsDoctorResponse } from '@common/dev/contractsDoctor';
import { buildDoctorResponse, renderDoctorHuman, renderDoctorResponseHuman } from '@common/dev/diagnostics';

const allowedDoctorArgs = new Set(['contracts', 'json', 'strict']);

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

export const run = async (): Promise<void> => {
    validateDoctorArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const response =
        cli.args.contracts === true
            ? buildContractsDoctorResponse(manifest, cli.args.strict === true)
            : buildDoctorResponse(manifest, cli.args.strict === true);

    if (cli.args.json === true) {
        console.log(JSON.stringify(response, null, 2));
    } else {
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
    }

    if (cli.args.strict === true && response.diagnostics.length > 0) {
        throw new Error(
            `Proteum doctor failed in strict mode with ${response.summary.errors} errors and ${response.summary.warnings} warnings.`,
        );
    }
};
