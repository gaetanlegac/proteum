/*----------------------------------
- DEPENDANCES
----------------------------------*/

import { UsageError } from 'clipanion';

// Core
import cli from '..';
import { app } from '../app';

// Configs
import Compiler from '../compiler';
import type { TCompileMode } from '../compiler/common';
import {
    consumeClientBundleAnalysisServerUrl,
    getBundleAnalysisMode,
    getBundleAnalysisServerHost,
    getBundleAnalysisServerPort,
    getClientBundleAnalysisReportPaths,
    hasBundleAnalysisServerOverrides,
    waitForClientBundleAnalysisArtifacts,
} from '../compiler/common/bundleAnalysis';
import { refreshGeneratedTypings, runAppTypecheck } from '../utils/check';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

const allowedBuildArgs = new Set(['prod', 'cache', 'analyze', 'analyzeServe', 'strict']);
type TBuildMultiCompiler = Awaited<ReturnType<Compiler['create']>>;
type TBuildAnalysisResult =
    | { mode: 'static'; reportPath: string; statsPath: string }
    | { mode: 'server'; statsPath: string; url?: string };

/*----------------------------------
- COMMAND
----------------------------------*/
function resolveBuildMode(): TCompileMode {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedBuildArgs.has(arg));
    if (invalidArgs.length > 0)
        throw new Error(
            `Unknown build argument(s): ${invalidArgs.join(', ')}. Allowed values: prod, cache, analyze, analyzeServe, strict.`,
        );

    const requestedModes = enabledArgs.filter((arg): arg is TCompileMode => arg === 'prod');
    if (requestedModes.length > 1)
        throw new Error(`Please specify only one build mode. Received: ${requestedModes.join(', ')}.`);

    return requestedModes[0] ?? 'prod';
}

function assertValidBuildAnalyzerArgs() {
    const analyzeEnabled = cli.args.analyze === true;
    const analyzeServeEnabled = cli.args.analyzeServe === true;

    if (!analyzeEnabled && (analyzeServeEnabled || hasBundleAnalysisServerOverrides())) {
        throw new UsageError('Analyzer server flags require `--analyze`.');
    }

    if (!analyzeServeEnabled && hasBundleAnalysisServerOverrides()) {
        throw new UsageError('`--analyze-host` and `--analyze-port` require `--analyze-serve`.');
    }
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
    assertValidBuildAnalyzerArgs();

    const analyze = cli.args.analyze === true;
    const analysisMode = analyze ? getBundleAnalysisMode() : undefined;
    let analysisResult: TBuildAnalysisResult | undefined;

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
                { label: 'analyze', value: analyze ? 'enabled' : 'disabled' },
                ...(analyze ? [{ label: 'analyze mode', value: analysisMode || 'static' }] : []),
                ...(analysisMode === 'server'
                    ? [
                          { label: 'analyze host', value: getBundleAnalysisServerHost() },
                          { label: 'analyze port', value: String(getBundleAnalysisServerPort()) },
                      ]
                    : []),
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

                if (analysisMode === 'static') {
                    waitForClientBundleAnalysisArtifacts(app, 'bin')
                        .then(() => {
                            const { reportPath, statsPath } = getClientBundleAnalysisReportPaths(app, 'bin');
                            analysisResult = { mode: 'static', reportPath, statsPath };
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

    if (analysisMode === 'server') {
        const { statsPath } = getClientBundleAnalysisReportPaths(app, 'bin');
        analysisResult = {
            mode: 'server',
            statsPath,
            url: consumeClientBundleAnalysisServerUrl(),
        };
    }

    if (analysisResult !== undefined) {
        console.info(
            renderRows([
                ...(analysisResult.mode === 'static' ? [{ label: 'report', value: analysisResult.reportPath }] : []),
                ...(analysisResult.mode === 'server'
                    ? [
                          { label: 'server', value: analysisResult.url || 'Analyzer server started. See the analyzer log for the URL.' },
                      ]
                    : []),
                { label: 'stats', value: analysisResult.statsPath },
            ]),
        );
    }

    console.info(await renderSuccess(`Build completed in ${mode} mode.`));
};
