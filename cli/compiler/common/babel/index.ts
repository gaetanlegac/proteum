/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type webpack from "webpack";
import PresetBabel, { Options } from "@babel/preset-env";
import path from "path";

import cli from "@cli";
import type { TAppSide, App } from "@cli/app";

/*----------------------------------
- REGLES
----------------------------------*/
module.exports = (
  app: App,
  side: TAppSide,
  dev: boolean,
  buildDev: boolean = false,
): webpack.RuleSetRule[] => {
  const useClientPolyfills = side === "client" && (!dev || buildDev);

  const babelPresetEnvConfig: Options =
    side === "client"
      ? {
          // Ajoute automatiquement les polyfills babel
          // https://stackoverflow.com/a/61517521/12199605
          // Skip per-file polyfill analysis in local dev to speed up client compiles.
          useBuiltIns: useClientPolyfills ? "usage" : false, // alternative mode: "entry"
          corejs: useClientPolyfills ? 3 : undefined, // default would be 2

          targets: {
            browsers: dev ? "last 2 versions" : app.packageJson.browserslist,
          },
          forceAllTransforms: !dev, // for UglifyJS
          modules: false,
          debug: false,
          bugfixes: !dev,
        }
      : {
          targets: {
            node: true, //pkg.engines.node.match(/(\d+\.?)+/)[0],
          },
          modules: false,
          useBuiltIns: false,
          debug: false,
        };

  return [
    {
      loader: require.resolve("babel-loader"),
      exclude: (filePath) => {
        // 1) If not in "node_modules" at all => transpile it
        if (!filePath.includes("node_modules")) {
          return false;
        }

        // 2) If it’s "node_modules/proteum" but NOT "node_modules/proteum/node_modules",
        //    then transpile. Otherwise, exclude.
        if (
          filePath.includes("node_modules/proteum") &&
          !filePath.includes("node_modules/proteum/node_modules")
        ) {
          return false;
        }

        // 3) Everything else in node_modules is excluded
        return true;
      },
      options: {
        // https://github.com/babel/babel-loader#options

        // ATTENTION: Ne prend pas toujours compte des màj des plugins babel
        cacheDirectory:
          dev || cli.args.cache === true
            ? path.join(
                app.paths.cache,
                "babel",
                side,
                buildDev ? "build-dev" : dev ? "dev" : "prod",
              )
            : false,
        // Désactive car ralenti compilation
        cacheCompression: false,

        compact: !dev,

        // https://babeljs.io/docs/usage/options/
        babelrc: false,
        presets: [
          // https://github.com/babel/babel-preset-env
          [PresetBabel, babelPresetEnvConfig],

          [
            require("@babel/preset-typescript"),
            {
              useDefineForClassFields: true,
              //jsxPragma: "h"
            },
          ],

          // JSX
          // https://github.com/babel/babel/tree/master/packages/babel-preset-react
          [
            require("@babel/preset-react"),
            {
              //pragma: "h"
              development: dev,
            },
          ],
        ],
        plugins: [
          // NOTE: On résoud les plugins et presets directement ici
          //      Autrement, babel-loader les cherchera dans projet/node_modules

          [require("@babel/plugin-proposal-class-properties"), { loose: true }],

          [require("@babel/plugin-proposal-private-methods"), { loose: true }],

          // Required alongside the loose private field transforms above.
          [
            require("@babel/plugin-proposal-private-property-in-object"),
            { loose: true },
          ],

          ...(dev
            ? []
            : [
                // Treat React JSX elements as value types and hoist them to the highest scope
                // https://github.com/babel/babel/tree/master/packages/babel-plugin-transform-react-constant-elements
                [require("@babel/plugin-transform-react-constant-elements")],

                ...(side === "client"
                  ? [[require("babel-plugin-transform-remove-console")]]
                  : []),
              ]),

          require("./routes/routes")({ side, app, debug: false }),

          // Allow to import multiple fiels with one import statement thanks to glob patterns
          require("babel-plugin-glob-import")(
            {
              debug: false,
              removeAliases: (source: string) =>
                app.paths.withoutAlias(source, side),
            },
            [],
          ),
        ],

        overrides: [...(side === "client" ? [] : [])],
      },
    },
  ];
};
