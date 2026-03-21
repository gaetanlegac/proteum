import fs from "fs-extra";
import path from "path";
import { parse } from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import * as types from "@babel/types";

const findFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];

  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const filepath = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      files.push(...findFiles(filepath));
      continue;
    }

    if (dirent.isFile() && /\.(tsx?|jsx?)$/.test(filepath))
      files.push(filepath);
  }

  return files;
};

const isFunctionLikePath = (path: NodePath) =>
  path.isFunctionDeclaration() ||
  path.isFunctionExpression() ||
  path.isArrowFunctionExpression() ||
  path.isObjectMethod() ||
  path.isClassMethod();

const getOutermostFunctionPath = (path: NodePath) => {
  let current: NodePath | null = path;
  let lastFunctionPath: NodePath | null = null;

  while (current && !current.isProgram()) {
    if (isFunctionLikePath(current)) lastFunctionPath = current;

    current = current.parentPath;
  }

  return lastFunctionPath;
};

const ensureUseContextImport = (programPath: NodePath<types.Program>) => {
  for (const statement of programPath.node.body) {
    if (
      statement.type === "ImportDeclaration" &&
      statement.source.value === "@/client/context" &&
      statement.specifiers.some(
        (specifier) =>
          specifier.type === "ImportDefaultSpecifier" &&
          specifier.local.name === "useContext",
      )
    )
      return;
  }

  programPath.unshiftContainer(
    "body",
    types.importDeclaration(
      [types.importDefaultSpecifier(types.identifier("useContext"))],
      types.stringLiteral("@/client/context"),
    ),
  );
};

const ensureBlockBody = (functionPath: NodePath) => {
  if (
    functionPath.isArrowFunctionExpression() &&
    functionPath.node.body.type !== "BlockStatement"
  ) {
    functionPath.node.body = types.blockStatement([
      types.returnStatement(functionPath.node.body),
    ]);
  }

  return functionPath.get("body") as NodePath<types.BlockStatement>;
};

const hasExistingUseContextDeclaration = (
  bodyPath: NodePath<types.BlockStatement>,
  names: string[],
) => {
  return bodyPath.node.body.some(
    (statement) =>
      statement.type === "VariableDeclaration" &&
      statement.declarations.some(
        (declaration) =>
          declaration.id.type === "ObjectPattern" &&
          declaration.init?.type === "CallExpression" &&
          declaration.init.callee.type === "Identifier" &&
          declaration.init.callee.name === "useContext" &&
          names.every((name) =>
            declaration.id.properties.some(
              (property) =>
                property.type === "ObjectProperty" &&
                property.key.type === "Identifier" &&
                property.key.name === name,
            ),
          ),
      ),
  );
};

const objectPatternHasProperty = (
  pattern: types.ObjectPattern,
  localName: string,
) =>
  pattern.properties.some(
    (property) =>
      property.type === "ObjectProperty" &&
      property.value.type === "Identifier" &&
      property.value.name === localName,
  );

const addObjectPatternProperty = (
  pattern: types.ObjectPattern,
  keyName: string,
  localName: string = keyName,
) => {
  if (objectPatternHasProperty(pattern, localName)) return;

  pattern.properties.push(
    types.objectProperty(
      types.identifier(keyName),
      types.identifier(localName),
      false,
      keyName === localName,
    ),
  );
};

const getUseContextStatements = (bodyPath: NodePath<types.BlockStatement>) => {
  return bodyPath
    .get("body")
    .filter(
      (statementPath) =>
        statementPath.isVariableDeclaration() &&
        statementPath.node.declarations.length === 1 &&
        statementPath.node.declarations[0].id.type === "ObjectPattern" &&
        statementPath.node.declarations[0].init?.type === "CallExpression" &&
        statementPath.node.declarations[0].init.callee.type === "Identifier" &&
        statementPath.node.declarations[0].init.callee.name === "useContext",
    ) as NodePath<types.VariableDeclaration>[];
};

const repoRoots = process.argv.slice(2);
if (!repoRoots.length)
  throw new Error(
    "Usage: ts-node scripts/refactor-client-app-imports.ts <repo-root> [repo-root...]",
  );

for (const repoRoot of repoRoots) {
  const clientRoot = path.join(repoRoot, "client");
  const files = findFiles(clientRoot).filter(
    (filepath) => !filepath.includes("/client/pages/"),
  );
  let changedFiles = 0;

  for (const filepath of files) {
    const code = fs.readFileSync(filepath, "utf8");
    if (!code.includes("@app") && !code.includes('"@app"')) continue;

    const ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
    });

    const importedNames = new Set<string>();
    const functionBindings = new Map<NodePath, Set<string>>();
    let hasAppImport = false;

    traverse(ast, {
      ImportDeclaration(path) {
        if (path.node.source.value !== "@app") return;

        hasAppImport = true;

        for (const specifier of path.node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier"
          )
            importedNames.add(specifier.local.name);
        }
      },
      Identifier(path) {
        if (!importedNames.has(path.node.name)) return;

        if (!path.isReferencedIdentifier()) return;

        const binding = path.scope.getBinding(path.node.name);
        if (!binding?.path.isImportSpecifier()) return;

        const functionPath = getOutermostFunctionPath(path);
        if (!functionPath) return;

        const names = functionBindings.get(functionPath) || new Set<string>();
        names.add(path.node.name);
        functionBindings.set(functionPath, names);
      },
    });

    if (!hasAppImport) continue;

    traverse(ast, {
      Program(programPath) {
        for (const statementPath of programPath.get("body")) {
          if (!statementPath.isImportDeclaration()) continue;

          if (statementPath.node.source.value === "@app")
            statementPath.remove();
        }

        ensureUseContextImport(programPath);
      },
    });

    for (const [functionPath, namesSet] of functionBindings) {
      const names = [...namesSet].sort((a, b) => a.localeCompare(b));
      const bodyPath = ensureBlockBody(functionPath);
      const useContextStatements = getUseContextStatements(bodyPath);

      if (hasExistingUseContextDeclaration(bodyPath, names)) continue;

      if (useContextStatements.length) {
        const primaryDeclaration = useContextStatements[0].node.declarations[0];
        const primaryPattern = primaryDeclaration.id as types.ObjectPattern;

        for (const statementPath of useContextStatements.slice(1)) {
          const declaration = statementPath.node.declarations[0];
          const pattern = declaration.id as types.ObjectPattern;

          for (const property of pattern.properties) {
            if (
              property.type === "ObjectProperty" &&
              property.key.type === "Identifier" &&
              property.value.type === "Identifier"
            )
              addObjectPatternProperty(
                primaryPattern,
                property.key.name,
                property.value.name,
              );
          }

          statementPath.remove();
        }

        for (const name of names)
          addObjectPatternProperty(primaryPattern, name);

        continue;
      }

      bodyPath.unshiftContainer(
        "body",
        types.variableDeclaration("const", [
          types.variableDeclarator(
            types.objectPattern(
              names.map((name) =>
                types.objectProperty(
                  types.identifier(name),
                  types.identifier(name),
                  false,
                  true,
                ),
              ),
            ),
            types.callExpression(types.identifier("useContext"), []),
          ),
        ]),
      );
    }

    fs.writeFileSync(filepath, generate(ast, {}, code).code);
    changedFiles++;
  }

  console.log(
    `[refactor-client-app-imports] ${repoRoot}: changed ${changedFiles} files`,
  );
}
