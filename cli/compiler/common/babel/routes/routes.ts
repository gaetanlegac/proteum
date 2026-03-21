/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import * as types from "@babel/types";
import type { PluginObj, NodePath } from "@babel/core";

// Core
import cli from "@cli";
import { App, TAppSide } from "../../../../app";

/*----------------------------------
- WEBPACK RULE
----------------------------------*/

type TOptions = {
  side: TAppSide;
  app: App;
  debug?: boolean;
};

type TRouteDefinition = {
  definition: types.CallExpression;
};

type TFileInfos = {
  path: string;
  process: boolean;
  side: "front" | "back";
  importedServices: { [local: string]: string };
  routeDefinitions: TRouteDefinition[];
};

const routerMethods = ["get", "post", "put", "delete", "patch"];

module.exports = (options: TOptions) => [Plugin, options];

/*----------------------------------
- PLUGIN
----------------------------------*/

function Plugin(babel, { app, debug }: TOptions) {
  const t = babel.types as typeof types;

  type TPluginState = {
    filename: string;
    file: TFileInfos;
  };

  const plugin: PluginObj<TPluginState> = {
    pre(state) {
      this.filename = state.opts.filename as string;
      this.file = getFileInfos(this.filename);
    },
    visitor: {
      ImportDeclaration(path) {
        if (!this.file.process) return;

        const source = path.node.source.value;
        const isClientRouterImport =
          this.file.side === "front" &&
          (source === "@client/router" || source === "@/client/router");

        if (source !== "@app" && !isClientRouterImport) return;

        for (const specifier of path.node.specifiers) {
          if (
            specifier.type === "ImportDefaultSpecifier" &&
            isClientRouterImport
          ) {
            this.file.importedServices[specifier.local.name] = "Router";
            continue;
          }

          if (
            specifier.type !== "ImportSpecifier" ||
            specifier.imported.type !== "Identifier"
          )
            continue;

          this.file.importedServices[specifier.local.name] =
            specifier.imported.name;
        }

        path.remove();
      },

      CallExpression(path) {
        if (!this.file.process) return;

        const callee = path.node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.property.type !== "Identifier"
        )
          return;

        const serviceName = callee.object.name;
        if (!(serviceName in this.file.importedServices)) return;

        if (!["page", "error", ...routerMethods].includes(callee.property.name))
          return;

        if (
          path.parent.type !== "ExpressionStatement" ||
          path.parentPath.parent.type !== "Program"
        )
          return;

        this.file.routeDefinitions.push({
          definition: path.node,
        });

        path.replaceWithMultiple([]);
      },

      Program: {
        exit(path) {
          if (!this.file.process) return;

          const wrappedRouteDefs = wrapRouteDefs(this.file);
          if (wrappedRouteDefs) path.pushContainer("body", [wrappedRouteDefs]);
        },
      },
    },
  };

  function getFileInfos(filename: string): TFileInfos {
    const file: TFileInfos = {
      process: true,
      side: "back",
      path: filename,
      importedServices: {},
      routeDefinitions: [],
    };

    let relativeFileName: string | undefined;
    if (filename.startsWith(cli.paths.appRoot))
      relativeFileName = filename.substring(cli.paths.appRoot.length);
    if (filename.startsWith(cli.paths.coreRoot))
      relativeFileName = filename.substring(cli.paths.coreRoot.length);

    if (relativeFileName === undefined) {
      file.process = false;
      return file;
    }

    if (relativeFileName.startsWith("/client/pages")) {
      file.side = "front";
    } else if (relativeFileName.startsWith("/server/routes")) {
      file.side = "back";
    } else {
      file.process = false;
    }

    return file;
  }

  function enrichRouteOptions(
    routeArgs: types.CallExpression["arguments"],
    filename: string,
  ): types.CallExpression["arguments"] | "ALREADY_PROCESSED" {
    let routeOptions: types.ObjectExpression | undefined;
    let setup: types.Expression | undefined;
    let renderer: types.Expression;

    if (routeArgs.length === 1) [renderer] = routeArgs;
    else if (routeArgs.length === 2) {
      if (routeArgs[0].type === "ObjectExpression")
        [routeOptions, renderer] = routeArgs as [
          types.ObjectExpression,
          types.Expression,
        ];
      else
        [setup, renderer] = routeArgs as [types.Expression, types.Expression];
    } else
      [routeOptions, setup, renderer] = routeArgs as [
        types.ObjectExpression,
        types.Expression,
        types.Expression,
      ];

    const { filepath, chunkId } = cli.paths.getPageChunk(app, filename);
    debug &&
      console.log(
        `[routes]`,
        filename.replace(cli.paths.appRoot + "/client/pages", ""),
      );

    const newProperties = [
      t.objectProperty(t.identifier("id"), t.stringLiteral(chunkId)),
      t.objectProperty(t.identifier("filepath"), t.stringLiteral(filepath)),
    ];

    if (!routeOptions?.properties) {
      return setup
        ? [t.objectExpression(newProperties), setup, renderer]
        : [t.objectExpression(newProperties), renderer];
    }

    const wasAlreadyProcessed = routeOptions.properties.some(
      (property) =>
        property.type === "ObjectProperty" &&
        property.key.type === "Identifier" &&
        property.key.name === "id",
    );

    if (wasAlreadyProcessed) {
      debug && console.log(`[routes]`, filename, "Already Processed");
      return "ALREADY_PROCESSED";
    }

    return setup
      ? [
          t.objectExpression([...routeOptions.properties, ...newProperties]),
          setup,
          renderer,
        ]
      : [
          t.objectExpression([...routeOptions.properties, ...newProperties]),
          renderer,
        ];
  }

  function addUniqueObjectPatternProperty(
    properties: types.ObjectProperty[],
    importedName: string,
    localName: string = importedName,
  ) {
    const hasProperty = properties.some(
      (property) =>
        property.key.type === "Identifier" &&
        property.key.name === importedName &&
        property.value.type === "Identifier" &&
        property.value.name === localName,
    );

    if (hasProperty) return;

    properties.push(
      t.objectProperty(
        t.identifier(importedName),
        t.identifier(localName),
        false,
        importedName === localName,
      ),
    );
  }

  function wrapRouteDefs(file: TFileInfos) {
    if (file.routeDefinitions.length === 0) return;

    const definitions: types.BlockStatement["body"] = [];

    if (file.side === "front") {
      if (file.routeDefinitions.length > 1) {
        throw new Error(`Frontend route definition files (/client/pages/**/**.ts) can contain only one route definition.
                    ${file.routeDefinitions.length} were given in ${file.path}.`);
      }

      const routeDef = file.routeDefinitions[0];
      const callee = routeDef.definition.callee as types.MemberExpression;
      const [routePath, ...routeArgs] = routeDef.definition.arguments;

      let nextRouteArgs = routeArgs;
      if (
        callee.property.type === "Identifier" &&
        ["page", "error"].includes(callee.property.name)
      ) {
        const enrichedRouteArgs = enrichRouteOptions(routeArgs, file.path);
        if (enrichedRouteArgs === "ALREADY_PROCESSED") return;

        nextRouteArgs = enrichedRouteArgs;
      }

      definitions.push(
        t.returnStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier((callee.object as types.Identifier).name),
              callee.property,
            ),
            [routePath, ...nextRouteArgs],
          ),
        ),
      );
    } else {
      definitions.push(
        ...file.routeDefinitions.map((definition) =>
          t.expressionStatement(definition.definition),
        ),
      );
    }

    const destructuredServices: types.ObjectProperty[] = [];
    for (const [localName, importedName] of Object.entries(
      file.importedServices,
    ))
      addUniqueObjectPatternProperty(
        destructuredServices,
        importedName,
        localName,
      );

    return t.exportNamedDeclaration(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.identifier("__register"),
          t.arrowFunctionExpression(
            [t.identifier("app")],
            t.blockStatement([
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  t.objectPattern(destructuredServices),
                  t.identifier("app"),
                ),
              ]),
              ...definitions,
            ]),
          ),
        ),
      ]),
    );
  }

  return plugin;
}
