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

export type TControllerServiceRoot = { alias: string; dir: string };

type TControllerSearchDir = { importPrefix: string; root: string; serviceRoots?: TControllerServiceRoot[] };

/*----------------------------------
- HELPERS
----------------------------------*/

const getControllerSegments = (relativePath: string) => {
    const segments = relativePath
        .replace(/\.controller\.ts$/, '')
        .split('/')
        .filter(Boolean);

    if (segments.length > 1 && segments[segments.length - 1] === segments[segments.length - 2]) {
        segments.pop();
    }

    return segments;
};

const getControllerBasePathFromFilepath = (filepath: string, root: string, serviceRoots: TControllerServiceRoot[] = []) => {
    const normalizedFilepath = filepath.replace(/\\/g, '/');
    const serviceRoot = serviceRoots
        .filter((candidate) => normalizedFilepath.startsWith(candidate.dir.replace(/\\/g, '/') + '/'))
        .sort((a, b) => b.dir.length - a.dir.length)[0];

    if (!serviceRoot) {
        return getControllerSegments(path.relative(root, filepath).replace(/\\/g, '/')).join('/');
    }

    const segments = getControllerSegments(path.relative(serviceRoot.dir, filepath).replace(/\\/g, '/'));

    if (segments[0]?.toLowerCase() === serviceRoot.alias.toLowerCase()) {
        segments.shift();
    }

    return [serviceRoot.alias, ...segments].filter(Boolean).join('/');
};

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
        if (!dirent.name.endsWith('.controller.ts')) continue;

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

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
    !!node.modifiers?.some((modifier) => modifier.kind === kind);

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

const getExportedString = (sourceFile: ts.SourceFile, exportName: string) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            if (declaration.name.text !== exportName) continue;
            if (!declaration.initializer || !ts.isStringLiteral(declaration.initializer)) continue;

            return declaration.initializer.text;
        }
    }

    return undefined;
};

const countInputCalls = (method: ts.MethodDeclaration) => {
    let inputCallsCount = 0;

    const visit = (node: ts.Node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
            node.expression.name.text === 'input'
        ) {
            inputCallsCount++;
        }

        ts.forEachChild(node, visit);
    };

    if (method.body) ts.forEachChild(method.body, visit);

    return inputCallsCount;
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

            const controllerPathOverride = getExportedString(sourceFile, 'controllerPath');
            const defaultClass = getDefaultExportClass(sourceFile);

            if (!defaultClass) continue;

            const className = defaultClass.name?.text || getGeneratedClassName(filepath);
            const routeBasePath =
                controllerPathOverride ||
                getControllerBasePathFromFilepath(filepath, searchDir.root, searchDir.serviceRoots || []);
            const methods: TControllerMethodMeta[] = [];

            for (const member of defaultClass.members) {
                if (!ts.isMethodDeclaration(member)) continue;
                if (!member.body) continue;
                if (!member.name || !ts.isIdentifier(member.name)) continue;

                const methodName = member.name.text;
                const inputCallsCount = countInputCalls(member);

                if (inputCallsCount > 1) {
                    throw new Error(`${filepath}#${methodName} uses this.input() more than once.`);
                }

                methods.push({
                    name: methodName,
                    inputCallsCount,
                    routePath: [routeBasePath, methodName].filter(Boolean).join('/'),
                    sourceLocation: getNodeLocation(sourceFile, member.name),
                });
            }

            if (!methods.length) continue;

            controllers.push({
                filepath,
                importPath: buildImportPath(searchDir, filepath),
                className,
                routeBasePath,
                methods,
            });
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
