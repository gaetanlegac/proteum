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

// Type
import type { App } from '../../app';

const debug = false;
const ssrScriptPattern = /\.ssr\.(ts|tsx)$/;
const normalizedCoreRoot = cli.paths.core.root.replace(/\\/g, '/');
const hmrClientEntry = path.join(cli.paths.core.root, 'client', 'dev', 'hmr.ts');

const normalizeModulePath = (value?: string) => (value || '').replace(/\\/g, '/');
const resolveFromAppOrCore = (app: App, request: string) =>
    require.resolve(request, { paths: [app.paths.root, cli.paths.core.root] });

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

    return modulePath.startsWith(normalizedCoreRoot + '/') || modulePath.includes('/node_modules/proteum/');
};

/*----------------------------------
- CONFIG
----------------------------------*/
export default function createCompiler(
    app: App,
    mode: TCompileMode,
    outputTarget: TCompileOutputTarget = mode === 'dev' ? 'dev' : 'bin',
): Configuration {
    console.info(`Creating compiler for client (${mode}).`);
    const dev = mode === 'dev';
    const outputPath = app.outputPath(outputTarget);

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
    const { aliases } = app.aliases.client.forWebpack({ modulesPath: app.paths.root + '/node_modules' });

    // We're not supposed in any case to import server libs from client
    delete aliases['@server'];
    delete aliases['@/server'];
    const rspackAliases = toRspackAliases(aliases);
    rspackAliases['@/client/router$'] = cli.paths.core.root + '/client/router.ts';
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
                ? [hmrClientEntry, cli.paths.core.root + '/client/index.ts']
                : [cli.paths.core.root + '/client/index.ts'],
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
                        cli.paths.core.root + '/client',

                        app.paths.root + '/common',
                        cli.paths.core.root + '/common',

                        app.paths.root + '/server',
                        cli.paths.core.root + '/server',
                    ],
                    loader: path.join(
                        cli.paths.core.root,
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
                        cli.paths.core.root + '/client',

                        app.paths.root + '/common',
                        cli.paths.core.root + '/common',

                        // Prisma 7 generates browser-safe TypeScript entrypoints under var/prisma.
                        app.paths.root + '/var/prisma',

                        app.paths.root + '/server/.generated/models.ts',
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

            ...(dev ? [] : [new rspack.CssExtractRspackPlugin({})]),

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
                          new rspack.LightningCssMinimizerRspackPlugin({}),
                      ],
                      nodeEnv: 'production',
                      sideEffects: true,
                  }),
        },
    };

    return config;
}
