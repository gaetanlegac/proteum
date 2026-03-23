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
import { refreshGeneratedTypings, runAppTypecheck } from '../utils/check';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

const allowedBuildArgs = new Set(['prod', 'cache', 'analyze', 'strict']);
type TBuildMultiCompiler = Awaited<ReturnType<Compiler['create']>>;

/*----------------------------------
- COMMAND
----------------------------------*/
function resolveBuildMode(): TCompileMode {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedBuildArgs.has(arg));
    if (invalidArgs.length > 0)
        throw new Error(`Unknown build argument(s): ${invalidArgs.join(', ')}. Allowed values: prod, cache, analyze, strict.`);

    const requestedModes = enabledArgs.filter((arg): arg is TCompileMode => arg === 'prod');
    if (requestedModes.length > 1)
        throw new Error(`Please specify only one build mode. Received: ${requestedModes.join(', ')}.`);

    return requestedModes[0] ?? 'prod';
}

const closeMultiCompiler = async (multiCompiler: TBuildMultiCompiler) =>
    await new Promise<void>((resolve, reject) => {
        multiCompiler.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

export const run = async (): Promise<void> => {
    const mode = resolveBuildMode();
    const strict = cli.args.strict === true;
    let analysisArtifacts: { reportPath: string; statsPath: string } | undefined;

    console.info(
        [
            await renderTitle(
                'PROTEUM BUILD',
                strict
                    ? 'Refreshing contracts, running TypeScript, then producing the bundles.'
                    : 'Producing the server and client bundles.',
            ),
            renderRows([
                { label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot },
                { label: 'mode', value: mode },
                { label: 'strict', value: strict ? 'enabled' : 'disabled' },
                { label: 'cache', value: cli.args.cache === true ? 'enabled' : 'disabled' },
                { label: 'analyze', value: cli.args.analyze === true ? 'enabled' : 'disabled' },
                { label: 'output', value: 'bin/' },
            ]),
        ].join('\n\n'),
    );

    if (strict) {
        console.info(await renderStep('[1/3]', 'Refreshing generated typings.'));
        await refreshGeneratedTypings();
        console.info(await renderStep('[2/3]', 'Running TypeScript typechecking.'));
        await runAppTypecheck();
        console.info(await renderStep('[3/3]', 'Running the production compiler.'));
    } else {
        console.info(await renderStep('[1/1]', 'Running the production compiler.'));
    }

    const compiler = new Compiler(mode, {}, false, 'bin');
    const multiCompiler = await compiler.create();
    let buildError: Error | undefined;

    try {
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
    } catch (error) {
        buildError = error instanceof Error ? error : new Error(String(error));
    } finally {
        compiler.dispose();
        await closeMultiCompiler(multiCompiler);
    }

    if (buildError) throw buildError;

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
