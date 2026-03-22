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
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

const allowedBuildArgs = new Set(['prod', 'cache', 'analyze']);

/*----------------------------------
- COMMAND
----------------------------------*/
function resolveBuildMode(): TCompileMode {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedBuildArgs.has(arg));
    if (invalidArgs.length > 0)
        throw new Error(`Unknown build argument(s): ${invalidArgs.join(', ')}. Allowed values: prod, cache, analyze.`);

    const requestedModes = enabledArgs.filter((arg): arg is TCompileMode => arg === 'prod');
    if (requestedModes.length > 1)
        throw new Error(`Please specify only one build mode. Received: ${requestedModes.join(', ')}.`);

    return requestedModes[0] ?? 'prod';
}

export const run = async (): Promise<void> => {
    const mode = resolveBuildMode();
    const compiler = new Compiler(mode, {}, false, 'bin');
    const multiCompiler = await compiler.create();
    let analysisArtifacts: { reportPath: string; statsPath: string } | undefined;

    console.info(
        [
            await renderTitle('PROTEUM BUILD', 'Producing the server and client bundles.'),
            renderRows([
                { label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot },
                { label: 'mode', value: mode },
                { label: 'cache', value: cli.args.cache === true ? 'enabled' : 'disabled' },
                { label: 'analyze', value: cli.args.analyze === true ? 'enabled' : 'disabled' },
                { label: 'output', value: 'bin/' },
            ]),
            await renderStep('[1/1]', 'Running the production compiler.'),
        ].join('\n\n'),
    );

    await new Promise<void>((resolve, reject) => {
        multiCompiler.run((error, stats) => {
            if (error) {
                console.error('An error occurred during the compilation:', error);
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
                        analysisArtifacts = getClientBundleAnalysisReportPaths(app, 'bin');
                        resolve();
                    })
                    .catch(reject);
                return;
            }

            resolve();
        });
    });

    if (analysisArtifacts !== undefined) {
        console.info(
            renderRows([
                { label: 'report', value: analysisArtifacts.reportPath },
                { label: 'stats', value: analysisArtifacts.statsPath },
            ]),
        );
    }

    console.info(await renderSuccess(`Build completed in ${mode} mode.`));
};
