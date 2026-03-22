import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';

import writeIfChanged from '../writeIfChanged';

type TRouteSide = 'client' | 'server';
type TRouteRuntime = 'client' | 'server';

type TImportedService = { importedName: string; localName: string };

type TRouteDefinition = { args: ts.NodeArray<ts.Expression>; methodName: string; serviceLocalName: string };

type TGeneratedClientRouteModuleOptions = { chunkId: string; filepath: string };

type TWriteGeneratedRouteModuleOptions = {
    outputFilepath: string;
    runtime: TRouteRuntime;
    side: TRouteSide;
    sourceFilepath: string;
    clientRoute?: TGeneratedClientRouteModuleOptions;
    routeSourceFilepaths?: Set<string>;
};

const clientRouterImportSources = new Set(['@client/router', '@/client/router']);
const routerMethods = new Set(['page', 'error', 'get', 'post', 'put', 'delete', 'patch']);

const parseSourceFile = (filepath: string, code: string) =>
    ts.createSourceFile(
        filepath,
        code,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

const normalizeFilepath = (value: string) => path.resolve(value).replace(/\\/g, '/');

const getNodeText = (sourceFile: ts.SourceFile, node: ts.Node) =>
    sourceFile.text.slice(node.getStart(sourceFile), node.getEnd());

const routeModuleExtensions = ['.ts', '.tsx', '.js', '.jsx'];

const resolveRouteImport = (sourceFilepath: string, moduleSpecifier: string, routeSourceFilepaths?: Set<string>) => {
    if (!routeSourceFilepaths || !moduleSpecifier.startsWith('.')) return undefined;

    const absoluteBasePath = path.resolve(path.dirname(sourceFilepath), moduleSpecifier);
    const candidates = [
        absoluteBasePath,
        ...routeModuleExtensions.map((extension) => absoluteBasePath + extension),
        ...routeModuleExtensions.map((extension) => path.join(absoluteBasePath, `index${extension}`)),
    ];

    return candidates.find((candidate) => routeSourceFilepaths.has(normalizeFilepath(candidate)));
};

const addImportedService = (importedServices: TImportedService[], importedName: string, localName: string) => {
    if (
        importedServices.some(
            (importedService) =>
                importedService.importedName === importedName && importedService.localName === localName,
        )
    ) {
        return;
    }

    importedServices.push({ importedName, localName });
};

const collectImportedServices = (
    sourceFile: ts.SourceFile,
    side: TRouteSide,
    stripRanges: Array<{ start: number; end: number }>,
) => {
    const importedServices: TImportedService[] = [];

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!statement.importClause) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const source = statement.moduleSpecifier.text;
        const isClientRouterImport = side === 'client' && clientRouterImportSources.has(source);

        if (source !== '@app' && !isClientRouterImport) continue;

        if (isClientRouterImport && statement.importClause.name) {
            addImportedService(importedServices, 'Router', statement.importClause.name.text);
        }

        for (const specifier of statement.importClause.namedBindings
            ? ts.isNamedImports(statement.importClause.namedBindings)
                ? statement.importClause.namedBindings.elements
                : []
            : []) {
            addImportedService(
                importedServices,
                specifier.propertyName?.text || specifier.name.text,
                specifier.name.text,
            );
        }

        stripRanges.push({ start: statement.getStart(sourceFile), end: statement.getEnd() });
    }

    return importedServices;
};

const collectNestedRouteImports = (
    sourceFile: ts.SourceFile,
    sourceFilepath: string,
    routeSourceFilepaths: Set<string> | undefined,
    stripRanges: Array<{ start: number; end: number }>,
) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (statement.importClause) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const routeImportPath = resolveRouteImport(
            sourceFilepath,
            statement.moduleSpecifier.text,
            routeSourceFilepaths,
        );

        if (!routeImportPath) continue;

        stripRanges.push({ start: statement.getStart(sourceFile), end: statement.getEnd() });
    }
};

const collectRouteDefinitions = (
    sourceFile: ts.SourceFile,
    importedServices: TImportedService[],
    stripRanges: Array<{ start: number; end: number }>,
) => {
    const importedServiceNames = new Set(importedServices.map((importedService) => importedService.localName));
    const definitions: TRouteDefinition[] = [];

    for (const statement of sourceFile.statements) {
        if (!ts.isExpressionStatement(statement)) continue;
        if (!ts.isCallExpression(statement.expression)) continue;
        if (!ts.isPropertyAccessExpression(statement.expression.expression)) continue;

        const callee = statement.expression.expression;
        if (!ts.isIdentifier(callee.expression)) continue;
        if (!routerMethods.has(callee.name.text)) continue;
        if (!importedServiceNames.has(callee.expression.text)) continue;

        definitions.push({
            args: statement.expression.arguments,
            methodName: callee.name.text,
            serviceLocalName: callee.expression.text,
        });

        stripRanges.push({ start: statement.getStart(sourceFile), end: statement.getEnd() });
    }

    return definitions;
};

const buildRemainingSource = (sourceFile: ts.SourceFile, stripRanges: Array<{ start: number; end: number }>) => {
    const sortedRanges = stripRanges.sort((a, b) => a.start - b.start);
    const chunks: string[] = [];
    let cursor = 0;

    for (const range of sortedRanges) {
        if (cursor < range.start) chunks.push(sourceFile.text.slice(cursor, range.start));
        cursor = Math.max(cursor, range.end);
    }

    if (cursor < sourceFile.text.length) {
        chunks.push(sourceFile.text.slice(cursor));
    }

    return chunks.join('').trim();
};

const normalizeRelativeImportPath = (value: string) => (value.startsWith('.') ? value : `./${value}`);

const rebaseRelativeModuleSpecifiers = (code: string, outputFilepath: string, sourceFilepath: string) => {
    const outputDir = path.dirname(outputFilepath);
    const sourceDir = path.dirname(sourceFilepath);
    const sourceFile = parseSourceFile(outputFilepath, code);
    const replacements: Array<{ start: number; end: number; value: string }> = [];

    const addReplacement = (literal: ts.StringLiteralLike) => {
        if (!literal.text.startsWith('.')) return;

        const absoluteTarget = path.resolve(sourceDir, literal.text);
        const nextRelativePath = normalizeRelativeImportPath(
            path.relative(outputDir, absoluteTarget).replace(/\\/g, '/'),
        );

        replacements.push({
            start: literal.getStart(sourceFile),
            end: literal.getEnd(),
            value: JSON.stringify(nextRelativePath),
        });
    };

    const visit = (node: ts.Node) => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            addReplacement(node.moduleSpecifier);
        }

        if (
            ts.isCallExpression(node) &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0]) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
            addReplacement(node.arguments[0]);
        }

        if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
        ) {
            addReplacement(node.argument.literal);
        }

        ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    return replacements
        .sort((a, b) => b.start - a.start)
        .reduce(
            (currentCode, replacement) =>
                currentCode.slice(0, replacement.start) + replacement.value + currentCode.slice(replacement.end),
            code,
        );
};

const buildDestructuring = (importedServices: TImportedService[]) => {
    const parts = importedServices.map(({ importedName, localName }) =>
        importedName === localName ? importedName : `${importedName}: ${localName}`,
    );

    return `const { ${parts.join(', ')} } = app;`;
};

const buildClientRegisterArgs = (
    sourceFile: ts.SourceFile,
    definition: TRouteDefinition,
    clientRoute: TGeneratedClientRouteModuleOptions,
) => {
    const [, ...routeArgs] = [...definition.args];
    const injectedOptions = `{ id: ${JSON.stringify(clientRoute.chunkId)}, filepath: ${JSON.stringify(clientRoute.filepath)} }`;

    if (routeArgs.length === 1) {
        return [injectedOptions, getNodeText(sourceFile, routeArgs[0])];
    }

    if (routeArgs.length === 2) {
        if (ts.isObjectLiteralExpression(routeArgs[0])) {
            return [
                `{ ...(${getNodeText(sourceFile, routeArgs[0])}), id: ${JSON.stringify(clientRoute.chunkId)}, filepath: ${JSON.stringify(clientRoute.filepath)} }`,
                getNodeText(sourceFile, routeArgs[1]),
            ];
        }

        return [injectedOptions, getNodeText(sourceFile, routeArgs[0]), getNodeText(sourceFile, routeArgs[1])];
    }

    if (routeArgs.length === 3 && ts.isObjectLiteralExpression(routeArgs[0])) {
        return [
            `{ ...(${getNodeText(sourceFile, routeArgs[0])}), id: ${JSON.stringify(clientRoute.chunkId)}, filepath: ${JSON.stringify(clientRoute.filepath)} }`,
            getNodeText(sourceFile, routeArgs[1]),
            getNodeText(sourceFile, routeArgs[2]),
        ];
    }

    throw new Error(
        `Unsupported client route signature in ${sourceFile.fileName}. Expected Router.page/error with 2-4 arguments.`,
    );
};

const buildRegisterStatements = (
    sourceFile: ts.SourceFile,
    side: TRouteSide,
    definitions: TRouteDefinition[],
    clientRoute?: TGeneratedClientRouteModuleOptions,
) => {
    if (side === 'client') {
        if (!clientRoute) {
            throw new Error(`Missing client route metadata for ${sourceFile.fileName}.`);
        }

        if (definitions.length !== 1) {
            throw new Error(
                `Frontend route definition files can contain only one route definition. ${definitions.length} were found in ${sourceFile.fileName}.`,
            );
        }

        const definition = definitions[0];
        const [routePath, ...routeArgs] = [...definition.args];
        const finalArgs = [
            getNodeText(sourceFile, routePath),
            ...buildClientRegisterArgs(sourceFile, definition, clientRoute),
        ];

        return [`return ${definition.serviceLocalName}.${definition.methodName}(${finalArgs.join(', ')});`];
    }

    return definitions.map((definition) => {
        const args = [...definition.args].map((arg) => getNodeText(sourceFile, arg));

        return `${definition.serviceLocalName}.${definition.methodName}(${args.join(', ')});`;
    });
};

export const getGeneratedRouteModuleFilepath = (generatedRoot: string, sourceRoot: string, sourceFilepath: string) =>
    path.join(generatedRoot, 'route-modules', path.relative(sourceRoot, sourceFilepath));

export const writeGeneratedRouteModule = ({
    outputFilepath,
    runtime,
    side,
    sourceFilepath,
    clientRoute,
    routeSourceFilepaths,
}: TWriteGeneratedRouteModuleOptions) => {
    const code = fs.readFileSync(sourceFilepath, 'utf8');
    const sourceFile = parseSourceFile(sourceFilepath, code);
    const stripRanges: Array<{ start: number; end: number }> = [];
    const importedServices = collectImportedServices(sourceFile, side, stripRanges);
    collectNestedRouteImports(sourceFile, sourceFilepath, routeSourceFilepaths, stripRanges);
    const definitions = collectRouteDefinitions(sourceFile, importedServices, stripRanges);

    if (definitions.length === 0) {
        throw new Error(`No route definitions were found in ${sourceFilepath}.`);
    }

    const remainingSource = rebaseRelativeModuleSpecifiers(
        buildRemainingSource(sourceFile, stripRanges),
        outputFilepath,
        sourceFilepath,
    );
    const registerStatements = buildRegisterStatements(sourceFile, side, definitions, clientRoute);
    const runtimeAppImportPath = runtime === 'client' ? '@/client/index' : '@/server/.generated/app';

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from ${path.relative(process.cwd(), sourceFilepath).replace(/\\/g, '/')}.
// Do not edit it manually.

import type __GeneratedRouteApp from ${JSON.stringify(runtimeAppImportPath)};

${remainingSource}
${remainingSource ? '\n' : ''}export const __register = (app: __GeneratedRouteApp) => {
  ${buildDestructuring(importedServices)}
  ${registerStatements.join('\n  ')}
};
`;

    return writeIfChanged(outputFilepath, content);
};
