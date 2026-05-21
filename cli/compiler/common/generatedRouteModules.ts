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

const unwrapStaticExpression = (node: ts.Expression): ts.Expression => {
    if (ts.isParenthesizedExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isAsExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isTypeAssertionExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isSatisfiesExpression(node)) return unwrapStaticExpression(node.expression);
    if (ts.isNonNullExpression(node)) return unwrapStaticExpression(node.expression);

    return node;
};

const isStaticSerializableExpression = (
    node: ts.Expression,
    bindingInitializers: Map<string, ts.Expression>,
    resolvedBindings: Map<string, string | number | undefined>,
    activeBindings = new Set<string>(),
): boolean => {
    const expression = unwrapStaticExpression(node);

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

const collectStaticBindingInitializers = (sourceFile: ts.SourceFile) => {
    const bindingInitializers = new Map<string, ts.Expression>();

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

            bindingInitializers.set(declaration.name.text, declaration.initializer);
        }
    }

    return bindingInitializers;
};

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

const resolveIdentifierExpression = (
    expression: ts.Expression,
    sourceFile: ts.SourceFile,
): ts.Expression => {
    const unwrapped = unwrapStaticExpression(expression);
    if (!ts.isIdentifier(unwrapped)) return unwrapped;

    const bindingInitializers = collectStaticBindingInitializers(sourceFile);
    return bindingInitializers.get(unwrapped.text) || unwrapped;
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
): TExplicitRouteDefinition[] => {
    const expression = unwrapStaticExpression(resolveIdentifierExpression(node, sourceFile));
    const staticBindingInitializers = collectStaticBindingInitializers(sourceFile);
    const staticBindings = collectStaticBindings(sourceFile);

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
        const routeListExpression =
            routesArg && ts.isArrayLiteralExpression(routesArg)
                ? routesArg
                : routesArg &&
                    (ts.isArrowFunction(routesArg) || ts.isFunctionExpression(routesArg)) &&
                    ts.isArrayLiteralExpression(routesArg.body)
                  ? routesArg.body
                  : undefined;

        if (!routeListExpression) {
            throw new Error(`defineServerRoutes(...) in ${sourceFile.fileName} must receive a static array literal or a factory returning one.`);
        }

        return routeListExpression.elements.map((element) => parseExplicitRouteCall(sourceFile, side, element)).flat();
    }

    const [definitionArg] = [...expression.arguments];
    if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) {
        throw new Error(`${helperName}(...) in ${sourceFile.fileName} must receive an object literal.`);
    }

    const sourceLocation = getNodeLocation(sourceFile, expression);
    const optionsExpression = getPropertyAssignment(definitionArg, 'options');
    const resolvedOptionsExpression = optionsExpression
        ? unwrapStaticExpression(resolveIdentifierExpression(optionsExpression, sourceFile))
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
