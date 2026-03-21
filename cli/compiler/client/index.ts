/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import webpack from "webpack";
import fs from "fs-extra";
import path from "path";

// Plugins
const TerserPlugin = require("terser-webpack-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import WebpackAssetsManifest from "webpack-assets-manifest";

// Core
import createCommonConfig, {
  TCompileMode,
  TCompileOutputTarget,
  regex,
} from "../common";
import { createClientBundleAnalysisPlugins } from "../common/bundleAnalysis";
import {
  getClientRuntimeTarget,
  isLegacyClientRuntimeTarget,
} from "../common/clientRuntimeTarget";
import identityAssets from "./identite";
import cli from "../..";

// Type
import type { App } from "../../app";

const debug = false;
const ssrScriptPattern = /\.ssr\.(ts|tsx)$/;
const normalizedCoreRoot = cli.paths.core.root.replace(/\\/g, "/");

const normalizeModulePath = (value?: string) => (value || "").replace(/\\/g, "/");

const getModulePath = (module: webpack.Module) => {
  const resource =
    typeof module.nameForCondition === "function"
      ? module.nameForCondition()
      : undefined;
  const fallbackModule = module as webpack.Module & {
    resource?: string;
    context?: string;
  };

  return normalizeModulePath(
    resource || fallbackModule.resource || fallbackModule.context,
  );
};

const isExternalVendorModule = (module: webpack.Module) => {
  const modulePath = getModulePath(module);

  return (
    modulePath.includes("/node_modules/") &&
    !modulePath.includes("/node_modules/proteum/")
  );
};

const isCoreSourceModule = (module: webpack.Module) => {
  const modulePath = getModulePath(module);

  return (
    modulePath.startsWith(normalizedCoreRoot + "/") ||
    modulePath.includes("/node_modules/proteum/")
  );
};

/*----------------------------------
- CONFIG
----------------------------------*/
export default function createCompiler(
  app: App,
  mode: TCompileMode,
  outputTarget: TCompileOutputTarget = mode === "dev" ? "dev" : "bin",
): webpack.Configuration {
  const clientRuntimeTarget = getClientRuntimeTarget(app);
  const legacyClientRuntime = clientRuntimeTarget === "legacy";

  console.info(
    `Creating compiler for client (${mode}, target=${clientRuntimeTarget}).`,
  );
  const dev = mode === "dev";
  const outputPath = app.outputPath(outputTarget);

  const commonConfig = createCommonConfig(app, "client", mode, outputTarget);

  identityAssets(app, path.join(outputPath, "public", "app"));

  // Symlinks to public
  /*const publicDirs = fs.readdirSync(app.paths.root + '/public');
    for (const publicDir of publicDirs)
        fs.symlinkSync( 
            app.paths.root + '/public/' + publicDir,  
            app.paths.public + '/' + publicDir
        );*/

  // Convert tsconfig cli.paths to webpack aliases
  const { aliases } = app.aliases.client.forWebpack({
    modulesPath: app.paths.root + "/node_modules",
  });

  // We're not supposed in any case to import server libs from client
  delete aliases["@server"];
  delete aliases["@/server"];

  debug && console.log("client aliases", aliases);
  const config: webpack.Configuration = {
    ...commonConfig,

    name: "client",
    target: "web",
    entry: {
      client: [
        /*...(dev ? [
                    process.env.framework + '/cli/compilation/webpack/libs/webpackHotDevClient.js',
                    // https://github.com/webpack-contrib/webpack-hot-middleware#config
                    cli.paths.core.root + '/node_modules' + '/webpack-hot-middleware/client?name=client&reload=true',
                ] : []),*/
        cli.paths.core.root + "/client/index.ts",
      ],
    },

    output: {
      pathinfo: dev,
      path: outputPath + "/public",
      filename: "[name].js", // Output client.js
      assetModuleFilename: "[hash][ext]",
      environment: legacyClientRuntime
        ? {}
        : {
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

      chunkFilename: dev ? "[name].js" : "[id].[hash:8].js",
    },

    resolve: {
      ...commonConfig.resolve,

      alias: aliases,

      extensions: [".mjs", ".ts", ".tsx", ".jsx", ".js", ".json", ".sql"],
    },

    module: {
      // Make missing exports an error instead of warning
      strictExportPresence: true,

      rules: [
        {
          test: ssrScriptPattern,
          include: [
            app.paths.root + "/client",
            cli.paths.core.root + "/client",

            app.paths.root + "/common",
            cli.paths.core.root + "/common",

            app.paths.root + "/server",
            cli.paths.core.root + "/server",
          ],
          loader: path.join(
            cli.paths.core.root,
            "cli",
            "compiler",
            "common",
            "loaders",
            "forbid-ssr-import.js",
          ),
        },
        {
          test: regex.scripts,
          include: [
            app.paths.root + "/client",
            cli.paths.core.root + "/client",

            app.paths.root + "/common",
            cli.paths.core.root + "/common",

            app.paths.root + "/server/.generated/models.ts",
          ],
          rules: require("../common/babel")(app, "client", dev),
        },

        // Les pages étan tà la fois compilées dans le bundle client et serveur
        // On ne compile les ressources (css) qu'une seule fois
        {
          test: regex.style,
          rules: require("../common/files/style")(app, dev, true),

          // Don't consider CSS imports dead code even if the
          // containing package claims to have no side effects.
          // Remove this when webpack adds a warning or an error for this.
          // See https://github.com/webpack/webpack/issues/6571
          sideEffects: true,
        },

        ...require("../common/files/images")(app, dev, true),

        ...require("../common/files/autres")(app, dev, true),

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

      ...(dev ? [] : [new MiniCssExtractPlugin({})]),

      // Emit runtime asset manifests for the server renderer.
      new WebpackAssetsManifest({
        output: outputPath + `/asset-manifest.json`,
        publicPath: true,
        writeToDisk: true, // Force la copie du fichier sur e disque, au lieu d'en mémoire en mode dev
        customize: ({ key, value }) => {
          // You can prevent adding items to the manifest by returning false.
          if (key.toLowerCase().endsWith(".map")) return false;
          return { key, value };
        },
        done: (manifest, stats) => {
          const chunkFileName = outputPath + `/chunk-manifest.json`;
          try {
            const fileFilter = (file) => !file.endsWith(".map");
            const addPath = (file) => manifest.getPublicPath(file);
            const chunkFiles = stats.compilation.chunkGroups.reduce(
              (acc, c) => {
                acc[c.name] = [
                  ...(acc[c.name] || []),
                  ...c.chunks.reduce(
                    (files, cc) => [
                      ...files,
                      ...[...cc.files].filter(fileFilter).map(addPath),
                    ],
                    [],
                  ),
                ];
                return acc;
              },
              Object.create(null),
            );
            fs.writeFileSync(
              chunkFileName,
              JSON.stringify(chunkFiles, null, 4),
            );
          } catch (err) {
            console.error(`ERROR: Cannot write ${chunkFileName}: `, err);
            if (!dev) process.exit(1);
          }
        },
      }),

      ...createClientBundleAnalysisPlugins(app, outputTarget),

    ],

    // Use the cheapest practical client source maps in dev for faster rebuilds.
    // https://webpack.js.org/configuration/devtool/#devtool
    devtool: dev ? "eval-cheap-module-source-map" : "source-map",
    /*devServer: {
            hot: true,
        },*/

    optimization: {
      // Code splitting serveur = même que client
      // La décomposition des chunks doit toujours être la même car le rendu des pages dépend de cette organisation

      // https://webpack.js.org/plugins/split-chunks-plugin/#configuration
      runtimeChunk: {
        name: "runtime",
      },
      splitChunks: {
        // Keep the initial shell lean while still preserving async route isolation.
        chunks: "all",
        minSize: 20_000,
        minRemainingSize: 0,
        maxInitialRequests: 30,
        maxAsyncRequests: 30,
        cacheGroups: {
          framework: {
            test: isCoreSourceModule,
            chunks: "initial",
            name: "framework",
            priority: 40,
            reuseExistingChunk: true,
            enforce: true,
          },
          initialVendors: {
            test: isExternalVendorModule,
            chunks: "initial",
            name: "vendors",
            priority: 30,
            reuseExistingChunk: true,
            enforce: true,
          },
          asyncVendors: {
            test: isExternalVendorModule,
            chunks: "async",
            priority: 20,
            reuseExistingChunk: true,
          },
          default: {
            minChunks: 2,
            priority: 10,
            reuseExistingChunk: true,
          },
          defaultVendors: false,
        },
      },

      // Production
      ...(dev
        ? {}
        : {
            // https://github.com/react-boilerplate/react-boilerplate/blob/master/internals/webpack/webpack.prod.babel.js
            minimize: true,
            removeAvailableModules: true,
            minimizer: [
              new TerserPlugin({
                terserOptions: isLegacyClientRuntimeTarget(app)
                  ? {
                      parse: {
                        // We want terser to parse ecma 8 code. However, we don't want it
                        // to apply any minification steps that turns valid ecma 5 code
                        // into invalid ecma 5 code. This is why the 'compress' and 'output'
                        // sections only apply transformations that are ecma 5 safe
                        // https://github.com/facebook/create-react-app/pull/4234
                        ecma: 8,
                      },
                      compress: {
                        ecma: 5,
                        warnings: false,
                        comparisons: false,
                        inline: 2,
                      },
                      mangle: {
                        safari10: true,
                      },
                      output: {
                        ecma: 5,
                        comments: false,
                        ascii_only: true,
                      },
                    }
                  : {
                      parse: {
                        ecma: 2020,
                      },
                      compress: {
                        ecma: 2020,
                        warnings: false,
                        comparisons: false,
                        inline: 2,
                      },
                      mangle: true,
                      output: {
                        ecma: 2020,
                        comments: false,
                        ascii_only: true,
                      },
                    },
              }),

              ...(dev ? [] : [new CssMinimizerPlugin()]),
            ],
            nodeEnv: "production",
            sideEffects: true,
          }),
    },
  };

  return config;
}
