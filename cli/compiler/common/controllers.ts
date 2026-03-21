/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from "fs-extra";
import path from "path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as types from "@babel/types";

/*----------------------------------
- TYPES
----------------------------------*/

export type TControllerMethodMeta = {
  name: string;
  inputCallsCount: number;
  routePath: string;
};

export type TControllerFileMeta = {
  importPath: string;
  filepath: string;
  className: string;
  routeBasePath: string;
  methods: TControllerMethodMeta[];
};

type TControllerSearchDir = {
  importPrefix: string;
  root: string;
};

/*----------------------------------
- HELPERS
----------------------------------*/

const getControllerBasePathFromFilepath = (filepath: string, root: string) => {
  const relativePath = path.relative(root, filepath).replace(/\\/g, "/");
  const segments = relativePath
    .replace(/\.controller\.ts$/, "")
    .split("/")
    .filter(Boolean);

  if (
    segments.length > 1 &&
    segments[segments.length - 1] === segments[segments.length - 2]
  )
    segments.pop();

  return segments.join("/");
};

const getGeneratedClassName = (filepath: string) => {
  const filename = path
    .basename(filepath, ".ts")
    .replace(/[^A-Za-z0-9_$]+/g, "_");
  const normalized = filename.length ? filename : "Controller";

  return normalized[0].toUpperCase() + normalized.substring(1);
};

const countInputCalls = (
  methodPath: traverse.NodePath<types.ClassMethod | types.ClassPrivateMethod>,
) => {
  let inputCallsCount = 0;

  methodPath.traverse({
    CallExpression(callPath) {
      const callee = callPath.node.callee;

      if (
        callee.type === "MemberExpression" &&
        callee.object.type === "ThisExpression" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "input"
      ) {
        inputCallsCount++;
      }
    },
  });

  return inputCallsCount;
};

const getExportedString = (ast: types.File, exportName: string) => {
  let value: string | undefined;

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration;
      if (!declaration || declaration.type !== "VariableDeclaration") return;

      for (const declarator of declaration.declarations) {
        if (
          declarator.id.type === "Identifier" &&
          declarator.id.name === exportName &&
          declarator.init?.type === "StringLiteral"
        ) {
          value = declarator.init.value;
          path.stop();
          return;
        }
      }
    },
  });

  return value;
};

const getExportedStringMap = (ast: types.File, exportName: string) => {
  const map: Record<string, string> = {};

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration;
      if (!declaration || declaration.type !== "VariableDeclaration") return;

      for (const declarator of declaration.declarations) {
        if (
          declarator.id.type !== "Identifier" ||
          declarator.id.name !== exportName ||
          declarator.init?.type !== "ObjectExpression"
        )
          continue;

        for (const property of declarator.init.properties) {
          if (
            property.type !== "ObjectProperty" ||
            property.key.type !== "Identifier" ||
            property.value.type !== "StringLiteral"
          )
            continue;

          map[property.key.name] = property.value.value;
        }

        path.stop();
        return;
      }
    },
  });

  return map;
};

const buildImportPath = (searchDir: TControllerSearchDir, filepath: string) =>
  searchDir.importPrefix +
  path
    .relative(searchDir.root, filepath)
    .replace(/\\/g, "/")
    .replace(/\.ts$/, "");

const findControllerFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];

  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const filepath = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      files.push(...findControllerFiles(filepath));
      continue;
    }

    if (!dirent.isFile()) continue;

    if (!dirent.name.endsWith(".controller.ts")) continue;

    files.push(filepath);
  }

  return files;
};

/*----------------------------------
- EXPORTS
----------------------------------*/

export const indexControllers = (searchDirs: TControllerSearchDir[]) => {
  const controllers: TControllerFileMeta[] = [];

  for (const searchDir of searchDirs) {
    const controllerFiles = findControllerFiles(searchDir.root);

    for (const filepath of controllerFiles.sort((a, b) => a.localeCompare(b))) {
      const code = fs.readFileSync(filepath, "utf8");
      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
      });

      const controllerPathOverride = getExportedString(ast, "controllerPath");
      const controllerMethodsOverride = getExportedStringMap(
        ast,
        "controllerMethods",
      );

      let className = getGeneratedClassName(filepath);
      const methods: TControllerMethodMeta[] = [];

      traverse(ast, {
        ExportDefaultDeclaration(path) {
          const declaration = path.node.declaration;

          if (declaration.type === "Identifier") {
            className = declaration.name;
            return;
          }

          if (declaration.type !== "ClassDeclaration") return;

          if (declaration.id?.name) className = declaration.id.name;

          const routeBasePath =
            controllerPathOverride ||
            getControllerBasePathFromFilepath(filepath, searchDir.root);

          for (const classBodyItem of declaration.body.body) {
            if (
              classBodyItem.type !== "ClassMethod" ||
              classBodyItem.kind !== "method" ||
              classBodyItem.computed ||
              classBodyItem.key.type !== "Identifier"
            )
              continue;

            const methodName = classBodyItem.key.name;
            const methodPath = path
              .get("declaration")
              .get("body")
              .get("body")
              .find(
                (bodyItemPath) => bodyItemPath.node === classBodyItem,
              ) as traverse.NodePath<types.ClassMethod>;

            const inputCallsCount = countInputCalls(methodPath);

            if (inputCallsCount > 1)
              throw new Error(
                `${filepath}#${methodName} uses this.input() more than once.`,
              );

            methods.push({
              name: methodName,
              inputCallsCount,
              routePath:
                controllerMethodsOverride[methodName] ||
                [routeBasePath, methodName].filter(Boolean).join("/"),
            });
          }

          path.stop();
        },
      });

      if (!methods.length) continue;

      controllers.push({
        filepath,
        importPath: buildImportPath(searchDir, filepath),
        className,
        routeBasePath:
          controllerPathOverride ||
          getControllerBasePathFromFilepath(filepath, searchDir.root),
        methods,
      });
    }
  }

  return controllers.sort((a, b) => a.filepath.localeCompare(b.filepath));
};

export const generateControllerClientTree = (
  controllers: TControllerFileMeta[],
) => {
  const root: Record<string, any> = {};

  const insert = (segments: string[], valueFactory: () => string) => {
    let cursor = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        cursor[segment] = valueFactory();
        return;
      }

      cursor[segment] = cursor[segment] || {};
      cursor = cursor[segment];
    }
  };

  for (const controller of controllers) {
    for (const method of controller.methods) {
      insert(method.routePath.split("/"), () =>
        JSON.stringify({
          importPath: controller.importPath,
          className: controller.className,
          methodName: method.name,
          routePath: "/api/" + method.routePath,
          hasInput: method.inputCallsCount > 0,
        }),
      );
    }
  }

  return root;
};

export const printControllerTree = (
  tree: Record<string, any>,
  renderLeaf: (leaf: string) => string,
  indentLevel: number = 1,
) => {
  const indent = "    ".repeat(indentLevel);
  const lines: string[] = ["{"];

  for (const key of Object.keys(tree).sort((a, b) => a.localeCompare(b))) {
    const value = tree[key];

    if (typeof value === "string") {
      lines.push(`${indent}${JSON.stringify(key)}: ${renderLeaf(value)},`);
      continue;
    }

    lines.push(
      `${indent}${JSON.stringify(key)}: ${printControllerTree(value, renderLeaf, indentLevel + 1)},`,
    );
  }

  lines.push(`${"    ".repeat(indentLevel - 1)}}`);

  return lines.join("\n");
};
