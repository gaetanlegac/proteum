/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';

/*----------------------------------
- TYPES
----------------------------------*/

export type TControllerSourceLocation = { line: number; column: number };

export type TControllerMethodMeta = {
    name: string;
    inputCallsCount: number;
    routePath: string;
    sourceLocation: TControllerSourceLocation;
};

export type TControllerFileMeta = {
    importPath: string;
    filepath: string;
    className: string;
    routeBasePath: string;
    methods: TControllerMethodMeta[];
};

type TControllerSearchDir = { importPrefix: string; root: string };

/*----------------------------------
- HELPERS
----------------------------------*/

const getControllerSegments = (relativePath: string) => {
    const segments = relativePath
        .replace(/\.ts$/, '')
        .split('/')
        .filter(Boolean);

    if (segments[segments.length - 1] === 'index') {
        segments.pop();
    }

    return segments;
};

const getControllerBasePathFromFilepath = (filepath: string, root: string) =>
    getControllerSegments(path.relative(root, filepath).replace(/\\/g, '/')).join('/');

const getGeneratedClassName = (filepath: string) => {
    const filename = path.basename(filepath, '.ts').replace(/[^A-Za-z0-9_$]+/g, '_');
    const normalized = filename.length ? filename : 'Controller';

    return normalized[0].toUpperCase() + normalized.substring(1);
};

const buildImportPath = (searchDir: TControllerSearchDir, filepath: string) =>
    searchDir.importPrefix + path.relative(searchDir.root, filepath).replace(/\\/g, '/').replace(/\.ts$/, '');

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
        if (!dirent.name.endsWith('.ts')) continue;
        if (dirent.name.endsWith('.d.ts')) continue;

        files.push(filepath);
    }

    return files;
};

const parseSourceFile = (filepath: string, code: string) =>
    ts.createSourceFile(
        filepath,
        code,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

const getNodeLocation = (sourceFile: ts.SourceFile, node: ts.Node): TControllerSourceLocation => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return { line: line + 1, column: character + 1 };
};

const hasModifier = (node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }, kind: ts.SyntaxKind) =>
    !!node.modifiers?.some((modifier: ts.ModifierLike) => modifier.kind === kind);

const getDefaultExportClass = (sourceFile: ts.SourceFile) => {
    const classes = new Map<string, ts.ClassDeclaration>();

    for (const statement of sourceFile.statements) {
        if (ts.isClassDeclaration(statement) && statement.name) {
            classes.set(statement.name.text, statement);

            if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
                return statement;
            }
        }
    }

    for (const statement of sourceFile.statements) {
        if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;

        if (ts.isIdentifier(statement.expression)) {
            return classes.get(statement.expression.text);
        }
    }

    return undefined;
};

const getPropertyKey = (name: ts.PropertyName) => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return undefined;
};

const getPropertyAssignment = (node: ts.ObjectLiteralExpression, propertyName: string) => {
    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        const key = getPropertyKey(property.name);
        if (key === propertyName) return property.initializer;
    }

    return undefined;
};

const collectConstInitializers = (sourceFile: ts.SourceFile) => {
    const initializers = new Map<string, ts.Expression>();

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

            initializers.set(declaration.name.text, declaration.initializer);
        }
    }

    return initializers;
};

const tryEvaluateStaticString = (
    sourceFile: ts.SourceFile,
    expression: ts.Expression,
    activeNames = new Set<string>(),
): string | undefined => {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;

    if (ts.isIdentifier(expression)) {
        if (activeNames.has(expression.text)) return undefined;

        const initializer = collectConstInitializers(sourceFile).get(expression.text);
        if (!initializer) return undefined;

        activeNames.add(expression.text);
        const value = tryEvaluateStaticString(sourceFile, initializer, activeNames);
        activeNames.delete(expression.text);

        return value;
    }

    return undefined;
};

const resolveIdentifierExpression = (sourceFile: ts.SourceFile, expression: ts.Expression): ts.Expression => {
    if (!ts.isIdentifier(expression)) return expression;

    return collectConstInitializers(sourceFile).get(expression.text) || expression;
};

const getDefaultControllerExpression = (sourceFile: ts.SourceFile) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;

        return resolveIdentifierExpression(sourceFile, statement.expression);
    }

    return undefined;
};

const getCallExpressionName = (node: ts.Expression) => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return undefined;
};

const assertNoControllerMagicImports = (sourceFile: ts.SourceFile) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (statement.moduleSpecifier.text !== '@app') continue;

        const location = getNodeLocation(sourceFile, statement);
        throw new Error(
            `${sourceFile.fileName}:${location.line}:${location.column} imports @app. Controller modules must export defineController(...) and receive services through typed action context.`,
        );
    }
};

const readExplicitController = (
    sourceFile: ts.SourceFile,
    filepath: string,
    root: string,
): TControllerFileMeta | undefined => {
    const expression = getDefaultControllerExpression(sourceFile);
    if (!expression) return undefined;

    assertNoControllerMagicImports(sourceFile);

    if (!ts.isCallExpression(expression) || getCallExpressionName(expression.expression) !== 'defineController') {
        const location = getNodeLocation(sourceFile, expression);
        throw new Error(
            `${filepath}:${location.line}:${location.column} must default-export defineController({ path, actions }). Legacy controller classes are no longer supported.`,
        );
    }

    const [definitionArg] = [...expression.arguments];
    if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) {
        throw new Error(`defineController(...) in ${filepath} must receive an object literal.`);
    }

    const pathExpression = getPropertyAssignment(definitionArg, 'path');
    const routeBasePath =
        pathExpression ? tryEvaluateStaticString(sourceFile, pathExpression) || getControllerBasePathFromFilepath(filepath, root) : getControllerBasePathFromFilepath(filepath, root);
    const actionsExpression = getPropertyAssignment(definitionArg, 'actions');

    if (!actionsExpression || !ts.isObjectLiteralExpression(actionsExpression)) {
        throw new Error(`defineController(...) in ${filepath} must declare an actions object literal.`);
    }

    const methods: TControllerMethodMeta[] = [];

    for (const property of actionsExpression.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        const methodName = getPropertyKey(property.name);
        if (!methodName) continue;

        const actionExpression = resolveIdentifierExpression(sourceFile, property.initializer);
        if (!ts.isCallExpression(actionExpression) || getCallExpressionName(actionExpression.expression) !== 'defineAction') {
            const location = getNodeLocation(sourceFile, property);
            throw new Error(`${filepath}:${location.line}:${location.column} controller actions must use defineAction(...).`);
        }

        const [actionArg] = [...actionExpression.arguments];
        const hasInput =
            !!actionArg &&
            ts.isObjectLiteralExpression(actionArg) &&
            getPropertyAssignment(actionArg, 'input') !== undefined;

        methods.push({
            name: methodName,
            inputCallsCount: hasInput ? 1 : 0,
            routePath: [routeBasePath, methodName].filter(Boolean).join('/'),
            sourceLocation: getNodeLocation(sourceFile, property.name),
        });
    }

    if (!methods.length) return undefined;

    return {
        filepath,
        importPath: '',
        className: path.basename(filepath, '.ts').replace(/[^A-Za-z0-9_$]+/g, '_') || 'Controller',
        routeBasePath,
        methods,
    };
};

/*----------------------------------
- EXPORTS
----------------------------------*/

export const indexControllers = (searchDirs: TControllerSearchDir[]) => {
    const controllers: TControllerFileMeta[] = [];

    for (const searchDir of searchDirs) {
        const controllerFiles = findControllerFiles(searchDir.root);

        for (const filepath of controllerFiles.sort((a, b) => a.localeCompare(b))) {
            const code = fs.readFileSync(filepath, 'utf8');
            const sourceFile = parseSourceFile(filepath, code);
            const explicitController = readExplicitController(sourceFile, filepath, searchDir.root);

            if (explicitController) {
                controllers.push({
                    ...explicitController,
                    importPath: buildImportPath(searchDir, filepath),
                });
                continue;
            }

            const defaultClass = getDefaultExportClass(sourceFile);

            if (!defaultClass) continue;

            const location = getNodeLocation(sourceFile, defaultClass);
            throw new Error(
                `${filepath}:${location.line}:${location.column} uses a legacy controller class. Export defineController({ path, actions }) instead.`,
            );
        }
    }

    return controllers.sort((a, b) => a.filepath.localeCompare(b.filepath));
};

export const generateControllerClientTree = (controllers: TControllerFileMeta[]) => {
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
            insert(method.routePath.split('/'), () =>
                JSON.stringify({
                    importPath: controller.importPath,
                    className: controller.className,
                    methodName: method.name,
                    routePath: '/api/' + method.routePath,
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
    const indent = '    '.repeat(indentLevel);
    const lines: string[] = ['{'];

    for (const key of Object.keys(tree).sort((a, b) => a.localeCompare(b))) {
        const value = tree[key];

        if (typeof value === 'string') {
            lines.push(`${indent}${JSON.stringify(key)}: ${renderLeaf(value)},`);
            continue;
        }

        lines.push(`${indent}${JSON.stringify(key)}: ${printControllerTree(value, renderLeaf, indentLevel + 1)},`);
    }

    lines.push(`${'    '.repeat(indentLevel - 1)}}`);

    return lines.join('\n');
};
