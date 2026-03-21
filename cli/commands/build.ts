/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import cli from '..';
import { app } from '../app';

// Configs
import Compiler from '../compiler';
import type { TCompileMode } from '../compiler/common';
import {
    getClientBundleAnalysisReportPaths,
    waitForClientBundleAnalysisArtifacts,
} from '../compiler/common/bundleAnalysis';

const allowedBuildArgs = new Set(['prod', 'cache', 'analyze']);

/*----------------------------------
- COMMAND
----------------------------------*/
function resolveBuildMode(): TCompileMode {

    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter(arg => !allowedBuildArgs.has(arg));
    if (invalidArgs.length > 0)
        throw new Error(`Unknown build argument(s): ${invalidArgs.join(', ')}. Allowed values: prod, cache, analyze.`);

    const requestedModes = enabledArgs.filter((arg): arg is TCompileMode =>
        arg === 'prod'
    );
    if (requestedModes.length > 1)
        throw new Error(`Please specify only one build mode. Received: ${requestedModes.join(', ')}.`);

    return requestedModes[0] ?? 'prod';
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

            if (cli.args.analyze === true) {
                waitForClientBundleAnalysisArtifacts(app, 'bin')
                    .then(() => {
                        const { reportPath, statsPath } = getClientBundleAnalysisReportPaths(app, 'bin');
                        console.info(`Client bundle analysis report: ${reportPath}`);
                        console.info(`Client bundle analysis stats: ${statsPath}`);
                        resolve();
                    })
                    .catch(reject);
                return;
            }

            resolve();
        });

    });
};
