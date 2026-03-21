// Plugons
import { rspack } from '@rspack/core';

import type { App } from '../../../app';

module.exports = (app: App, dev: boolean, client: boolean) => {
    const enableSourceMaps = dev;
    const useStyleLoader = client && dev;

    return [
        // Apply PostCSS plugins including autoprefixer
        useStyleLoader ? { loader: 'style-loader' } : { loader: rspack.CssExtractRspackPlugin.loader },

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
