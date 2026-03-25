import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildDoctorResponse, renderDoctorHuman } from '@common/dev/diagnostics';

const allowedDoctorArgs = new Set(['json', 'strict']);

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
    const response = buildDoctorResponse(manifest, cli.args.strict === true);

    if (cli.args.json === true) {
        console.log(JSON.stringify(response, null, 2));
    } else {
        console.log(renderDoctorHuman(manifest, cli.args.strict === true));
    }

    if (cli.args.strict === true && manifest.diagnostics.length > 0) {
        throw new Error(
            `Proteum doctor failed in strict mode with ${response.summary.errors} errors and ${response.summary.warnings} warnings.`,
        );
    }
};
