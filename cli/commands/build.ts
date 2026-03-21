/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import cli from '..';

// Configs
import Compiler from '../compiler';
import type { TCompileMode } from '../compiler/common';

const allowedBuildArgs = new Set(['dev', 'prod', 'cache']);

/*----------------------------------
- COMMAND
----------------------------------*/
function resolveBuildMode(): TCompileMode {

    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter(arg => !allowedBuildArgs.has(arg));
    if (invalidArgs.length > 0)
        throw new Error(`Unknown build argument(s): ${invalidArgs.join(', ')}. Allowed values: dev, prod, cache.`);

    const requestedModes = enabledArgs.filter((arg): arg is TCompileMode =>
        arg === 'dev' || arg === 'prod'
    );
    if (requestedModes.length > 1)
        throw new Error(`Please specify only one build mode. Received: ${requestedModes.join(', ')}.`);

    return requestedModes[0] ?? 'dev';
}

export const run = async (): Promise<void> => {

    const mode = resolveBuildMode();
    const compiler = new Compiler(mode, {}, false, 'bin');
    const multiCompiler = await compiler.create();

    await new Promise<void>((resolve, reject) => {
        multiCompiler.run((error, stats) => {

            if (error) {
                console.error("An error occurred during the compilation:", error);
                reject(error);
                return;
            }

            if (stats?.hasErrors()) {
                reject(new Error(`Compilation failed for build mode "${mode}".`));
                return;
            }

            resolve();
        });

    });
};
