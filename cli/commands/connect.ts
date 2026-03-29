import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildConnectResponse, renderConnectHuman } from '@common/dev/connect';

const allowedConnectArgs = new Set(['controllers', 'json', 'strict']);

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

export const run = async (): Promise<void> => {
    validateConnectArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const response = buildConnectResponse(manifest, {
        includeControllers: cli.args.controllers === true,
        strict: cli.args.strict === true,
    });

    if (cli.args.json === true) {
        console.log(JSON.stringify(response, null, 2));
    } else {
        console.log(renderConnectHuman(manifest, response));
    }

    if (cli.args.strict === true && response.diagnostics.length > 0) {
        throw new Error(
            `Proteum connect failed in strict mode with ${response.summary.errors} errors and ${response.summary.warnings} warnings.`,
        );
    }
};
