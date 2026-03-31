/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { type Configuration } from '@rspack/core';

// Core
import cli from '@cli';
import createCommonConfig, { TCompileMode, TCompileOutputTarget, regex } from '../common';
import { toRspackAliases } from '../common/rspackAliases';

// Type
import type { App } from '../../app';

/*const getCorePluginsList = (app: App,) => {

    const corePlugins: string[] = [];

    if (fs.existsSync( app.paths.root + '/node_modules' ))
        for (const moduleName of fs.readdirSync( app.paths.root + '/node_modules' ))
            if (moduleName.startsWith('proteum'))
                corePlugins.push(app.paths.root + '/node_modules/' + moduleName + '/src');

    if (fs.existsSync( cli.paths.core.root + '/node_modules' ))
        for (const moduleName of fs.readdirSync( cli.paths.core.root+ '/node_modules' ))
            if (moduleName.startsWith('proteum'))
                corePlugins.push(cli.paths.core.root + '/node_modules/' + moduleName + '/src');

    return corePlugins;
}*/

const debug = false;
const ssrScriptExtensions = ['.ssr.ts', '.ssr.tsx'];
const serverReactCompatCompilePrefixes = [
    '@floating-ui',
    '@mantine/',
    '@radix-ui/',
    'aria-hidden',
    'react-number-format',
    'react-remove-scroll',
    'react-remove-scroll-bar',
    'react-style-singleton',
    'use-callback-ref',
    'use-sidecar',
];

const getDevGeneratedRuntimeEntries = (app: App) => ({
    __proteum_dev_routes: [app.paths.server.generated + '/routes.ts'],
    __proteum_dev_controllers: [app.paths.server.generated + '/controllers.ts'],
});
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

/*----------------------------------
- CONFIG
----------------------------------*/
export default function createCompiler(
    app: App,
    mode: TCompileMode,
    outputTarget: TCompileOutputTarget = mode === 'dev' ? 'dev' : 'bin',
): Configuration {
    debug && console.info(`Creating compiler for server (${mode}).`);
    const dev = mode === 'dev';
    const outputPath = app.outputPath(outputTarget);
    const frameworkSourceRoot = getFrameworkSourceRoot();
    const frameworkRoots = [frameworkSourceRoot, ...cli.paths.getFrameworkRoots()].filter(
        (rootPath, index, list) => list.indexOf(rootPath) === index,
    );
    const transpileModuleDirectories = app.transpileModuleDirectories;

    const commonConfig = createCommonConfig(app, 'server', mode, outputTarget);
    const { aliases } = app.aliases.server.forWebpack({ modulesPath: cli.paths.framework.appNodeModulesRoot });
    const resolvedAliases = rewriteFrameworkAliasTargets(aliases);

    // We're not supposed in any case to import client services from server
    delete resolvedAliases['@client/services'];
    delete resolvedAliases['@/client/services'];
    const rspackAliases = toRspackAliases(resolvedAliases);
    rspackAliases['proteum'] = frameworkSourceRoot;
    rspackAliases['@/client/router$'] = frameworkSourceRoot + '/client/router.ts';

    debug &&
        console.log(
            `[${mode}] node_modules dirs:`,
            commonConfig.resolveLoader?.modules,
            '\nModule aliases for rspack:',
            rspackAliases,
        );
    const config: Configuration = {
        ...commonConfig,

        name: 'server',
        target: 'node',
        entry: {
            server: [path.join(frameworkSourceRoot, 'server', 'index.ts')],
            ...(dev ? getDevGeneratedRuntimeEntries(app) : {}),
        },

        output: {
            pathinfo: dev,

            libraryTarget: 'commonjs2',

            path: outputPath,
            filename: '[name].js',
            publicPath: '/',
            assetModuleFilename: 'public/[hash][ext]',

            chunkFilename: 'chunks/[name].js',
            // HMR
            hotUpdateMainFilename: 'updates/[fullhash].hot-update.json',
            hotUpdateChunkFilename: 'updates/[id].[fullhash].hot-update.js',
        },

        externalsPresets: { node: true }, // in order to ignore built-in modules like path, fs, etc.
        externals: [
            './client-manifest.json',

            // node_modules
            function ({ request }, callback) {
                const shouldCompile =
                    request !== undefined &&
                    // Local files
                    (request[0] === '.' ||
                        request[0] === '/' ||
                        // Aliased modules
                        app.aliases.server.containsAlias(request) ||
                        // TODO: proteum.conf: compile: include
                        app.isTranspileModuleRequest(request) ||
                        // Compile proteum modules
                        request.startsWith('proteum') ||
                        // React-based UI packages must pass through the alias layer on the server,
                        // otherwise SSR can mix real React packages with the Preact compat runtime.
                        serverReactCompatCompilePrefixes.some((prefix) => request.startsWith(prefix)));

                //console.log('isNodeModule', request, isNodeModule);

                if (!shouldCompile) {
                    // Externalize to a commonjs module using the request path
                    return callback(undefined, 'commonjs ' + request);
                }

                // Continue without externalizing the import
                callback();
            },
        ],

        resolve: {
            ...commonConfig.resolve,

            alias: rspackAliases,

            // Prefer SSR-specific variants on the server when imports stay extensionless.
            extensions: [...ssrScriptExtensions, '.ts', '.tsx', '.json', '.sql', '.js'],
        },

        module: {
            // Make missing exports an error instead of warning
            strictExportPresence: true,

            rules: [
                {
                    test: regex.scripts,
                    include: [
                        app.paths.root + '/client',
                        app.paths.client.generated,

                        app.paths.root + '/common',
                        app.paths.common.generated,

                        // Prisma 7 generates TypeScript entrypoints under var/prisma.
                        app.paths.root + '/var/prisma',

                        app.paths.root + '/commands',

                        // Dossiers server uniquement pour le bundle server
                        app.paths.root + '/server',
                        app.paths.server.generated,
                        ...frameworkRoots.map((rootPath) => rootPath + '/commands'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/client'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/common'),
                        ...frameworkRoots.map((rootPath) => rootPath + '/server'),
                        ...transpileModuleDirectories,

                        // Complle 5HTP modules so they can refer to the framework instance and aliases
                        // Temp disabled because compile issue on vercel
                        //...getCorePluginsList(app)
                    ],
                    rules: require('../common/scripts')({ app, side: 'server', dev }),
                },

                // Les pages étan tà la fois compilées dans le bundle client et serveur
                // On ne compile les ressources (css) qu'une seule fois (coté client)
                { test: regex.style, loader: 'null-loader' },

                ...require('../common/files/images')(app, dev, false),

                ...require('../common/files/autres')(app, dev, false),

                // Exclude dev modules from production build
                /*...(dev ? [] : [
                    {
                        test: app.paths.root + '/node_modules/react-deep-force-update/lib/index.js'),
                        loader: 'null-loader',
                    },
                ]),*/
            ],
        },

        plugins: [...(commonConfig.plugins || [])],

        optimization: { minimizer: [] },

        devtool: dev
            ? 'eval-cheap-module-source-map' // Cheaper than eval-source-map while keeping usable module-level stack traces.
            : 'source-map', // Recommended choice for production builds with high quality SourceMaps.

        // eval-source-map n'est pas précis
        /*devServer: {
            hot: true,
        },*/
    };

    return config;
}
