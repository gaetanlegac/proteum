/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { rspack, type Configuration, type Module } from '@rspack/core';

// Plugins

// Core
import createCommonConfig, { TCompileMode, TCompileOutputTarget, regex } from '../common';
import { createClientBundleAnalysisPlugins } from '../common/bundleAnalysis';
import { toRspackAliases } from '../common/rspackAliases';
import identityAssets from './identite';
import cli from '../..';
import { logVerbose } from '../../runtime/verbose';

// Type
import type { App } from '../../app';

const debug = false;
const ssrScriptPattern = /\.ssr\.(ts|tsx)$/;
const normalizeModulePath = (value?: string) => (value || '').replace(/\\/g, '/');
const getFrameworkSourceRoot = () => {
    const installedCoreRoot = cli.paths.framework.installedRoot
        ? normalizeModulePath(cli.paths.framework.installedRoot)
        : undefined;
    const activeCoreRoot = normalizeModulePath(cli.paths.framework.activeRoot);

    if (installedCoreRoot && activeCoreRoot.includes('/node_modules/')) {
        return installedCoreRoot;
    }

    return activeCoreRoot;
};

const resolveFromAppOrCore = (_app: App, request: string) => cli.paths.resolveRequest(request);
const rewriteFrameworkAliasTargets = (aliases: Record<string, string | string[]>) => {
    const visibleFrameworkRoots = [
        ...cli.paths.getVisiblePackageInstallRoots('proteum'),
        cli.paths.framework.installedRoot,
        cli.paths.framework.activeRoot,
    ]
        .filter((rootPath): rootPath is string => typeof rootPath === 'string' && rootPath !== '')
        .map((rootPath) => normalizeModulePath(rootPath))
        .filter((rootPath, index, list) => list.indexOf(rootPath) === index);
    const frameworkSourceRoot = getFrameworkSourceRoot();

    const rewriteCandidate = (candidate: string) =>
        visibleFrameworkRoots.reduce((nextCandidate, rootPath) => {
                const normalizedCandidate = normalizeModulePath(nextCandidate);

                return normalizedCandidate.startsWith(rootPath + '/')
                    ? frameworkSourceRoot + normalizedCandidate.substring(rootPath.length)
                    : nextCandidate;
            }, candidate);

    return Object.fromEntries(
        Object.entries(aliases).map(([alias, value]) => [
            alias,
            Array.isArray(value) ? value.map(rewriteCandidate) : rewriteCandidate(value),
        ]),
    );
};

const getModulePath = (module: Module) => {
    const resource = typeof module.nameForCondition === 'function' ? module.nameForCondition() : undefined;
    const fallbackModule = module as Module & { resource?: string; context?: string };

    return normalizeModulePath(resource || fallbackModule.resource || fallbackModule.context);
};

const isExternalVendorModule = (module: Module) => {
    const modulePath = getModulePath(module);

    return modulePath.includes('/node_modules/') && !modulePath.includes('/node_modules/proteum/');
};

const isCoreSourceModule = (module: Module) => {
    const modulePath = getModulePath(module);
    const frameworkSourceRoot = getFrameworkSourceRoot();

    return modulePath.startsWith(frameworkSourceRoot + '/') || modulePath.includes('/node_modules/proteum/');
};
const resolveLightningCssTargets = (app: App) => {
    const browserslistConfig = app.packageJson.browserslist;

    if (typeof browserslistConfig === 'string') return browserslistConfig;

    if (Array.isArray(browserslistConfig) && browserslistConfig.every((target) => typeof target === 'string'))
        return browserslistConfig;

    if (!browserslistConfig || typeof browserslistConfig !== 'object') return undefined;

    for (const env of ['production', 'defaults']) {
        const targets = browserslistConfig[env];

        if (typeof targets === 'string') return targets;

        if (Array.isArray(targets) && targets.every((target) => typeof target === 'string')) return targets;
    }

    return undefined;
};

/*----------------------------------
- CONFIG
----------------------------------*/
export default function createCompiler(
    app: App,
    mode: TCompileMode,
    outputTarget: TCompileOutputTarget = mode === 'dev' ? 'dev' : 'bin',
): Configuration {
    logVerbose(`Creating compiler for client (${mode}).`);
    const dev = mode === 'dev';
    const outputPath = app.outputPath(outputTarget);
    const frameworkSourceRoot = getFrameworkSourceRoot();
    const frameworkRoots = [frameworkSourceRoot, ...cli.paths.getFrameworkRoots()].filter(
        (rootPath, index, list) => list.indexOf(rootPath) === index,
    );
    const transpileModuleDirectories = app.transpileModuleDirectories;
    const lightningCssTargets = resolveLightningCssTargets(app);
    const hmrClientEntry = path.join(frameworkSourceRoot, 'client', 'dev', 'hmr.ts');

    const commonConfig = createCommonConfig(app, 'client', mode, outputTarget);

    identityAssets(app, path.join(outputPath, 'public', 'app'));

    // Symlinks to public
    /*const publicDirs = fs.readdirSync(app.paths.root + '/public');
    for (const publicDir of publicDirs)
        fs.symlinkSync( 
            app.paths.root + '/public/' + publicDir,  
            app.paths.public + '/' + publicDir
        );*/

    // Convert tsconfig paths into bundler aliases.
    const { aliases } = app.aliases.client.forWebpack({ modulesPath: cli.paths.framework.appNodeModulesRoot });
    const resolvedAliases = rewriteFrameworkAliasTargets(aliases);

    // We're not supposed in any case to import server libs from client
    delete resolvedAliases['@server'];
    delete resolvedAliases['@/server'];
    const rspackAliases = toRspackAliases(resolvedAliases);
    rspackAliases['proteum'] = frameworkSourceRoot;
    rspackAliases['@/client/router$'] = frameworkSourceRoot + '/client/router.ts';
    rspackAliases['preact/jsx-runtime$'] = resolveFromAppOrCore(app, 'preact/jsx-runtime');
    rspackAliases['react/jsx-runtime$'] = resolveFromAppOrCore(app, 'preact/jsx-runtime');
    rspackAliases['react/jsx-dev-runtime$'] = resolveFromAppOrCore(app, 'preact/jsx-dev-runtime');

    debug && console.log('client aliases', rspackAliases);
    const config: Configuration = {
        ...commonConfig,

        name: 'client',
        target: 'web',
        entry: {
            client: dev
                ? [hmrClientEntry, frameworkSourceRoot + '/client/index.ts']
                : [frameworkSourceRoot + '/client/index.ts'],
        },

        output: {
            pathinfo: dev,
            path: outputPath + '/public',
            filename: '[name].js', // Output client.js
            assetModuleFilename: '[hash][ext]',
            environment: {
                arrowFunction: true,
                asyncFunction: true,
                bigIntLiteral: true,
                const: true,
                destructuring: true,
                dynamicImport: true,
                forOf: true,
                optionalChaining: true,
                templateLiteral: true,
            },
            cssFilename: '[name].css',
            cssChunkFilename: '[name].css',
            chunkFilename: dev ? '[name].js' : '[id].[contenthash:8].js',
        },

        resolve: {
            ...commonConfig.resolve,

            alias: rspackAliases,

            extensions: ['.mjs', '.ts', '.tsx', '.jsx', '.js', '.json', '.sql'],
        },

        module: {
            // Make missing exports an error instead of warning
            strictExportPresence: true,

            rules: [
                {
                    test: ssrScriptPattern,
                    include: [
                        app.paths.root + '/client',
                        app.paths.client.generated,

                        app.paths.root + '/common',
                        app.paths.common.generated,

                        app.paths.root + '/server',
                        app.paths.server.generated,
                        ...frameworkRoots.map((rootPath) => rootPath + '/client'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/common'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/server'),
                        ...transpileModuleDirectories,
                    ],
                    loader: path.join(
                        frameworkSourceRoot,
                        'cli',
                        'compiler',
                        'common',
                        'loaders',
                        'forbid-ssr-import.js',
                    ),
                },
                {
                    test: regex.scripts,
                    include: [
                        app.paths.root + '/client',
                        app.paths.client.generated,

                        app.paths.root + '/common',
                        app.paths.common.generated,

                        // Prisma 7 generates browser-safe TypeScript entrypoints under var/prisma.
                        app.paths.root + '/var/prisma',

                        app.paths.server.generated + '/models.ts',
                        ...frameworkRoots.map((rootPath) => rootPath + '/client'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/common'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/server'),
                        ...transpileModuleDirectories,
                    ],
                    rules: require('../common/scripts')({ app, side: 'client', dev }),
                },

                // Les pages étan tà la fois compilées dans le bundle client et serveur
                // On ne compile les ressources (css) qu'une seule fois
                {
                    test: regex.style,
                    rules: require('../common/files/style')(app, dev, true),

                    // CSS imports stay side-effectful even when a package marks itself otherwise.
                    sideEffects: true,
                },

                ...require('../common/files/images')(app, dev, true),

                ...require('../common/files/autres')(app, dev, true),

                // Exclude dev modules from production build
                /*...(dev ? [] : [
                    {
                        test: app.paths.root + '/node_modules/react-deep-force-update/lib/index.js'),
                        loader: 'null-loader',
                    },
                ]),*/
            ],
        },

        plugins: [
            ...(commonConfig.plugins || []),

            ...(dev
                ? []
                : [
                      new rspack.NormalModuleReplacementPlugin(
                          /^@client\/dev\/profiler$/,
                          frameworkSourceRoot + '/client/dev/profiler/noop.tsx',
                      ),
                      new rspack.NormalModuleReplacementPlugin(
                          /^@client\/dev\/profiler\/runtime$/,
                          frameworkSourceRoot + '/client/dev/profiler/runtime.noop.ts',
                      ),
                  ]),

            // Extract CSS in dev too so SSR emits the same stylesheet links as production.
            new rspack.CssExtractRspackPlugin({}),

            ...createClientBundleAnalysisPlugins(app, outputTarget),
        ],

        // Use the cheapest practical client source maps in dev for faster rebuilds.
        devtool: dev ? 'eval-cheap-module-source-map' : 'source-map',
        /*devServer: {
            hot: true,
        },*/

        optimization: {
            // Code splitting serveur = même que client
            // La décomposition des chunks doit toujours être la même car le rendu des pages dépend de cette organisation

            runtimeChunk: { name: 'runtime' },
            splitChunks: {
                // Keep the initial shell lean while still preserving async route isolation.
                chunks: 'all',
                minSize: 20_000,
                minRemainingSize: 0,
                maxInitialRequests: 30,
                maxAsyncRequests: 30,
                cacheGroups: {
                    framework: {
                        test: isCoreSourceModule,
                        chunks: 'initial',
                        name: 'framework',
                        priority: 40,
                        reuseExistingChunk: true,
                        enforce: true,
                    },
                    initialVendors: {
                        test: isExternalVendorModule,
                        chunks: 'initial',
                        name: 'vendors',
                        priority: 30,
                        reuseExistingChunk: true,
                        enforce: true,
                    },
                    asyncVendors: {
                        test: isExternalVendorModule,
                        chunks: 'async',
                        priority: 20,
                        reuseExistingChunk: true,
                    },
                    default: { minChunks: 2, priority: 10, reuseExistingChunk: true },
                    defaultVendors: false,
                },
            },

            // Production
            ...(dev
                ? {}
                : {
                      minimize: true,
                      removeAvailableModules: true,
                      minimizer: [
                          new rspack.SwcJsMinimizerRspackPlugin({}),
                          new rspack.LightningCssMinimizerRspackPlugin({
                              ...(lightningCssTargets ? { minimizerOptions: { targets: lightningCssTargets } } : {}),
                          }),
                      ],
                      nodeEnv: 'production',
                      sideEffects: true,
                  }),
        },
    };

    return config;
}
