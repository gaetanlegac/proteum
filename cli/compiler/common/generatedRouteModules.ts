import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';

import { getRouteOptionKey } from '../../../common/router/pageData';
import writeIfChanged from '../writeIfChanged';

type TRouteSide = 'client' | 'server';
type TRouteRuntime = 'client' | 'server';
export type TIndexedSourceLocation = { line: number; column: number };
export type TIndexedRouteTargetResolution = 'literal' | 'static-expression' | 'dynamic-expression';

type TExplicitRouteDefinition = {
    methodName: string;
    sourceLocation: TIndexedSourceLocation;
    targetExpression: ts.Expression;
    optionsExpression?: ts.Expression;
    optionsArg?: ts.ObjectLiteralExpression;
    hasData: boolean;
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
    hasData: boolean;
};

type TGeneratedClientRouteModuleOptions = { chunkId: string };

type TWriteGeneratedRouteModuleOptions = {
    outputFilepath: string;
    runtime: TRouteRuntime;
    side: TRouteSide;
    sourceFilepath: string;
    clientRoute?: TGeneratedClientRouteModuleOptions;
};

const legacyRouterMethods = new Set(['page', 'error', 'all', 'options', 'get', 'post', 'put', 'delete', 'patch', 'express']);
const routeDefinitionHelpers = new Set([
    'definePageRoute',
    'defineErrorRoute',
    'defineServerRoute',
    'defineServerRoutes',
]);
const serverRouteMethods = new Set(['*', 'all', 'options', 'get', 'post', 'put', 'patch', 'delete']);

const parseSourceFile = (filepath: string, code: string) =>
    ts.createSourceFile(
        filepath,
        code,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

const parsedSourceFileCache = new Map<string, ts.SourceFile | null>();

const normalizeFilepath = (value: string) => path.resolve(value).replace(/\\/g, '/');

const resolveExistingModuleFilepath = (baseFilepath: string) => {
    const candidates = [
        baseFilepath,
        `${baseFilepath}.ts`,
        `${baseFilepath}.tsx`,
        `${baseFilepath}.js`,
        `${baseFilepath}.jsx`,
        path.join(baseFilepath, 'index.ts'),
        path.join(baseFilepath, 'index.tsx'),
        path.join(baseFilepath, 'index.js'),
        path.join(baseFilepath, 'index.jsx'),
    ];

    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
};

const getAppRootFromSourceFile = (sourceFilepath: string) => {
    const normalized = normalizeFilepath(sourceFilepath);
    const markers = ['/client/', '/server/', '/common/', '/commands/'];
    const markerIndex = markers
        .map((marker) => ({ marker, index: normalized.indexOf(marker) }))
        .filter(({ index }) => index >= 0)
        .sort((left, right) => left.index - right.index)[0];

    return markerIndex ? normalized.slice(0, markerIndex.index) : path.dirname(sourceFilepath);
};

const resolveStaticImportFilepath = (sourceFile: ts.SourceFile, moduleSpecifier: string) => {
    if (moduleSpecifier.startsWith('.')) {
        return resolveExistingModuleFilepath(path.resolve(path.dirname(sourceFile.fileName), moduleSpecifier));
    }

    const appRoot = getAppRootFromSourceFile(sourceFile.fileName);
    const aliases: Array<[string, string]> = [
        ['@/', appRoot],
        ['@client/', path.join(appRoot, 'client')],
        ['@server/', path.join(appRoot, 'server')],
        ['@common/', path.join(appRoot, 'common')],
    ];

    for (const [prefix, root] of aliases) {
        if (!moduleSpecifier.startsWith(prefix)) continue;

        const relativeImport = moduleSpecifier.slice(prefix.length);
        return resolveExistingModuleFilepath(path.join(root, relativeImport));
    }

    return undefined;
};

const readStaticImportSourceFile = (filepath: string) => {
    const normalized = normalizeFilepath(filepath);
    if (parsedSourceFileCache.has(normalized)) return parsedSourceFileCache.get(normalized) || undefined;

    if (!fs.existsSync(normalized)) {
        parsedSourceFileCache.set(normalized, null);
        return undefined;
    }

    const sourceFile = parseSourceFile(normalized, fs.readFileSync(normalized, 'utf8'));
    parsedSourceFileCache.set(normalized, sourceFile);

    return sourceFile;
};

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
    const expression = unwrapStaticExpression(node);
    const resolvedExpression = resolveStaticExpressionNode(expression, bindingInitializers, activeBindings);

    if (resolvedExpression !== expression) {
        return tryEvaluateStaticExpression(resolvedExpression, bindingInitializers, resolvedBindings, activeBindings);
    }

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;

    if (ts.isNumericLiteral(expression)) {
        const value = Number(expression.text);
        return Number.isFinite(value) ? value : undefined;
    }

    if (ts.isParenthesizedExpression(expression)) {
        return tryEvaluateStaticExpression(expression.expression, bindingInitializers, resolvedBindings, activeBindings);
    }

    if (ts.isIdentifier(expression)) {
        if (resolvedBindings.has(expression.text)) return resolvedBindings.get(expression.text);

        const initializer = bindingInitializers.get(expression.text);
        if (!initializer || activeBindings.has(expression.text)) return undefined;

        activeBindings.add(expression.text);
        const value = tryEvaluateStaticExpression(initializer, bindingInitializers, resolvedBindings, activeBindings);
        activeBindings.delete(expression.text);
        resolvedBindings.set(expression.text, value);

        return value;
    }

    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken) {
        const operand = tryEvaluateStaticExpression(expression.operand, bindingInitializers, resolvedBindings, activeBindings);
        return typeof operand === 'number' ? -operand : undefined;
    }

    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = tryEvaluateStaticExpression(expression.left, bindingInitializers, resolvedBindings, activeBindings);
        const right = tryEvaluateStaticExpression(expression.right, bindingInitializers, resolvedBindings, activeBindings);

        if (left === undefined || right === undefined) return undefined;

        if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
        if (typeof left === 'number' && typeof right === 'number') return left + right;

        return undefined;
    }

    if (ts.isTemplateExpression(expression)) {
        let output = expression.head.text;

        for (const span of expression.templateSpans) {
            const value = tryEvaluateStaticExpression(span.expression, bindingInitializers, resolvedBindings, activeBindings);
            if (value === undefined) return undefined;

            output += String(value) + span.literal.text;
        }

        return output;
    }

    return undefined;
};

const unwrapStaticExpression = (node: ts.Expression): ts.Expression => {
    if (ts.isParenthesizedExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isAsExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isTypeAssertionExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isSatisfiesExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isNonNullExpression(node)) return unwrapStaticExpression(node.expression);

    return node;
};

const getStaticPropertyName = (node: ts.PropertyName | ts.Expression) => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    return undefined;
};

const getStaticObjectPropertyInitializer = (node: ts.ObjectLiteralExpression, propertyName: string) => {
    for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
            const key = getObjectLiteralPropertyKey(property.name);
            if (key === propertyName) return property.initializer;
            continue;
        }

        if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
            return property.name;
        }
    }

    return undefined;
};

const resolveStaticExpressionNode = (
    node: ts.Expression,
    bindingInitializers: Map<string, ts.Expression>,
    activeBindings = new Set<string>(),
): ts.Expression => {
    const expression = unwrapStaticExpression(node);

    if (ts.isIdentifier(expression)) {
        const initializer = bindingInitializers.get(expression.text);
        if (!initializer || activeBindings.has(expression.text)) return expression;

        activeBindings.add(expression.text);
        const resolved = resolveStaticExpressionNode(initializer, bindingInitializers, activeBindings);
        activeBindings.delete(expression.text);

        return resolved;
    }

    if (ts.isPropertyAccessExpression(expression)) {
        const container = resolveStaticExpressionNode(expression.expression, bindingInitializers, activeBindings);
        const unwrappedContainer = unwrapStaticExpression(container);
        if (!ts.isObjectLiteralExpression(unwrappedContainer)) return expression;

        const initializer = getStaticObjectPropertyInitializer(unwrappedContainer, expression.name.text);
        return initializer ? resolveStaticExpressionNode(initializer, bindingInitializers, activeBindings) : expression;
    }

    if (ts.isElementAccessExpression(expression)) {
        const argument = expression.argumentExpression && unwrapStaticExpression(expression.argumentExpression);
        const propertyName = argument && getStaticPropertyName(argument);
        if (!propertyName) return expression;

        const container = resolveStaticExpressionNode(expression.expression, bindingInitializers, activeBindings);
        const unwrappedContainer = unwrapStaticExpression(container);
        if (!ts.isObjectLiteralExpression(unwrappedContainer)) return expression;

        const initializer = getStaticObjectPropertyInitializer(unwrappedContainer, propertyName);
        return initializer ? resolveStaticExpressionNode(initializer, bindingInitializers, activeBindings) : expression;
    }

    return expression;
};

const isStaticSerializableExpression = (
    node: ts.Expression,
    bindingInitializers: Map<string, ts.Expression>,
    resolvedBindings: Map<string, string | number | undefined>,
    activeBindings = new Set<string>(),
): boolean => {
    const expression = unwrapStaticExpression(node);
    const resolvedExpression = resolveStaticExpressionNode(expression, bindingInitializers, activeBindings);

    if (resolvedExpression !== expression) {
        return isStaticSerializableExpression(resolvedExpression, bindingInitializers, resolvedBindings, activeBindings);
    }

    if (
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression) ||
        ts.isNumericLiteral(expression) ||
        expression.kind === ts.SyntaxKind.TrueKeyword ||
        expression.kind === ts.SyntaxKind.FalseKeyword ||
        expression.kind === ts.SyntaxKind.NullKeyword
    ) {
        return true;
    }

    if (
        ts.isPrefixUnaryExpression(expression) ||
        ts.isBinaryExpression(expression) ||
        ts.isTemplateExpression(expression)
    ) {
        return tryEvaluateStaticExpression(expression, bindingInitializers, resolvedBindings) !== undefined;
    }

    if (ts.isIdentifier(expression)) {
        if (activeBindings.has(expression.text)) return false;

        const initializer = bindingInitializers.get(expression.text);
        if (!initializer) return false;

        activeBindings.add(expression.text);
        const isStatic = isStaticSerializableExpression(initializer, bindingInitializers, resolvedBindings, activeBindings);
        activeBindings.delete(expression.text);

        return isStatic;
    }

    if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.every((element) => {
            if (ts.isSpreadElement(element)) return false;

            return isStaticSerializableExpression(element, bindingInitializers, resolvedBindings, activeBindings);
        });
    }

    if (ts.isObjectLiteralExpression(expression)) {
        return expression.properties.every((property) => {
            if (ts.isPropertyAssignment(property)) {
                if (ts.isComputedPropertyName(property.name)) return false;

                return isStaticSerializableExpression(
                    property.initializer,
                    bindingInitializers,
                    resolvedBindings,
                    activeBindings,
                );
            }

            if (ts.isShorthandPropertyAssignment(property)) {
                return isStaticSerializableExpression(
                    property.name,
                    bindingInitializers,
                    resolvedBindings,
                    activeBindings,
                );
            }

            return false;
        });
    }

    return false;
};

const assertStaticSerializableMetadata = (
    sourceFile: ts.SourceFile,
    expression: ts.Expression,
    label: string,
    bindingInitializers: Map<string, ts.Expression>,
    resolvedBindings: Map<string, string | number | undefined>,
) => {
    if (isStaticSerializableExpression(expression, bindingInitializers, resolvedBindings)) return;

    const location = getNodeLocation(sourceFile, expression);
    throw new Error(
        `${sourceFile.fileName}:${location.line}:${location.column} ${label} must be a serializable static literal or const-only expression. Runtime app, request, service, import, function, and property references are only allowed inside data/render/handler callbacks.`,
    );
};

const resolveStaticBindings = (bindingInitializers: Map<string, ts.Expression>) => {
    const resolvedBindings = new Map<string, string | number | undefined>();

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

const collectStaticBindings = (sourceFile: ts.SourceFile) =>
    resolveStaticBindings(collectStaticBindingInitializers(sourceFile));

const collectExportedStaticBindingInitializers = (sourceFile: ts.SourceFile) => {
    const bindingInitializers = new Map<string, ts.Expression>();

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

            bindingInitializers.set(declaration.name.text, declaration.initializer);
        }
    }

    return bindingInitializers;
};

const collectImportedStaticBindingInitializers = (
    sourceFile: ts.SourceFile,
    visitedFiles = new Set<string>([normalizeFilepath(sourceFile.fileName)]),
) => {
    const bindingInitializers = new Map<string, ts.Expression>();

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const namedBindings = statement.importClause?.namedBindings;
        if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

        const importedFilepath = resolveStaticImportFilepath(sourceFile, statement.moduleSpecifier.text);
        if (!importedFilepath) continue;

        const normalizedImportFilepath = normalizeFilepath(importedFilepath);
        if (visitedFiles.has(normalizedImportFilepath)) continue;

        const importedSourceFile = readStaticImportSourceFile(normalizedImportFilepath);
        if (!importedSourceFile) continue;

        const exportedInitializers = collectExportedStaticBindingInitializers(importedSourceFile);
        for (const element of namedBindings.elements) {
            const importedName = element.propertyName?.text || element.name.text;
            const initializer = exportedInitializers.get(importedName);
            if (!initializer) continue;

            bindingInitializers.set(element.name.text, initializer);
        }
    }

    return bindingInitializers;
};

const collectStatementStaticBindingInitializers = (
    statements: readonly ts.Statement[],
    bindingInitializers = new Map<string, ts.Expression>(),
) => {
    for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

            bindingInitializers.set(declaration.name.text, declaration.initializer);
        }
    }

    return bindingInitializers;
};

const collectStaticBindingInitializers = (sourceFile: ts.SourceFile) =>
    collectStatementStaticBindingInitializers(sourceFile.statements, collectImportedStaticBindingInitializers(sourceFile));

const getPropertyAssignment = (node: ts.ObjectLiteralExpression, propertyName: string) => {
    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        const key = getObjectLiteralPropertyKey(property.name);
        if (key === propertyName) return property.initializer;
    }

    return undefined;
};

const getCallExpressionName = (node: ts.Expression) => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return undefined;
};

const collectServerRouteDefinitionExpressions = (routesArg: ts.Expression | undefined) => {
    if (!routesArg) return undefined;

    if (ts.isArrayLiteralExpression(routesArg)) return [...routesArg.elements];

    if (!(ts.isArrowFunction(routesArg) || ts.isFunctionExpression(routesArg))) return undefined;

    if (ts.isArrayLiteralExpression(routesArg.body)) return [...routesArg.body.elements];
    if (!ts.isBlock(routesArg.body)) return undefined;

    const routeExpressions: ts.Expression[] = [];

    for (const statement of routesArg.body.statements) {
        if (!ts.isExpressionStatement(statement)) continue;
        if (!ts.isCallExpression(statement.expression)) continue;
        if (!ts.isPropertyAccessExpression(statement.expression.expression)) continue;
        if (statement.expression.expression.name.text !== 'push') continue;

        for (const argument of statement.expression.arguments) {
            const unwrappedArgument = unwrapStaticExpression(argument);
            if (!ts.isCallExpression(unwrappedArgument)) continue;

            const helperName = getCallExpressionName(unwrappedArgument.expression);
            if (helperName === 'defineServerRoute') routeExpressions.push(unwrappedArgument);
        }
    }

    return routeExpressions.length > 0 ? routeExpressions : undefined;
};

const resolveIdentifierExpression = (
    expression: ts.Expression,
    sourceFile: ts.SourceFile,
): ts.Expression => {
    const bindingInitializers = collectStaticBindingInitializers(sourceFile);
    return resolveStaticExpressionNode(expression, bindingInitializers);
};

const getDefaultRouteDefinitionExpression = (sourceFile: ts.SourceFile) => {
    for (const statement of sourceFile.statements) {
        if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
            return resolveIdentifierExpression(statement.expression, sourceFile);
        }
    }

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (declaration.initializer) return declaration.initializer;
        }
    }

    return undefined;
};

const assertNoLegacyRouteMagic = (sourceFile: ts.SourceFile, side: TRouteSide) => {
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            const source = statement.moduleSpecifier.text;

            if (source === '@app') {
                const location = getNodeLocation(sourceFile, statement);
                throw new Error(
                    `${sourceFile.fileName}:${location.line}:${location.column} imports @app. Route modules must export define*Route definitions and receive app services through typed runtime callback context.`,
                );
            }
        }

        if (!ts.isExpressionStatement(statement)) continue;
        if (!ts.isCallExpression(statement.expression)) continue;
        if (!ts.isPropertyAccessExpression(statement.expression.expression)) continue;

        const callee = statement.expression.expression;
        if (!ts.isIdentifier(callee.expression)) continue;
        if (callee.expression.text !== 'Router') continue;
        if (!legacyRouterMethods.has(callee.name.text)) continue;

        const location = getNodeLocation(sourceFile, statement);
        throw new Error(
            `${sourceFile.fileName}:${location.line}:${location.column} uses top-level ${callee.expression.text}.${callee.name.text}(...). Route modules must export define*Route definitions instead.`,
        );
    }
};

const parseExplicitRouteCall = (
    sourceFile: ts.SourceFile,
    side: TRouteSide,
    node: ts.Expression,
    scopedStaticBindingInitializers?: Map<string, ts.Expression>,
): TExplicitRouteDefinition[] => {
    const expression = unwrapStaticExpression(resolveIdentifierExpression(node, sourceFile));
    const staticBindingInitializers = scopedStaticBindingInitializers || collectStaticBindingInitializers(sourceFile);
    const staticBindings = resolveStaticBindings(staticBindingInitializers);

    if (!ts.isCallExpression(expression)) {
        throw new Error(`Route module ${sourceFile.fileName} must default-export a define*Route(...) call.`);
    }

    const helperName = getCallExpressionName(expression.expression);
    if (!helperName || !routeDefinitionHelpers.has(helperName)) {
        throw new Error(`Route module ${sourceFile.fileName} must default-export a define*Route(...) call.`);
    }

    if (helperName === 'defineServerRoutes') {
        if (side !== 'server') {
            throw new Error(`Client route module ${sourceFile.fileName} cannot export defineServerRoutes(...).`);
        }

        const [routesArg] = [...expression.arguments];
        const routeExpressions = collectServerRouteDefinitionExpressions(routesArg);
        const routeBindingInitializers =
            routesArg && (ts.isArrowFunction(routesArg) || ts.isFunctionExpression(routesArg)) && ts.isBlock(routesArg.body)
                ? collectStatementStaticBindingInitializers(routesArg.body.statements, new Map(staticBindingInitializers))
                : staticBindingInitializers;

        if (!routeExpressions) {
            throw new Error(
                `defineServerRoutes(...) in ${sourceFile.fileName} must receive a static array literal, a factory returning one, or a factory that pushes defineServerRoute(...) entries into a local routes array.`,
            );
        }

        return routeExpressions.map((element) => parseExplicitRouteCall(sourceFile, side, element, routeBindingInitializers)).flat();
    }

    const [definitionArg] = [...expression.arguments];
    if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) {
        throw new Error(`${helperName}(...) in ${sourceFile.fileName} must receive an object literal.`);
    }

    const sourceLocation = getNodeLocation(sourceFile, expression);
    const optionsExpression = getPropertyAssignment(definitionArg, 'options');
    const resolvedOptionsExpression = optionsExpression
        ? unwrapStaticExpression(resolveStaticExpressionNode(optionsExpression, staticBindingInitializers))
        : undefined;
    const optionsArg =
        resolvedOptionsExpression && ts.isObjectLiteralExpression(resolvedOptionsExpression)
            ? resolvedOptionsExpression
            : undefined;

    if (optionsExpression) {
        assertStaticSerializableMetadata(
            sourceFile,
            optionsExpression,
            `${helperName} options`,
            staticBindingInitializers,
            staticBindings,
        );

        if (!optionsArg) {
            const location = getNodeLocation(sourceFile, optionsExpression);
            throw new Error(
                `${sourceFile.fileName}:${location.line}:${location.column} ${helperName} options must resolve to a static object literal.`,
            );
        }
    }

    if (helperName === 'definePageRoute') {
        if (side !== 'client') throw new Error(`Server route module ${sourceFile.fileName} cannot export definePageRoute(...).`);

        const pathExpression = getPropertyAssignment(definitionArg, 'path');
        const dataExpression = getPropertyAssignment(definitionArg, 'data');
        const renderExpression = getPropertyAssignment(definitionArg, 'render');
        if (!pathExpression) throw new Error(`definePageRoute(...) in ${sourceFile.fileName} is missing path.`);
        if (!optionsExpression) throw new Error(`definePageRoute(...) in ${sourceFile.fileName} is missing options.`);
        if (!dataExpression) throw new Error(`definePageRoute(...) in ${sourceFile.fileName} is missing data.`);
        if (!renderExpression) throw new Error(`definePageRoute(...) in ${sourceFile.fileName} is missing render.`);

        assertStaticSerializableMetadata(
            sourceFile,
            pathExpression,
            'definePageRoute path',
            staticBindingInitializers,
            staticBindings,
        );

        return [
            {
                methodName: 'page',
                sourceLocation,
                targetExpression: pathExpression,
                optionsExpression,
                optionsArg,
                hasData: dataExpression?.kind !== ts.SyntaxKind.NullKeyword,
            },
        ];
    }

    if (helperName === 'defineErrorRoute') {
        if (side !== 'client') throw new Error(`Server route module ${sourceFile.fileName} cannot export defineErrorRoute(...).`);

        const codeExpression = getPropertyAssignment(definitionArg, 'code');
        const renderExpression = getPropertyAssignment(definitionArg, 'render');
        if (!codeExpression) throw new Error(`defineErrorRoute(...) in ${sourceFile.fileName} is missing code.`);
        if (!optionsExpression) throw new Error(`defineErrorRoute(...) in ${sourceFile.fileName} is missing options.`);
        if (!renderExpression) throw new Error(`defineErrorRoute(...) in ${sourceFile.fileName} is missing render.`);

        assertStaticSerializableMetadata(
            sourceFile,
            codeExpression,
            'defineErrorRoute code',
            staticBindingInitializers,
            staticBindings,
        );

        return [
            {
                methodName: 'error',
                sourceLocation,
                targetExpression: codeExpression,
                optionsExpression,
                optionsArg,
                hasData: false,
            },
        ];
    }

    const methodExpression = getPropertyAssignment(definitionArg, 'method');
    const pathExpression = getPropertyAssignment(definitionArg, 'path');
    const handlerExpression = getPropertyAssignment(definitionArg, 'handler');
    if (!methodExpression) throw new Error(`defineServerRoute(...) in ${sourceFile.fileName} is missing method.`);
    if (!pathExpression) throw new Error(`defineServerRoute(...) in ${sourceFile.fileName} is missing path.`);
    if (!optionsExpression) throw new Error(`defineServerRoute(...) in ${sourceFile.fileName} is missing options.`);
    if (!handlerExpression) throw new Error(`defineServerRoute(...) in ${sourceFile.fileName} is missing handler.`);

    assertStaticSerializableMetadata(
        sourceFile,
        methodExpression,
        'defineServerRoute method',
        staticBindingInitializers,
        staticBindings,
    );
    assertStaticSerializableMetadata(
        sourceFile,
        pathExpression,
        'defineServerRoute path',
        staticBindingInitializers,
        staticBindings,
    );

    const methodName = tryEvaluateStaticExpression(
        methodExpression,
        staticBindingInitializers,
        staticBindings,
    );

    if (typeof methodName !== 'string') {
        throw new Error(`defineServerRoute(...) in ${sourceFile.fileName} must use a static string method.`);
    }

    const normalizedMethod = methodName === '*' ? 'all' : methodName.toLowerCase();
    if (!serverRouteMethods.has(normalizedMethod)) {
        throw new Error(`defineServerRoute(...) in ${sourceFile.fileName} uses unsupported method "${methodName}".`);
    }

    return [
        {
            methodName: normalizedMethod,
            sourceLocation,
            targetExpression: pathExpression,
            optionsExpression,
            optionsArg,
            hasData: false,
        },
    ];
};

const collectExplicitRouteDefinitions = (sourceFile: ts.SourceFile, side: TRouteSide) => {
    assertNoLegacyRouteMagic(sourceFile, side);

    const definitionExpression = getDefaultRouteDefinitionExpression(sourceFile);
    if (!definitionExpression) {
        throw new Error(`No route definition export was found in ${sourceFile.fileName}. Expected export default define*Route(...).`);
    }

    return parseExplicitRouteCall(sourceFile, side, definitionExpression);
};

const getRouteOptionMetadata = (node: ts.ObjectLiteralExpression | undefined) => {
    const optionKeys = node ? getObjectLiteralPropertyKeys(node) : [];
    const normalizedOptionKeys: string[] = [];
    const invalidOptionKeys: string[] = [];
    const reservedOptionKeys: string[] = [];

    for (const optionKey of optionKeys) {
        try {
            const normalizedOptionKey = getRouteOptionKey(optionKey);

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

const buildInjectedRouteMetadata = (sourceFilepath: string, sourceLocation: TIndexedSourceLocation, extra: string[] = []) =>
    `{ filepath: ${JSON.stringify(normalizeFilepath(sourceFilepath))}, sourceLocation: { line: ${sourceLocation.line}, column: ${sourceLocation.column} }${extra.length > 0 ? `, ${extra.join(', ')}` : ''} }`;

const normalizeRelativeImportPath = (value: string) => (value.startsWith('.') ? value : `./${value}`);

export const getGeneratedRouteModuleFilepath = (generatedRoot: string, sourceRoot: string, sourceFilepath: string) =>
    path.join(generatedRoot, 'route-modules', path.relative(sourceRoot, sourceFilepath));

const getSourceImportPath = (outputFilepath: string, sourceFilepath: string) =>
    normalizeRelativeImportPath(path.relative(path.dirname(outputFilepath), sourceFilepath).replace(/\\/g, '/')).replace(
        /\.(ts|tsx|js|jsx)$/,
        '',
    );

export const indexRouteDefinitions = ({ side, sourceFilepath }: { side: TRouteSide; sourceFilepath: string }) => {
    const code = fs.readFileSync(sourceFilepath, 'utf8');
    const sourceFile = parseSourceFile(sourceFilepath, code);
    const definitions = collectExplicitRouteDefinitions(sourceFile, side);
    const staticBindings = collectStaticBindings(sourceFile);
    const staticBindingInitializers = collectStaticBindingInitializers(sourceFile);

    if (definitions.length === 0) {
        throw new Error(`No route definitions were found in ${sourceFilepath}.`);
    }

    if (side === 'client' && definitions.length !== 1) {
        throw new Error(
            `Frontend route definition files can contain only one route definition. ${definitions.length} were found in ${sourceFilepath}.`,
        );
    }

    return definitions.map<TIndexedRouteDefinition>((definition) => {
        const sourceLocation = definition.sourceLocation;
        const resolveStaticValue = (node: ts.Expression) =>
            tryEvaluateStaticExpression(node, staticBindingInitializers, staticBindings);

        if (side === 'client') {
            const targetArg = definition.targetExpression;
            const optionMetadata = getRouteOptionMetadata(definition.optionsArg);
            const resolvedStaticValue = resolveStaticValue(targetArg);

            return definition.methodName === 'error'
                ? (() => {
                      const literalCode = getLiteralNumberValue(targetArg);
                      const code = literalCode ?? (typeof resolvedStaticValue === 'number' ? resolvedStaticValue : undefined);

                      if (code === undefined) {
                          const location = getNodeLocation(sourceFile, targetArg);
                          throw new Error(
                              `${sourceFile.fileName}:${location.line}:${location.column} defineErrorRoute code must resolve to a number.`,
                          );
                      }

                      return {
                          methodName: definition.methodName,
                          serviceLocalName: 'Router',
                          sourceLocation,
                          targetResolution: literalCode !== undefined ? 'literal' : 'static-expression',
                          code,
                          codeRaw: getNodeText(sourceFile, targetArg),
                          optionKeys: optionMetadata.optionKeys,
                          normalizedOptionKeys: optionMetadata.normalizedOptionKeys,
                          invalidOptionKeys: optionMetadata.invalidOptionKeys,
                          reservedOptionKeys: optionMetadata.reservedOptionKeys,
                          optionsRaw: definition.optionsExpression ? getNodeText(sourceFile, definition.optionsExpression) : undefined,
                          hasData: false,
                      };
                  })()
                : (() => {
                      const literalPath = getLiteralStringValue(targetArg);
                      const routePath = literalPath ?? (typeof resolvedStaticValue === 'string' ? resolvedStaticValue : undefined);

                      if (routePath === undefined) {
                          const location = getNodeLocation(sourceFile, targetArg);
                          throw new Error(
                              `${sourceFile.fileName}:${location.line}:${location.column} definePageRoute path must resolve to a string.`,
                          );
                      }

                      return {
                          methodName: definition.methodName,
                          serviceLocalName: 'Router',
                          sourceLocation,
                          targetResolution: literalPath !== undefined ? 'literal' : 'static-expression',
                          path: routePath,
                          pathRaw: getNodeText(sourceFile, targetArg),
                          optionKeys: optionMetadata.optionKeys,
                          normalizedOptionKeys: optionMetadata.normalizedOptionKeys,
                          invalidOptionKeys: optionMetadata.invalidOptionKeys,
                          reservedOptionKeys: optionMetadata.reservedOptionKeys,
                          optionsRaw: definition.optionsExpression ? getNodeText(sourceFile, definition.optionsExpression) : undefined,
                          hasData: definition.hasData,
                      };
                  })();
        }

        const targetArg = definition.targetExpression;
        const optionMetadata = getRouteOptionMetadata(definition.optionsArg);
        const resolvedPath = getLiteralStringValue(targetArg) ?? resolveStaticValue(targetArg);

        if (typeof resolvedPath !== 'string') {
            const location = getNodeLocation(sourceFile, targetArg);
            throw new Error(
                `${sourceFile.fileName}:${location.line}:${location.column} defineServerRoute path must resolve to a string.`,
            );
        }

        return {
            methodName: definition.methodName,
            serviceLocalName: 'Router',
            sourceLocation,
            targetResolution:
                getLiteralStringValue(targetArg) !== undefined
                    ? 'literal'
                    : 'static-expression',
            path: resolvedPath,
            pathRaw: getNodeText(sourceFile, targetArg),
            optionKeys: optionMetadata.optionKeys,
            normalizedOptionKeys: optionMetadata.normalizedOptionKeys,
            invalidOptionKeys: optionMetadata.invalidOptionKeys,
            reservedOptionKeys: optionMetadata.reservedOptionKeys,
            optionsRaw: definition.optionsExpression ? getNodeText(sourceFile, definition.optionsExpression) : undefined,
            hasData: false,
        };
    });
};

export const writeGeneratedRouteModule = ({
    outputFilepath,
    runtime,
    side,
    sourceFilepath,
    clientRoute,
}: TWriteGeneratedRouteModuleOptions) => {
    const code = fs.readFileSync(sourceFilepath, 'utf8');
    const sourceFile = parseSourceFile(sourceFilepath, code);
    const definitions = collectExplicitRouteDefinitions(sourceFile, side);

    if (definitions.length === 0) {
        throw new Error(`No route definitions were found in ${sourceFilepath}.`);
    }

    const runtimeAppImportPath = runtime === 'client' ? '@/client/index' : '@/server/index';
    const sourceImportPath = getSourceImportPath(outputFilepath, sourceFilepath);
    const metadataEntries = definitions.map((definition) => {
        const extra = side === 'client' && clientRoute ? [`id: ${JSON.stringify(clientRoute.chunkId)}`] : [];

        return buildInjectedRouteMetadata(sourceFilepath, definition.sourceLocation, extra);
    });

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from ${path.relative(process.cwd(), sourceFilepath).replace(/\\/g, '/')}.
// Do not edit it manually.

import type __GeneratedRouteAppExport from ${JSON.stringify(runtimeAppImportPath)};
import __routeDefinition from ${JSON.stringify(sourceImportPath)};
import { normalizeRouteDefinitions, registerRouteDefinition } from '@common/router/definitions';

type __GeneratedRouteApp = __GeneratedRouteAppExport extends abstract new (...args: any[]) => infer __GeneratedRouteAppInstance
  ? __GeneratedRouteAppInstance
  : __GeneratedRouteAppExport;

const __routeMetadata = [
  ${metadataEntries.join(',\n  ')}
];

export const __register = (app: __GeneratedRouteApp) => {
  const __definitions = normalizeRouteDefinitions(__routeDefinition as any, app as any);
  let __registeredRoute;
  for (let __index = 0; __index < __definitions.length; __index += 1) {
    __registeredRoute = registerRouteDefinition(app.Router as any, __definitions[__index] as any, __routeMetadata[__index]);
  }
  return __registeredRoute;
};
`;

    return writeIfChanged(outputFilepath, content);
};
