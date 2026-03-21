/*----------------------------------
- DEPENDANCES
----------------------------------*/

// npm
import dayjs from "dayjs";
import path from "path";
import { rspack, type Configuration } from "@rspack/core";

// Core
import cli from "../..";

// Type
import type { App } from "../../app";
import type { TAppSide } from "../../app";

/*----------------------------------
- CONSTANTS
----------------------------------*/

export const regex = {
  scripts: /\.(ts|tsx|js|jsx)$/,
  style: /\.(css|less|scss)$/,
  images: /\.(bmp|gif|jpg|jpeg|png|ico|svg)$/, // SVG gérés par SVGR
  fonts: /\.(woff(2)?|ttf|eot)(\?v=\d+\.\d+\.\d+)?$/,
  staticAssetName: /*isDebug ? '[name].[ext].[hash:8]' :*/ "[hash:8][ext]",
};

/*----------------------------------
- TYPES
----------------------------------*/

export type TCompileMode = "dev" | "prod";
export type TCompileOutputTarget = "dev" | "bin";

/*----------------------------------
- BASE CONFIG
----------------------------------*/

export default function createCommonConfig(
  app: App,
  side: TAppSide,
  mode: TCompileMode,
  outputTarget: TCompileOutputTarget = mode === "dev" ? "dev" : "bin",
): Configuration {
  const dev = mode === "dev";
  const enableFilesystemCache = dev
    ? cli.args.cache !== false
    : cli.args.cache === true;
  const config: Configuration = {
    // Project root
    context: app.paths.root,

    mode: dev ? "development" : "production",

    resolveLoader: {
      // Support both install modes:
      // - npm i: loaders are often hoisted in app/node_modules
      // - npm link: loaders often live in framework/node_modules
      modules: [
        app.paths.root + "/node_modules",
        cli.paths.core.root + "/node_modules",
        cli.paths.core.cli + "/node_modules",
      ],
      mainFields: ["loader", "main"],
    },

    plugins: [
      new rspack.DefinePlugin({
        // Flags
        __DEV__: dev,
        SERVER: side === "server",

        // Core
        CORE_VERSION: JSON.stringify(cli.packageJson.version),
        CORE_PATH: JSON.stringify(cli.paths.core.root),

        // Application
        BUILD_DATE: JSON.stringify(dayjs().format("YY.MM.DD-HH.mm")),
        BUILD_ID: JSON.stringify(app.buildId),
        APP_PATH: JSON.stringify(app.paths.root),
        APP_NAME: JSON.stringify(app.identity.web.title),
        APP_OUTPUT_DIR: JSON.stringify(
          path.basename(app.outputPath(outputTarget)),
        ),
        PROTEUM_ROUTER_PORT_OVERRIDE: JSON.stringify(
          app.routerPortOverride ?? null,
        ),
      }),

      ...(dev ? [] : []),
    ],

    resolve: {
      // Empêche le remplatcement des chemins vers les liens symboliques par leur vrai chemin
      // Permet de conserver le chemin des packages enregistrés via npm link
      // Equivalent tsconfig: preserveSymlinks: true
      symlinks: false,

      /*modules: [
                cli.paths.core.root + '/node_modules',
                app.paths.root + '/node_modules',
            ]*/
    },

    // Turn off performance processing because we utilize
    // our own hints via the FileSizeReporter
    performance: false,

    // Smoke builds should fail immediately on the first compilation error.
    bail: !dev,

    // Persistent cache speeds up repeated local dev and prod build invocations.
    cache: enableFilesystemCache
      ? {
          type: "filesystem",
          cacheDirectory: path.join(
            app.paths.cache,
            "rspack",
            side,
            mode,
          ),
          compression: false,
          buildDependencies: {
            config: [__filename],
          },
        }
      : false,

    // Increase compilation performance
    profile: false,

    // Keep output compact while preserving timing and error context.
    stats: {
      colors: true,
      errors: true,
      errorDetails: true,
      timings: true,
      warnings: true,
    },
  };

  return config;
}
