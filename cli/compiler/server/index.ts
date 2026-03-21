/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import { type Configuration } from "@rspack/core";

// Core
import cli from "@cli";
import createCommonConfig, {
  TCompileMode,
  TCompileOutputTarget,
  regex,
} from "../common";
import { toRspackAliases } from "../common/rspackAliases";

// Type
import type { App } from "../../app";

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
const ssrScriptExtensions = [".ssr.ts", ".ssr.tsx"];

/*----------------------------------
- CONFIG
----------------------------------*/
export default function createCompiler(
  app: App,
  mode: TCompileMode,
  outputTarget: TCompileOutputTarget = mode === "dev" ? "dev" : "bin",
): Configuration {
  debug && console.info(`Creating compiler for server (${mode}).`);
  const dev = mode === "dev";
  const outputPath = app.outputPath(outputTarget);

  const commonConfig = createCommonConfig(app, "server", mode, outputTarget);
  const { aliases } = app.aliases.server.forWebpack({
    modulesPath: app.paths.root + "/node_modules",
  });

  // We're not supposed in any case to import client services from server
  delete aliases["@client/services"];
  delete aliases["@/client/services"];
  const rspackAliases = toRspackAliases(aliases);
  rspackAliases["@/client/router$"] = cli.paths.core.root + "/client/router.ts";

  debug &&
    console.log(
      `[${mode}] node_modules dirs:`,
      commonConfig.resolveLoader?.modules,
      "\nModule aliases for rspack:",
      rspackAliases,
    );
  const config: Configuration = {
    ...commonConfig,

    name: "server",
    target: "node",
    entry: {
      server: [cli.paths.coreRoot + "/server/index.ts"],
    },

    output: {
      pathinfo: dev,

      libraryTarget: "commonjs2",

      path: outputPath,
      filename: "[name].js",
      publicPath: "/",
      assetModuleFilename: "public/[hash][ext]",

      chunkFilename: "chunks/[name].js",
      // HMR
      hotUpdateMainFilename: "updates/[fullhash].hot-update.json",
      hotUpdateChunkFilename: "updates/[id].[fullhash].hot-update.js",
    },

    externalsPresets: { node: true }, // in order to ignore built-in modules like path, fs, etc.
    externals: [
      "./client-manifest.json",

      // node_modules
      function ({ request }, callback) {
        const shouldCompile =
          request !== undefined &&
          // Local files
          (request[0] === "." ||
            request[0] === "/" ||
            // Aliased modules
            app.aliases.server.containsAlias(request) ||
            // TODO: proteum.conf: compile: include
            // Compile proteum modules
            request.startsWith("proteum") ||
            // Compile 5HTP modules
            request.startsWith("@mantine/") ||
            request.startsWith("react-number-format") ||
            request.startsWith("@floating-ui"));

        //console.log('isNodeModule', request, isNodeModule);

        if (!shouldCompile) {
          // Externalize to a commonjs module using the request path
          return callback(undefined, "commonjs " + request);
        }

        // Continue without externalizing the import
        callback();
      },
    ],

    resolve: {
      ...commonConfig.resolve,

      alias: rspackAliases,

      // Prefer SSR-specific variants on the server when imports stay extensionless.
      extensions: [
        ...ssrScriptExtensions,
        ".ts",
        ".tsx",
        ".json",
        ".sql",
        ".js",
      ],
    },

    module: {
      // Make missing exports an error instead of warning
      strictExportPresence: true,

      rules: [
        {
          test: regex.scripts,
          include: [
            app.paths.root + "/client",
            cli.paths.core.root + "/client",

            app.paths.root + "/common",
            cli.paths.core.root + "/common",

            // Dossiers server uniquement pour le bundle server
            app.paths.root + "/server",
            cli.paths.core.root + "/server",

            // Complle 5HTP modules so they can refer to the framework instance and aliases
            // Temp disabled because compile issue on vercel
            //...getCorePluginsList(app)
          ],
          rules: require("../common/scripts")({ app, side: "server", dev }),
        },

        // Les pages étan tà la fois compilées dans le bundle client et serveur
        // On ne compile les ressources (css) qu'une seule fois (coté client)
        {
          test: regex.style,
          loader: "null-loader",
        },

        ...require("../common/files/images")(app, dev, false),

        ...require("../common/files/autres")(app, dev, false),

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

    optimization: {
      minimizer: [],
    },

    devtool: dev
      ? "eval-cheap-module-source-map" // Cheaper than eval-source-map while keeping usable module-level stack traces.
      : "source-map", // Recommended choice for production builds with high quality SourceMaps.

    // eval-source-map n'est pas précis
    /*devServer: {
            hot: true,
        },*/
  };

  return config;
}
