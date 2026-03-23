import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';

import { getRouteSetupOptionKey } from '../../../common/router/pageSetup';
import writeIfChanged from '../writeIfChanged';

type TRouteSide = 'client' | 'server';
type TRouteRuntime = 'client' | 'server';
export type TIndexedSourceLocation = { line: number; column: number };
export type TIndexedRouteTargetResolution = 'literal' | 'static-expression' | 'dynamic-expression';

type TImportedService = { importedName: string; localName: string };

type TRouteDefinition = {
    args: ts.NodeArray<ts.Expression>;
    methodName: string;
    serviceLocalName: string;
    callExpression: ts.CallExpression;
};

export type TIndexedRouteDefinition = {
    methodName: string;
    serviceLocalName: string;
    sourceLocation: TIndexedSourceLocation;
    targetResolution: TIndexedRouteTargetResolution;
    path?: string;
    pathRaw?: string;
    code?: number;
    codeRaw?: string;
    optionKeys: string[];
    normalizedOptionKeys: string[];
    invalidOptionKeys: string[];
    reservedOptionKeys: string[];
    optionsRaw?: string;
    hasSetup: boolean;
};

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

const getNodeLocation = (sourceFile: ts.SourceFile, node: ts.Node): TIndexedSourceLocation => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return { line: line + 1, column: character + 1 };
};

const getLiteralStringValue = (node: ts.Expression) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return undefined;
};

const getLiteralNumberValue = (node: ts.Expression) => {
    if (!ts.isNumericLiteral(node)) return undefined;

    const value = Number(node.text);

    return Number.isFinite(value) ? value : undefined;
};

const getObjectLiteralPropertyKey = (name: ts.PropertyName) => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return undefined;
    return undefined;
};

const getObjectLiteralPropertyKeys = (node: ts.ObjectLiteralExpression) =>
    node.properties.flatMap((property) => {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const key = getObjectLiteralPropertyKey(property.name);
            return key ? [key] : [];
        }

        if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
            const key = getObjectLiteralPropertyKey(property.name);
            return key ? [key] : [];
        }

        return [];
    });

const tryEvaluateStaticExpression = (
    node: ts.Expression,
    bindingInitializers: Map<string, ts.Expression>,
    resolvedBindings: Map<string, string | number | undefined>,
    activeBindings = new Set<string>(),
): string | number | undefined => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

    if (ts.isNumericLiteral(node)) {
        const value = Number(node.text);
        return Number.isFinite(value) ? value : undefined;
    }

    if (ts.isParenthesizedExpression(node)) {
        return tryEvaluateStaticExpression(node.expression, bindingInitializers, resolvedBindings, activeBindings);
    }

    if (ts.isIdentifier(node)) {
        if (resolvedBindings.has(node.text)) return resolvedBindings.get(node.text);

        const initializer = bindingInitializers.get(node.text);
        if (!initializer || activeBindings.has(node.text)) return undefined;

        activeBindings.add(node.text);
        const value = tryEvaluateStaticExpression(initializer, bindingInitializers, resolvedBindings, activeBindings);
        activeBindings.delete(node.text);
        resolvedBindings.set(node.text, value);

        return value;
    }

    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const operand = tryEvaluateStaticExpression(node.operand, bindingInitializers, resolvedBindings, activeBindings);
        return typeof operand === 'number' ? -operand : undefined;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = tryEvaluateStaticExpression(node.left, bindingInitializers, resolvedBindings, activeBindings);
        const right = tryEvaluateStaticExpression(node.right, bindingInitializers, resolvedBindings, activeBindings);

        if (left === undefined || right === undefined) return undefined;

        if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
        if (typeof left === 'number' && typeof right === 'number') return left + right;

        return undefined;
    }

    if (ts.isTemplateExpression(node)) {
        let output = node.head.text;

        for (const span of node.templateSpans) {
            const value = tryEvaluateStaticExpression(span.expression, bindingInitializers, resolvedBindings, activeBindings);
            if (value === undefined) return undefined;

            output += String(value) + span.literal.text;
        }

        return output;
    }

    return undefined;
};

const collectStaticBindings = (sourceFile: ts.SourceFile) => {
    const bindingInitializers = new Map<string, ts.Expression>();
    const resolvedBindings = new Map<string, string | number | undefined>();

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

            bindingInitializers.set(declaration.name.text, declaration.initializer);
        }
    }

    for (const bindingName of bindingInitializers.keys()) {
        if (resolvedBindings.has(bindingName)) continue;

        const initializer = bindingInitializers.get(bindingName);
        if (!initializer) continue;

        resolvedBindings.set(
            bindingName,
            tryEvaluateStaticExpression(initializer, bindingInitializers, resolvedBindings, new Set([bindingName])),
        );
    }

    return resolvedBindings;
};

const getRouteOptionMetadata = (node: ts.ObjectLiteralExpression | undefined) => {
    const optionKeys = node ? getObjectLiteralPropertyKeys(node) : [];
    const normalizedOptionKeys: string[] = [];
    const invalidOptionKeys: string[] = [];
    const reservedOptionKeys: string[] = [];

    for (const optionKey of optionKeys) {
        try {
            const normalizedOptionKey = getRouteSetupOptionKey(optionKey);

            if (normalizedOptionKey) {
                normalizedOptionKeys.push(normalizedOptionKey);
                continue;
            }

            invalidOptionKeys.push(optionKey);
        } catch (error) {
            reservedOptionKeys.push(optionKey);
        }
    }

    return { optionKeys, normalizedOptionKeys, invalidOptionKeys, reservedOptionKeys };
};

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
            callExpression: statement.expression,
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

const getClientRouteSignature = (sourceFile: ts.SourceFile, definition: TRouteDefinition) => {
    const [, ...routeArgs] = [...definition.args];

    if (routeArgs.length === 1) {
        return { hasSetup: false, renderArg: routeArgs[0] };
    }

    if (routeArgs.length === 2) {
        if (ts.isObjectLiteralExpression(routeArgs[0])) {
            return { hasSetup: false, optionsArg: routeArgs[0], renderArg: routeArgs[1] };
        }

        return { hasSetup: true, setupArg: routeArgs[0], renderArg: routeArgs[1] };
    }

    if (routeArgs.length === 3 && ts.isObjectLiteralExpression(routeArgs[0])) {
        return {
            hasSetup: true,
            optionsArg: routeArgs[0],
            setupArg: routeArgs[1],
            renderArg: routeArgs[2],
        };
    }

    throw new Error(
        `Unsupported client route signature in ${sourceFile.fileName}. Expected Router.page/error with 2-4 arguments.`,
    );
};

const buildClientRegisterArgs = (
    sourceFile: ts.SourceFile,
    definition: TRouteDefinition,
    clientRoute: TGeneratedClientRouteModuleOptions,
) => {
    const { optionsArg, setupArg, renderArg } = getClientRouteSignature(sourceFile, definition);
    const injectedOptions = `{ id: ${JSON.stringify(clientRoute.chunkId)}, filepath: ${JSON.stringify(clientRoute.filepath)} }`;

    if (!optionsArg && !setupArg) {
        return [injectedOptions, getNodeText(sourceFile, renderArg)];
    }

    if (optionsArg && !setupArg) {
        return [
            `{ ...(${getNodeText(sourceFile, optionsArg)}), id: ${JSON.stringify(clientRoute.chunkId)}, filepath: ${JSON.stringify(clientRoute.filepath)} }`,
            getNodeText(sourceFile, renderArg),
        ];
    }

    if (!optionsArg && setupArg) {
        return [injectedOptions, getNodeText(sourceFile, setupArg), getNodeText(sourceFile, renderArg)];
    }

    return [
        `{ ...(${getNodeText(sourceFile, optionsArg!)}), id: ${JSON.stringify(clientRoute.chunkId)}, filepath: ${JSON.stringify(clientRoute.filepath)} }`,
        getNodeText(sourceFile, setupArg!),
        getNodeText(sourceFile, renderArg),
    ];
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

export const indexRouteDefinitions = ({ side, sourceFilepath }: { side: TRouteSide; sourceFilepath: string }) => {
    const code = fs.readFileSync(sourceFilepath, 'utf8');
    const sourceFile = parseSourceFile(sourceFilepath, code);
    const stripRanges: Array<{ start: number; end: number }> = [];
    const importedServices = collectImportedServices(sourceFile, side, stripRanges);
    const definitions = collectRouteDefinitions(sourceFile, importedServices, stripRanges);
    const staticBindings = collectStaticBindings(sourceFile);

    if (definitions.length === 0) {
        throw new Error(`No route definitions were found in ${sourceFilepath}.`);
    }

    if (side === 'client' && definitions.length !== 1) {
        throw new Error(
            `Frontend route definition files can contain only one route definition. ${definitions.length} were found in ${sourceFilepath}.`,
        );
    }

    return definitions.map<TIndexedRouteDefinition>((definition) => {
        const sourceLocation = getNodeLocation(sourceFile, definition.callExpression);
        const resolveStaticValue = (node: ts.Expression) => tryEvaluateStaticExpression(node, new Map(), staticBindings);

        if (side === 'client') {
            const targetArg = definition.args[0];
            const clientSignature = getClientRouteSignature(sourceFile, definition);
            const optionMetadata = getRouteOptionMetadata(clientSignature.optionsArg);
            const resolvedStaticValue = resolveStaticValue(targetArg);

            return definition.methodName === 'error'
                ? {
                      methodName: definition.methodName,
                      serviceLocalName: definition.serviceLocalName,
                      sourceLocation,
                      targetResolution:
                          getLiteralNumberValue(targetArg) !== undefined
                              ? 'literal'
                              : typeof resolvedStaticValue === 'number'
                                ? 'static-expression'
                                : 'dynamic-expression',
                      code:
                          getLiteralNumberValue(targetArg) ??
                          (typeof resolvedStaticValue === 'number' ? resolvedStaticValue : undefined),
                      codeRaw: getNodeText(sourceFile, targetArg),
                      optionKeys: optionMetadata.optionKeys,
                      normalizedOptionKeys: optionMetadata.normalizedOptionKeys,
                      invalidOptionKeys: optionMetadata.invalidOptionKeys,
                      reservedOptionKeys: optionMetadata.reservedOptionKeys,
                      optionsRaw: clientSignature.optionsArg
                          ? getNodeText(sourceFile, clientSignature.optionsArg)
                          : undefined,
                      hasSetup: clientSignature.hasSetup,
                  }
                : {
                      methodName: definition.methodName,
                      serviceLocalName: definition.serviceLocalName,
                      sourceLocation,
                      targetResolution:
                          getLiteralStringValue(targetArg) !== undefined
                              ? 'literal'
                              : typeof resolvedStaticValue === 'string'
                                ? 'static-expression'
                                : 'dynamic-expression',
                      path:
                          getLiteralStringValue(targetArg) ??
                          (typeof resolvedStaticValue === 'string' ? resolvedStaticValue : undefined),
                      pathRaw: getNodeText(sourceFile, targetArg),
                      optionKeys: optionMetadata.optionKeys,
                      normalizedOptionKeys: optionMetadata.normalizedOptionKeys,
                      invalidOptionKeys: optionMetadata.invalidOptionKeys,
                      reservedOptionKeys: optionMetadata.reservedOptionKeys,
                      optionsRaw: clientSignature.optionsArg
                          ? getNodeText(sourceFile, clientSignature.optionsArg)
                          : undefined,
                      hasSetup: clientSignature.hasSetup,
                  };
        }

        const targetArg = definition.args[0];
        const optionsArg =
            definition.args.length >= 3 && ts.isObjectLiteralExpression(definition.args[1])
                ? definition.args[1]
                : undefined;
        const optionMetadata = getRouteOptionMetadata(optionsArg);
        const resolvedPath = getLiteralStringValue(targetArg) ?? resolveStaticValue(targetArg);

        return {
            methodName: definition.methodName,
            serviceLocalName: definition.serviceLocalName,
            sourceLocation,
            targetResolution:
                getLiteralStringValue(targetArg) !== undefined
                    ? 'literal'
                    : typeof resolvedPath === 'string'
                      ? 'static-expression'
                      : 'dynamic-expression',
            path: typeof resolvedPath === 'string' ? resolvedPath : undefined,
            pathRaw: getNodeText(sourceFile, targetArg),
            optionKeys: optionMetadata.optionKeys,
            normalizedOptionKeys: optionMetadata.normalizedOptionKeys,
            invalidOptionKeys: optionMetadata.invalidOptionKeys,
            reservedOptionKeys: optionMetadata.reservedOptionKeys,
            optionsRaw: optionsArg ? getNodeText(sourceFile, optionsArg) : undefined,
            hasSetup: false,
        };
    });
};

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
    const runtimeAppImportPath = runtime === 'client' ? '@/client/index' : '@/server/index';

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
