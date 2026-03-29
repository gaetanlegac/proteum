import path from 'path';

// Plugons
import { rspack } from '@rspack/core';
import type { Root } from 'postcss';

import type { App } from '../../../app';

const normalizePath = (value: string) => path.resolve(value).replace(/\\/g, '/');

const isPathInsideDirectory = (filepath: string, directory: string) =>
    filepath === directory || filepath.startsWith(directory + '/');

const createTailwindTranspileSourcesPlugin = (app: App) => {
    const appRoot = normalizePath(app.paths.root);
    const transpileSourceDirectories = Array.from(
        new Set(app.transpileModuleDirectories.map((directory) => normalizePath(directory))),
    );

    if (transpileSourceDirectories.length === 0) return null;

    return {
        postcssPlugin: 'proteum-tailwind-transpile-sources',
        Once(root: Root) {
            const sourceFile = root.source?.input?.file ? normalizePath(root.source.input.file) : '';
            if (!sourceFile || !isPathInsideDirectory(sourceFile, appRoot)) return;

            const sourceDirectory = path.dirname(sourceFile);
            const existingSourceParams = new Set<string>();

            root.walkAtRules('source', (rule) => {
                existingSourceParams.add(String(rule.params).trim());
            });

            for (const transpileDirectory of [...transpileSourceDirectories].reverse()) {
                const relativeSourceDirectory = path.relative(sourceDirectory, transpileDirectory).split(path.sep).join('/');
                const sourceParam = JSON.stringify(
                    relativeSourceDirectory.startsWith('.') ? relativeSourceDirectory : `./${relativeSourceDirectory}`,
                );

                if (existingSourceParams.has(sourceParam)) continue;

                root.prepend({
                    name: 'source',
                    params: sourceParam,
                    type: 'atrule',
                });
            }
        },
    };
};

module.exports = (app: App, dev: boolean, _client: boolean) => {
    const enableSourceMaps = dev;
    const tailwindTranspileSourcesPlugin = createTailwindTranspileSourcesPlugin(app);

    return [
        // Keep CSS delivery identical in dev and prod: extract files so SSR links stylesheets in both modes.
        { loader: rspack.CssExtractRspackPlugin.loader },

        // Process external/third-party styles
        { exclude: [app.paths.root], loader: 'css-loader', options: { sourceMap: enableSourceMaps } },

        // Process internal/project styles (from root folder)
        {
            include: [app.paths.root],
            loader: 'css-loader',
            options: {
                importLoaders: 1, // let postcss run on @imports
                sourceMap: enableSourceMaps,
            },
        },

        // Postcss
        {
            loader: 'postcss-loader',
            options: {
                postcssOptions: {
                    plugins: [
                        // Tailwind v4 only scans files that it knows about. When app code imports
                        // transpiled local packages, register those package roots explicitly so
                        // shared utility classes survive app splits and workspace extraction.
                        ...(tailwindTranspileSourcesPlugin ? [tailwindTranspileSourcesPlugin] : []),
                        /* Tailwind V4 */ require('@tailwindcss/postcss')({
                            // Ensure Tailwind scans the application sources even if the build
                            // process is launched from another working directory (e.g. Docker).
                            base: app.paths.root,

                            // Avoid double-minifying: Webpack already runs CssMinimizerPlugin in prod.
                            optimize: false,
                        }),
                        ///* Tailwind V3 */require('tailwindcss'),
                        require('autoprefixer'),
                    ],
                },
            },
        },

        {
            test: /\.less$/,
            loader: 'less-loader',
            options: {
                lessOptions: {
                    // RAPPEL: Rallonge considéralement le temps de compilation
                    // Pour math.random
                    //javascriptEnabled: true

                    // Défault = parens-division depuis 4.0.0
                    // https://lesscss.org/usage/#less-options-math
                    math: 'always',
                },
            },
        },

        /*{
            test: /\.scss/,
            loader: process.env.framework + '/node_modules/sass-loader',
        }*/
    ];
};
