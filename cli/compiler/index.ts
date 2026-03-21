/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from "path";
import fs from "fs-extra";
import serialize from "serialize-javascript";
import { rspack, type Compiler as RspackCompiler } from "@rspack/core";
import ts from "typescript";

// Core
import app from "../app";
import cli from "..";
import createServerConfig from "./server";
import createClientConfig from "./client";
import { TCompileMode, TCompileOutputTarget } from "./common";
import {
  indexControllers,
  generateControllerClientTree,
  printControllerTree,
} from "./common/controllers";
import { writeClientManifest } from "./common/clientManifest";
import {
  getGeneratedRouteModuleFilepath,
  writeGeneratedRouteModule,
} from "./common/generatedRouteModules";
import writeIfChanged from "./writeIfChanged";

type TCompilerCallback = (compiler: RspackCompiler) => void;

type TServiceMetas = {
  id: string;
  name: string;
  parent: string;
  dependences: string;
  importationPath: string;
  priority: number;
};

type TRegisteredService = {
  id?: string;
  name: string;
  className: string;
  instanciation: (parentRef?: string) => string;
  priority: number;
};

type TClientRouteLoader = {
  filepath: string;
  chunkId: string;
  preload: boolean;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/");

/*----------------------------------
- FONCTION
----------------------------------*/
export default class Compiler {
  public compiling: { [compiler: string]: Promise<void> } = {};
  private recentCompilationResults: { [compiler: string]: boolean } = {};
  private refreshingGeneratedArtifacts?: Promise<void>;

  public constructor(
    private mode: TCompileMode,
    private callbacks: {
      before?: TCompilerCallback;
      after?: TCompilerCallback;
    } = {},
    private debug: boolean = false,
    private outputTarget: TCompileOutputTarget = mode === "dev" ? "dev" : "bin",
  ) {}

  public cleanup() {
    const outputPath = app.outputPath(this.outputTarget);
    const generatedPublicEntries = new Set(["app"]);
    const outputPublicPath = path.join(outputPath, "public");
    const preserveDevOutput =
      this.mode === "dev" && this.outputTarget === "dev";

    if (!preserveDevOutput) fs.emptyDirSync(outputPath);

    fs.ensureDirSync(outputPublicPath);
    this.syncPublicEntries(
      outputPublicPath,
      generatedPublicEntries,
      this.mode === "dev",
    );
  }
  /* FIX issue with npm link
        When we install a module with npm link, this module's deps are not installed in the parent project scope
        Which causes some issues:
        - The module's deps are not found by Typescript
        - Including React, so VSCode shows that JSX is missing
    */
  public fixNpmLinkIssues() {
    const corePath = path.join(app.paths.root, "/node_modules/proteum");
    if (!fs.lstatSync(corePath).isSymbolicLink())
      return console.info(
        "Not fixing npm issue because proteum wasn't installed with npm link.",
      );

    this.debug && console.info(`Fix NPM link issues ...`);
    const outputPath = app.outputPath(this.outputTarget);

    const appModules = path.join(app.paths.root, "node_modules");
    const coreModules = path.join(corePath, "node_modules");

    // When the 5htp package is installed from npm link,
    // Modules are installed locally and not glbally as with with the 5htp package from NPM.
    // So we need to symbilnk the http-core node_modules in one of the parents of server.js.
    // It avoids errors like: "Error: Cannot find module 'intl'"
    this.ensureSymlinkSync(coreModules, path.join(outputPath, "node_modules"));

    // Same problem: when 5htp-core is installed via npm link,
    // Typescript doesn't detect React and shows mission JSX errors
    const preactCoreModule = path.join(coreModules, "preact");
    const preactAppModule = path.join(appModules, "preact");
    const reactAppModule = path.join(appModules, "react");

    if (!fs.existsSync(preactAppModule))
      fs.symlinkSync(preactCoreModule, preactAppModule);
    if (!fs.existsSync(reactAppModule))
      fs.symlinkSync(path.join(preactCoreModule, "compat"), reactAppModule);
  }

  private syncPublicEntries(
    outputPublicPath: string,
    generatedPublicEntries: Set<string>,
    useSymlinks: boolean,
  ) {
    const publicFiles = new Set(
      fs
        .readdirSync(app.paths.public)
        .filter((publicFile) => !generatedPublicEntries.has(publicFile)),
    );

    for (const existingPublicFile of fs.readdirSync(outputPublicPath)) {
      if (
        generatedPublicEntries.has(existingPublicFile) ||
        publicFiles.has(existingPublicFile)
      )
        continue;

      fs.removeSync(path.join(outputPublicPath, existingPublicFile));
    }

    for (const publicFile of publicFiles) {
      const sourcePath = path.join(app.paths.public, publicFile);
      const outputFilePath = path.join(outputPublicPath, publicFile);

      if (useSymlinks) {
        this.ensureSymlinkSync(sourcePath, outputFilePath);
        continue;
      }

      if (fs.existsSync(outputFilePath)) fs.removeSync(outputFilePath);

      fs.copySync(sourcePath, outputFilePath);
    }
  }

  private ensureSymlinkSync(targetPath: string, linkPath: string) {
    fs.ensureDirSync(path.dirname(linkPath));

    try {
      const linkStats = fs.lstatSync(linkPath);

      if (linkStats.isSymbolicLink()) {
        const currentTarget = path.resolve(
          path.dirname(linkPath),
          fs.readlinkSync(linkPath),
        );
        if (currentTarget === path.resolve(targetPath)) return;
      }

      fs.removeSync(linkPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    fs.symlinkSync(targetPath, linkPath);
  }

  private findServices(dir: string) {
    const blacklist = ["node_modules", "proteum"];
    const files: string[] = [];
    const dirents = fs.readdirSync(dir, { withFileTypes: true });

    for (let dirent of dirents) {
      let fileName = dirent.name;
      let filePath = path.resolve(dir, fileName);

      if (blacklist.includes(fileName)) continue;

      // Define is we should recursively find service in the current item
      let iterate: boolean = false;
      if (dirent.isSymbolicLink()) {
        const realPath = path.resolve(dir, fs.readlinkSync(filePath));
        const destinationInfos = fs.lstatSync(realPath);
        if (destinationInfos.isDirectory()) iterate = true;
      } else if (dirent.isDirectory()) iterate = true;

      // Update the list of found services
      if (iterate) {
        files.push(...this.findServices(filePath));
      } else if (dirent.name === "service.json") {
        files.push(path.dirname(filePath));
      }
    }
    return files;
  }

  private findClientRouteFiles(dir: string): string[] {
    return this.findRegisteredRouteFiles(dir, {
      excludeLayoutDirectories: true,
    });
  }

  private findServerRouteFiles(dir: string): string[] {
    return this.findRegisteredRouteFiles(dir);
  }

  private findRegisteredRouteFiles(
    dir: string,
    options: {
      excludeLayoutDirectories?: boolean;
    } = {},
  ): string[] {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, dirent.name);

      if (dirent.isDirectory()) {
        if (options.excludeLayoutDirectories && dirent.name === "_layout")
          continue;

        files.push(...this.findRegisteredRouteFiles(filePath, options));
        continue;
      }

      if (!dirent.isFile()) continue;

      if (!/\.(ts|tsx)$/.test(dirent.name)) continue;

      const content = fs.readFileSync(filePath, "utf8");
      if (!this.hasRegisteredRouteDefinitions(filePath, content)) continue;

      files.push(filePath);
    }

    return files;
  }

  private hasRegisteredRouteDefinitions(filepath: string, content: string) {
    const sourceFile = ts.createSourceFile(
      filepath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filepath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    return sourceFile.statements.some((statement) => {
      if (!ts.isExpressionStatement(statement)) return false;
      if (!ts.isCallExpression(statement.expression)) return false;
      if (!ts.isPropertyAccessExpression(statement.expression.expression))
        return false;

      const callee = statement.expression.expression;

      return (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Router" &&
        ["page", "error", "get", "post", "put", "delete", "patch"].includes(
          callee.name.text,
        )
      );
    });
  }

  private findLayoutFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, dirent.name);

      if (dirent.isDirectory()) {
        files.push(...this.findLayoutFiles(filePath));
        continue;
      }

      if (!dirent.isFile()) continue;

      if (dirent.name !== "index.tsx") continue;

      if (!normalizePath(filePath).includes("/_layout/")) continue;

      files.push(filePath);
    }

    return files;
  }

  private getGeneratedImportPath(fromDir: string, targetFile: string) {
    const relativeImportPath = path
      .relative(fromDir, targetFile)
      .replace(/\\/g, "/");

    return relativeImportPath.startsWith(".")
      ? relativeImportPath
      : "./" + relativeImportPath;
  }

  private readPreloadedRouteChunks() {
    const preloadPath = path.join(app.paths.pages, "preload.json");

    if (!fs.existsSync(preloadPath)) return new Set<string>();

    const content = fs.readJsonSync(preloadPath);

    if (!Array.isArray(content))
      throw new Error(
        `Invalid client/pages/preload.json format: expected an array of chunk ids.`,
      );

    return new Set<string>(
      content.filter((value): value is string => typeof value === "string"),
    );
  }

  private getGeneratedClientRouteModuleFilepath(filepath: string) {
    return getGeneratedRouteModuleFilepath(
      app.paths.client.generated,
      app.paths.pages,
      filepath,
    );
  }

  private getGeneratedServerRouteModuleFilepath(filepath: string) {
    return getGeneratedRouteModuleFilepath(
      app.paths.server.generated,
      app.paths.root,
      filepath,
    );
  }

  private generateClientRouteWrapperModules() {
    const clientRouteFiles = this.findClientRouteFiles(app.paths.pages).sort((a, b) =>
      a.localeCompare(b),
    );
    const routeSourceFilepaths = new Set(
      clientRouteFiles.map((filepath) => normalizePath(path.resolve(filepath))),
    );

    for (const filepath of clientRouteFiles) {
      const pageChunk = cli.paths.getPageChunk(app, filepath);

      writeGeneratedRouteModule({
        outputFilepath: this.getGeneratedClientRouteModuleFilepath(filepath),
        side: "client",
        sourceFilepath: filepath,
        clientRoute: {
          chunkId: pageChunk.chunkId,
          filepath: pageChunk.filepath,
        },
        routeSourceFilepaths,
      });

      writeGeneratedRouteModule({
        outputFilepath: this.getGeneratedServerRouteModuleFilepath(filepath),
        side: "client",
        sourceFilepath: filepath,
        clientRoute: {
          chunkId: pageChunk.chunkId,
          filepath: pageChunk.filepath,
        },
        routeSourceFilepaths,
      });
    }
  }

  private generateServerRouteWrapperModules() {
    const serverRouteFiles = this.findServerRouteFiles(
      path.join(app.paths.root, "server", "routes"),
    ).sort((a, b) => a.localeCompare(b));
    const routeSourceFilepaths = new Set(
      serverRouteFiles.map((filepath) => normalizePath(path.resolve(filepath))),
    );

    for (const filepath of serverRouteFiles) {
      writeGeneratedRouteModule({
        outputFilepath: this.getGeneratedServerRouteModuleFilepath(filepath),
        side: "server",
        sourceFilepath: filepath,
        routeSourceFilepaths,
      });
    }
  }

  private generateClientRoutesModule() {
    const routeLoadersFile = path.join(app.paths.client.generated, "routes.ts");
    const preloadedChunks = this.readPreloadedRouteChunks();

    const routes = this.findClientRouteFiles(app.paths.pages)
      .sort((a, b) => a.localeCompare(b))
      .map<TClientRouteLoader>((filepath) => {
        const { chunkId } = cli.paths.getPageChunk(app, filepath);

        return {
          filepath,
          chunkId,
          preload: preloadedChunks.has(chunkId),
        };
      });

    const imports: string[] = [];
    const routeEntries: string[] = [];

    routes.forEach((route, index) => {
      const normalizedImportPath = this.getGeneratedImportPath(
        app.paths.client.generated,
        this.getGeneratedClientRouteModuleFilepath(route.filepath),
      );

      if (route.preload) {
        const localIdentifier = `preloadedRoute${index}`;
        imports.push(
          `import { __register as ${localIdentifier} } from ${JSON.stringify(normalizedImportPath)};`,
        );
        routeEntries.push(
          `    ${JSON.stringify(route.chunkId)}: () => Promise.resolve({ __register: ${localIdentifier} }),`,
        );
        return;
      }

      routeEntries.push(
        `    ${JSON.stringify(route.chunkId)}: () => import(/* webpackChunkName: ${JSON.stringify(route.chunkId)} */ ${JSON.stringify(normalizedImportPath)}),`,
      );
    });

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum to avoid rebuilding the page loader map in Babel.
// Do not edit it manually.

${imports.join("\n")}
${imports.length ? "\n" : ""}const routes = {
${routeEntries.join("\n")}
};

export default routes;
`;

    writeIfChanged(routeLoadersFile, content);
  }

  private generateClientLayoutsModule() {
    const layoutsFile = path.join(app.paths.client.generated, "layouts.ts");

    const layouts = this.findLayoutFiles(app.paths.pages)
      .map((filepath) => {
        const { chunkId } = cli.paths.getLayoutChunk(app, filepath);
        const importPath = this.getGeneratedImportPath(
          app.paths.client.generated,
          filepath,
        );
        const relativePath = normalizePath(path.relative(app.paths.root, filepath));
        const depth = relativePath.split("/").filter(Boolean).length;

        return {
          filepath: relativePath,
          chunkId,
          depth,
          importPath,
        };
      })
      .sort((a, b) => {
        if (b.depth !== a.depth) return b.depth - a.depth;
        return a.filepath.localeCompare(b.filepath);
      });

    const imports = layouts
      .map(
        (layout, index) =>
          `import * as layoutModule${index} from ${JSON.stringify(layout.importPath)};`,
      )
      .join("\n");

    const layoutEntries = layouts
      .map(
        (layout, index) =>
          `    ${JSON.stringify(layout.chunkId)}: layoutModule${index},`,
      )
      .join("\n");

    const orderedLayoutIds = layouts
      .map((layout) => `    ${JSON.stringify(layout.chunkId)},`)
      .join("\n");

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from app layout files.
// Do not edit it manually.

${imports}
${imports ? "\n" : ""}const layouts = {
${layoutEntries}
};

export const layoutOrder = [
${orderedLayoutIds}
];

export default layouts;
`;

    writeIfChanged(layoutsFile, content);
  }

  private generateServerRoutesModule() {
    const routeModulesFile = path.join(app.paths.server.generated, "routes.ts");
    const serverRouteFiles = this.findServerRouteFiles(
      path.join(app.paths.root, "server", "routes"),
    )
      .sort((a, b) => a.localeCompare(b))
      .map((filepath) => ({
        filepath: normalizePath(path.relative(app.paths.root, filepath)),
        importPath: this.getGeneratedImportPath(
          app.paths.server.generated,
          this.getGeneratedServerRouteModuleFilepath(filepath),
        ),
      }));

    const pageRouteFiles = this.findClientRouteFiles(app.paths.pages)
      .sort((a, b) => a.localeCompare(b))
      .map((filepath) => ({
        filepath: normalizePath(path.relative(app.paths.root, filepath)),
        importPath: this.getGeneratedImportPath(
          app.paths.server.generated,
          this.getGeneratedServerRouteModuleFilepath(filepath),
        ),
      }));

    const routeModules = [...serverRouteFiles, ...pageRouteFiles];

    const imports = routeModules
      .map(
        (routeModule, index) =>
          `const routeModule${index} = require(${JSON.stringify(routeModule.importPath)});`,
      )
      .join("\n");

    const routeEntries = routeModules
      .map(
        (routeModule, index) => `    {
        filepath: ${JSON.stringify(routeModule.filepath)},
        register: routeModule${index}.__register,
    },`,
      )
      .join("\n");

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from route registration files.
// Do not edit it manually.

import type { TRouteModule } from "@common/router";
${imports ? "\n" + imports : ""}

export type TGeneratedRouteModule = {
    filepath: string,
    register?: TRouteModule["__register"],
}

const routeModules: TGeneratedRouteModule[] = [
${routeEntries}
];

export default routeModules;
`;

    writeIfChanged(routeModulesFile, content);
  }

  private generateRoutingModules() {
    this.generateClientRouteWrapperModules();
    this.generateServerRouteWrapperModules();
    this.generateServerRoutesModule();
    this.generateClientRoutesModule();
    this.generateClientLayoutsModule();
  }

  private indexControllers() {
    return indexControllers([
      {
        importPrefix: "@server/services/",
        root: path.join(cli.paths.core.root, "server", "services"),
      },
      {
        importPrefix: "@/server/services/",
        root: path.join(app.paths.root, "server", "services"),
      },
    ]);
  }

  private generateControllerModules() {
    const controllers = this.indexControllers();
    const clientTree = generateControllerClientTree(controllers);

    const runtimeLeaf = (leaf: string) => {
      const meta = JSON.parse(leaf) as {
        routePath: string;
        hasInput: boolean;
      };

      return meta.hasInput
        ? `(data) => api.createFetcher('POST', ${JSON.stringify(meta.routePath)}, data)`
        : `() => api.createFetcher('POST', ${JSON.stringify(meta.routePath)})`;
    };

    const typeImports = controllers
      .map(
        (controller, index) =>
          `import type Controller${index} from ${JSON.stringify(controller.importPath)};`,
      )
      .join("\n");

    const typeLeaf = (leaf: string) => {
      const meta = JSON.parse(leaf) as {
        importPath: string;
        className: string;
        methodName: string;
        hasInput: boolean;
      };

      const controllerIndex = controllers.findIndex(
        (controller) => controller.importPath === meta.importPath,
      );

      const returnType = `ReturnType<Controller${controllerIndex}[${JSON.stringify(meta.methodName)}]>`;

      return meta.hasInput
        ? `(data: any) => ${returnType}`
        : `() => ${returnType}`;
    };

    const createControllersContent = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from server controller files.
// Do not edit it manually.

import type ApiClient from '@common/router/request/api';
${typeImports ? "\n" + typeImports : ""}

export type TControllers = ${printControllerTree(clientTree, typeLeaf)};

export const createControllers = (
    api: Pick<ApiClient, 'createFetcher'>
): TControllers => (
${printControllerTree(clientTree, runtimeLeaf)}
);

export default createControllers;
`;

    writeIfChanged(
      path.join(app.paths.common.generated, "controllers.ts"),
      createControllersContent,
    );

    writeIfChanged(
      path.join(app.paths.client.generated, "controllers.ts"),
      `export { createControllers, default } from '@/common/.generated/controllers';
export type { TControllers } from '@/common/.generated/controllers';
`,
    );

    const controllerImports = controllers
      .map(
        (controller, index) =>
          `import Controller${index} from ${JSON.stringify(controller.importPath)};`,
      )
      .join("\n");

    const controllerEntries = controllers.flatMap(
      (controller, controllerIndex) =>
        controller.methods.map(
          (method) => `    {
        path: ${JSON.stringify("/api/" + method.routePath)},
        Controller: Controller${controllerIndex},
        method: ${JSON.stringify(method.name)},
    },`,
        ),
    );

    writeIfChanged(
      path.join(app.paths.server.generated, "controllers.ts"),
      `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from server controller files.
// Do not edit it manually.

import type Controller from '@server/app/controller';
${controllerImports ? "\n" + controllerImports : ""}

export type TGeneratedControllerDefinition = {
    path: string,
    Controller: new (request: any) => Controller,
    method: string,
}

const controllers: TGeneratedControllerDefinition[] = [
${controllerEntries.join("\n")}
];

export default controllers;
`,
    );
  }

  private indexServices() {
    // Index services
    const searchDirs = [
      // The less priority is the first
      {
        path: "@server/services/",
        priority: -1,
        root: path.join(cli.paths.core.root, "server", "services"),
      },
      {
        path: "@/server/services/",
        priority: 0,
        root: path.join(app.paths.root, "server", "services"),
      },
      // Temp disabled because compile issue on vercel
      //'': path.join(app.paths.root, 'node_modules'),
    ];

    // Generate app class file
    const servicesAvailable: { [id: string]: TServiceMetas } = {};
    for (const searchDir of searchDirs) {
      const services = this.findServices(searchDir.root);

      for (const serviceDir of services) {
        const metasFile = path.join(serviceDir, "service.json");

        // The +1 is to remove the slash
        const importationPath =
          searchDir.path + serviceDir.substring(searchDir.root.length + 1);

        const serviceMetas = require(metasFile);

        servicesAvailable[serviceMetas.id] = {
          importationPath,
          priority: searchDir.priority,
          ...serviceMetas,
        };
      }
    }

    // Read app services
    const imported: string[] = [];
    const referencedNames: { [serviceId: string]: string } = {}; // ID to Name

    const refService = (
      serviceName: string,
      serviceConfig: any,
      level: number = 0,
    ): TRegisteredService => {
      if (serviceConfig.refTo !== undefined) {
        const refTo = serviceConfig.refTo;
        return {
          name: serviceName,
          instanciation: () => `this.${refTo}`,
          priority: 0,
        };
      }

      const serviceMetas = servicesAvailable[serviceConfig.id];
      if (serviceMetas === undefined)
        throw new Error(
          `Service ${serviceConfig.id} not found. Referenced services: ${Object.keys(servicesAvailable).join("\n")}`,
        );

      const referencedName = referencedNames[serviceConfig.id];
      if (referencedName !== undefined)
        throw new Error(
          `Service ${serviceConfig.id} is already setup as ${referencedName}`,
        );

      // Generate index & typings
      imported.push(
        `import ${serviceMetas.name} from "${serviceMetas.importationPath}";`,
      );

      if (serviceConfig.name !== undefined)
        referencedNames[serviceConfig.id] = serviceConfig.name;

      const processConfig = (config: any, level: number = 0) => {
        let propsStr = "";
        for (const key in config) {
          const value = config[key];

          if (!value || typeof value !== "object")
            propsStr += `"${key}":${serialize(value, { space: 4 })},\n`;
          // Reference to a service
          else if (
            value.type === "service.setup" ||
            value.type === "service.ref"
          )
            // TODO: more reliable way to detect a service reference
            propsStr +=
              `${key}:` +
              refService(key, value, level + 1).instanciation() +
              ",\n";
          // Recursion
          else if (level <= 4 && !Array.isArray(value))
            propsStr += `"${key}":` + processConfig(value, level + 1) + ",\n";
          else propsStr += `"${key}":${serialize(value, { space: 4 })},\n`;
        }

        return `{ ${propsStr} }`;
      };
      const config = processConfig(serviceConfig.config || {});

      // Generate the service instance
      const instanciation = (parentRef?: string) =>
        `new ${serviceMetas.name}( 
                    ${parentRef ? `${parentRef},` : ""}
                    ${config},
                    this 
                )`;

      return {
        id: serviceConfig.id,
        name: serviceName,
        instanciation,
        className: serviceMetas.name,
        priority: serviceConfig.config?.priority || serviceMetas.priority || 0,
      };
    };

    const servicesCode = Object.values(app.registered).map((s) =>
      refService(s.name, s, 0),
    );
    const sortedServices = servicesCode.sort((a, b) => a.priority - b.priority);

    // Define the app class identifier
    const appClassIdentifier = app.identity.identifier;
    const containerServices = app.containerServices
      .map((s) => "'" + s + "'")
      .join("|");

    // @/client/.generated/services.d.ts
    writeIfChanged(
      path.join(app.paths.client.generated, "services.d.ts"),
      `declare module "@app" {

    import { ${appClassIdentifier} as ${appClassIdentifier}Client } from "@/client";
    import ${appClassIdentifier}Server from "@/server/.generated/app";
  
    export const Router: ${appClassIdentifier}Client['Router'];

    ${sortedServices
      .map((service) =>
        service.name !== "Router"
          ? `export const ${service.name}: ${appClassIdentifier}Server["${service.name}"];`
          : "",
      )
      .join("\n")}

}
    
declare module '@models/types' {
    export * from '@/var/prisma/index';
}

declare module '@common/errors' {
            
    export * from '@common/errors/index';
    export { default } from '@common/errors/index';

    export const AuthRequired: typeof import('@common/errors/index').AuthRequired<FeatureKeys>;
    export type AuthRequired = import('@common/errors/index').AuthRequired<FeatureKeys>;

    export const UpgradeRequired: typeof import('@common/errors/index').UpgradeRequired<FeatureKeys>;
    export type UpgradeRequired = import('@common/errors/index').UpgradeRequired<FeatureKeys>;
}

declare namespace preact.JSX {
    interface HTMLAttributes {
        src?: string;
    }
}
`,
    );

    // @/client/.generated/context.ts
    writeIfChanged(
      path.join(app.paths.client.generated, "context.ts"),
      `// TODO: move it into core (but how to make sure usecontext returns ${appClassIdentifier}'s context ?)
import React from 'react';

import type ${appClassIdentifier}Server from '@/server/.generated/app';
import type { TRouterContext as TServerRouterRequestContext } from '@server/services/router/response';
import type { TRouterContext as TClientRouterRequestContext } from '@client/services/router/response';
import type { TControllers } from '@/common/.generated/controllers';
import type ${appClassIdentifier}Client from '.';

// TO Fix: TClientRouterRequestContext is unable to get the right type of ${appClassIdentifier}Client["router"]
    //    (it gets ClientApplication instead of ${appClassIdentifier}Client)
type ClientRequestContext = TClientRouterRequestContext<${appClassIdentifier}Client["Router"], ${appClassIdentifier}Client>;
type ServerRequestContext = TServerRouterRequestContext<${appClassIdentifier}Server["Router"]>
type UniversalServices = ClientRequestContext | ServerRequestContext

// Non-universla services are flagged as potentially undefined
export type ClientContext = (
    UniversalServices 
    & 
    Partial<Omit<ClientRequestContext, keyof UniversalServices>>
    &
    TControllers
    &
    {
        Router: ${appClassIdentifier}Client["Router"],
    }
)

export const ReactClientContext = React.createContext<ClientContext>({} as ClientContext);
export default (): ClientContext => React.useContext<ClientContext>(ReactClientContext);`,
    );

    // @/common/.generated/services.d.ts
    writeIfChanged(
      path.join(app.paths.common.generated, "services.d.ts"),
      `declare module '@models/types' {
    export * from '@/var/prisma/index';
}`,
    );

    // @/server/.generated/app.ts
    writeIfChanged(
      path.join(app.paths.server.generated, "app.ts"),
      `
import { Application } from '@server/app/index';
import { ServicesContainer } from '@server/app/service/container';

${imported.join("\n")}

export default class ${appClassIdentifier} extends Application<ServicesContainer, CurrentUser> {

    // Make sure the services typigs are reflecting the config and referring to the app
    ${sortedServices
      .map(
        (service) =>
          `public ${service.name}!: ReturnType<${appClassIdentifier}["registered"]["${service.id}"]["start"]>;`,
      )
      .join("\n")}

    protected registered = {
        ${sortedServices
          .map(
            (service) =>
              `"${service.id}": {
                name: "${service.name}",
                priority: ${service.priority},
                start: () => ${service.instanciation("this")}
            }`,
          )
          .join(",\n")}
    } as const;
}


`,
    );

    // @/server/.generated/services.d.ts
    writeIfChanged(
      path.join(app.paths.server.generated, "services.d.ts"),
      `type InstalledServices = import('./services').Services;

declare type ${appClassIdentifier} = import("@/server/.generated/app").default;

declare module '@cli/app' {

    type TSetupConfig<TConfig> =
        TConfig extends (...args: any[]) => any ? TConfig
        : TConfig extends Array<infer TItem> ? Array<TSetupConfig<TItem>>
        : TConfig extends object ? {
            [K in keyof TConfig]: TSetupConfig<TConfig[K]> | TServiceSetup | TServiceRef
        }
        : TConfig;

    type App = {

        env: TEnvConfig;

        use: (referenceName: string) => TServiceRef;

        setup: <TServiceName extends keyof ${appClassIdentifier}>(...args: [
            // { user: app.setup('Core/User') }
            servicePath: string,
            serviceConfig?: {}
        ] | [
            // app.setup('User', 'Core/User')
            serviceName: TServiceName, 
            servicePath: string,
            serviceConfig?: TSetupConfig<${appClassIdentifier}[TServiceName]["config"]>
        ]) => TServiceSetup;
    }
    const app: App;
    export = app;
}

declare module "@app" {

    import { ApplicationContainer } from '@server/app/container';

    const ServerServices: (
        Pick< 
            ApplicationContainer<InstalledServices>, 
            ${containerServices}
        >
        & 
        ${appClassIdentifier}
    )

    export = ServerServices
}

declare module '@server/app' {

    import { Application } from "@server/app";
    import { Environment } from "@server/app";
    import { ServicesContainer } from "@server/app/service/container";

    abstract class ApplicationWithServices extends Application<
        ServicesContainer<InstalledServices>
    > {}

    export interface Exported {
        Application: typeof ApplicationWithServices,
        Environment: Environment,
    }

    const foo: Exported;

    export = foo;
}

declare module '@common/errors' {
        
    export * from '@common/errors/index';
    export { default } from '@common/errors/index';

    export const AuthRequired: typeof import('@common/errors/index').AuthRequired<FeatureKeys>;
    export type AuthRequired = import('@common/errors/index').AuthRequired<FeatureKeys>;

    export const UpgradeRequired: typeof import('@common/errors/index').UpgradeRequired<FeatureKeys>;
    export type UpgradeRequired = import('@common/errors/index').UpgradeRequired<FeatureKeys>;
}
    
declare module '@models/types' {
    export * from '@/var/prisma/index';
}`,
    );
  }

  private async warmupApp() {
    await app.warmup();
  }

  private async refreshGeneratedArtifacts() {
    if (!this.refreshingGeneratedArtifacts) {
      this.refreshingGeneratedArtifacts = (async () => {
        this.indexServices();
        this.generateControllerModules();
        this.generateRoutingModules();
      })().finally(() => {
        this.refreshingGeneratedArtifacts = undefined;
      });
    }

    await this.refreshingGeneratedArtifacts;
  }

  public async refreshGeneratedTypings() {
    await this.warmupApp();
    await this.refreshGeneratedArtifacts();
  }

  public consumeRecentCompilationResults() {
    const recentCompilationResults = { ...this.recentCompilationResults };
    this.recentCompilationResults = {};
    return recentCompilationResults;
  }

  public async create() {
    await this.warmupApp();

    this.cleanup();

    this.fixNpmLinkIssues();
    await this.refreshGeneratedArtifacts();

    // Create compilers
    const multiCompiler = rspack([
      createServerConfig(app, this.mode, this.outputTarget),
      createClientConfig(app, this.mode, this.outputTarget),
    ]);

    for (const compiler of multiCompiler.compilers) {
      const name = compiler.name;
      if (name === undefined)
        throw new Error(`A name must be specified to each compiler.`);

      let timeStart = new Date();

      let finished: () => void;
      this.compiling[name] = new Promise((resolve) => (finished = resolve));

      compiler.hooks.beforeRun.tapPromise(name, () =>
        this.refreshGeneratedArtifacts(),
      );
      compiler.hooks.watchRun.tapPromise(name, () =>
        this.refreshGeneratedArtifacts(),
      );

      compiler.hooks.compile.tap(name, (compilation) => {
        this.callbacks.before && this.callbacks.before(compiler);

        this.compiling[name] = new Promise((resolve) => (finished = resolve));

        timeStart = new Date();
        console.info(`[${name}] Compiling ...`);
      });

      /* TODO: Ne pas résoudre la promise tant que la recompilation des données indexées (icones, identité, ...) 
                n'a pas été achevée */
      compiler.hooks.done.tap(name, (stats) => {
        const compilationSucceeded = !stats.hasErrors();
        this.recentCompilationResults[name] = compilationSucceeded;

        // Shiow status
        const timeEnd = new Date();
        const time = timeEnd.getTime() - timeStart.getTime();
        if (!compilationSucceeded) {
          console.info(stats.toString(compiler.options.stats));
          console.error(`[${name}] Failed to compile after ${time} ms`);

          // Exit process with code 0, so the CI container can understand building failed
          // Only in prod, because in dev, we want the compiler watcher continue running
          if (this.mode === "prod") process.exit(0);
        } else {
          if (name === "client") {
            writeClientManifest(stats, app.outputPath(this.outputTarget));
          }

          this.debug && console.info(stats.toString(compiler.options.stats));
          console.info(`[${name}] Finished compilation after ${time} ms`);
        }

        // Mark as finished
        finished();
        delete this.compiling[name];
      });
    }

    return multiCompiler;
  }
}
