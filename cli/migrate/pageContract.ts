import fs from 'fs-extra';
import path from 'path';
import { parse } from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type Binding, type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

import { routeOptionKeys } from '../../common/router/pageData';

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);
const routeOptionKeysSet: ReadonlySet<string> = new Set(routeOptionKeys);

export type TPageContractManualFix = {
    filepath: string;
    routeLabel: string;
    line: number;
    column: number;
    reason: string;
};

export type TPageContractMigrationSummary = {
    appRoot: string;
    changedFiles: string[];
    dryRun: boolean;
    manualFixes: TPageContractManualFix[];
    scannedFiles: number;
};

type TDataAnalysis =
    | {
          kind: 'ok';
          hasDataAfterMigration: boolean;
          movedOptionProperties: t.ObjectProperty[];
      }
    | {
          kind: 'manual';
          reason: string;
      };

const findFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findFiles(filepath));
            continue;
        }

        if (dirent.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(filepath))) files.push(filepath);
    }

    return files;
};

const isRouterPageCall = (callPath: NodePath<t.CallExpression>) => {
    const calleePath = callPath.get('callee');

    return (
        calleePath.isMemberExpression() &&
        calleePath.get('object').isIdentifier({ name: 'Router' }) &&
        calleePath.get('property').isIdentifier({ name: 'page' })
    );
};

const unwrapExpressionPath = (expressionPath: NodePath<t.Expression>): NodePath<t.Expression> => {
    let currentPath = expressionPath;

    while (true) {
        if (currentPath.isTSAsExpression() || currentPath.isTSTypeAssertion()) {
            currentPath = currentPath.get('expression') as NodePath<t.Expression>;
            continue;
        }

        if (currentPath.isTSNonNullExpression() || currentPath.isParenthesizedExpression()) {
            currentPath = currentPath.get('expression') as NodePath<t.Expression>;
            continue;
        }

        return currentPath;
    }
};

const getObjectPropertyKeyName = (property: t.ObjectProperty) => {
    if (t.isIdentifier(property.key)) return property.key.name;
    if (t.isStringLiteral(property.key)) return property.key.value;
    return null;
};

const normalizeLegacyRouteOptionKey = (key: string) => {
    if (routeOptionKeysSet.has(key)) return key;

    if (key.startsWith('_')) {
        const normalizedKey = key.slice(1);
        if (routeOptionKeysSet.has(normalizedKey)) return normalizedKey;
    }

    return null;
};

const createRouteOptionProperty = (property: t.ObjectProperty, normalizedKey: string) => {
    const value = t.cloneNode(property.value, true);
    const shorthand = t.isIdentifier(value) && value.name === normalizedKey;

    return t.objectProperty(t.identifier(normalizedKey), value, false, shorthand);
};

const getRouteLabel = (pathNode: t.Expression) =>
    (t.isStringLiteral(pathNode) || t.isNumericLiteral(pathNode) ? String(pathNode.value) : generate(pathNode).code).trim();

const getRouteLocation = (callPath: NodePath<t.CallExpression>) => ({
    line: callPath.node.loc?.start.line || 1,
    column: callPath.node.loc?.start.column ? callPath.node.loc.start.column + 1 : 1,
});

const resolveFunctionPathFromBinding = (binding: Binding) => {
    if (binding.path.isFunctionDeclaration()) {
        return binding.path as NodePath<t.FunctionDeclaration>;
    }

    if (!binding.path.isVariableDeclarator()) return null;

    const initPath = binding.path.get('init');
    if (!initPath.node) return null;

    const unwrappedInitPath = unwrapExpressionPath(initPath as NodePath<t.Expression>);
    if (unwrappedInitPath.isFunctionExpression() || unwrappedInitPath.isArrowFunctionExpression()) return unwrappedInitPath;

    return null;
};

const resolveObjectExpressionFromBinding = (binding: Binding) => {
    if (!binding.path.isVariableDeclarator()) return null;

    const initPath = binding.path.get('init');
    if (!initPath.node) return null;

    const unwrappedInitPath = unwrapExpressionPath(initPath as NodePath<t.Expression>);
    if (unwrappedInitPath.isObjectExpression()) return unwrappedInitPath;

    return null;
};

const classifyLegacySecondArg = (expressionPath: NodePath<t.Expression>) => {
    const unwrappedPath = unwrapExpressionPath(expressionPath);

    if (unwrappedPath.isObjectExpression()) return 'options' as const;
    if (unwrappedPath.isArrowFunctionExpression() || unwrappedPath.isFunctionExpression()) return 'data' as const;

    if (!unwrappedPath.isIdentifier()) return 'manual' as const;

    const binding = expressionPath.scope.getBinding(unwrappedPath.node.name);
    if (!binding) return 'manual' as const;

    if (resolveFunctionPathFromBinding(binding)) return 'data' as const;
    if (resolveObjectExpressionFromBinding(binding)) return 'options' as const;

    return 'manual' as const;
};

const findReturnedObjectPath = (
    functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
) => {
    if (functionPath.isArrowFunctionExpression() && !functionPath.get('body').isBlockStatement()) {
        const bodyPath = unwrapExpressionPath(functionPath.get('body') as NodePath<t.Expression>);
        if (bodyPath.isObjectExpression()) return { kind: 'ok' as const, objectPath: bodyPath };

        return { kind: 'manual' as const, reason: 'Data function must directly return an object expression.' };
    }

    const bodyPath = functionPath.get('body');
    if (!bodyPath.isBlockStatement()) {
        return { kind: 'manual' as const, reason: 'Data function must directly return an object expression.' };
    }

    let returnedObjectPath: NodePath<t.ObjectExpression> | null = null;

    for (const statementPath of bodyPath.get('body')) {
        if (!statementPath.isReturnStatement()) continue;

        const argumentPath = statementPath.get('argument');
        if (!argumentPath.node) {
            return { kind: 'manual' as const, reason: 'Data function cannot return without an object value.' };
        }

        const unwrappedArgumentPath = unwrapExpressionPath(argumentPath as NodePath<t.Expression>);
        if (!unwrappedArgumentPath.isObjectExpression()) {
            return { kind: 'manual' as const, reason: 'Data function must directly return an object expression.' };
        }

        if (returnedObjectPath) {
            return { kind: 'manual' as const, reason: 'Data function with multiple direct returns requires a manual rewrite.' };
        }

        returnedObjectPath = unwrappedArgumentPath;
    }

    if (!returnedObjectPath) {
        return { kind: 'manual' as const, reason: 'Data function must directly return an object expression.' };
    }

    return { kind: 'ok' as const, objectPath: returnedObjectPath };
};

const analyzeFunctionPath = (
    functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
    analysisCache: Map<string, TDataAnalysis>,
): TDataAnalysis => {
    const cacheKey = `${functionPath.node.start || 0}:${functionPath.node.end || 0}`;
    const cachedResult = analysisCache.get(cacheKey);
    if (cachedResult) return cachedResult;

    const objectResult = findReturnedObjectPath(functionPath);
    if (objectResult.kind === 'manual') {
        const result: TDataAnalysis = { kind: 'manual', reason: objectResult.reason };
        analysisCache.set(cacheKey, result);
        return result;
    }

    const keptProperties: Array<t.ObjectProperty | t.SpreadElement> = [];
    const movedOptionProperties: t.ObjectProperty[] = [];

    for (const propertyPath of objectResult.objectPath.get('properties')) {
        if (propertyPath.isSpreadElement()) {
            const result: TDataAnalysis = {
                kind: 'manual',
                reason: 'Data function using object spreads requires a manual rewrite.',
            };
            analysisCache.set(cacheKey, result);
            return result;
        }

        if (!propertyPath.isObjectProperty() || propertyPath.node.computed) {
            const result: TDataAnalysis = {
                kind: 'manual',
                reason: 'Data function must return a plain object with explicit property keys.',
            };
            analysisCache.set(cacheKey, result);
            return result;
        }

        const propertyKeyName = getObjectPropertyKeyName(propertyPath.node);
        if (!propertyKeyName) {
            const result: TDataAnalysis = {
                kind: 'manual',
                reason: 'Data function must return a plain object with explicit property keys.',
            };
            analysisCache.set(cacheKey, result);
            return result;
        }

        const normalizedRouteOptionKey = normalizeLegacyRouteOptionKey(propertyKeyName);
        if (normalizedRouteOptionKey) {
            movedOptionProperties.push(createRouteOptionProperty(propertyPath.node, normalizedRouteOptionKey));
            continue;
        }

        keptProperties.push(t.cloneNode(propertyPath.node, true));
    }

    if (movedOptionProperties.length > 0) objectResult.objectPath.node.properties = keptProperties;

    const result: TDataAnalysis = {
        kind: 'ok',
        hasDataAfterMigration: keptProperties.length > 0,
        movedOptionProperties,
    };
    analysisCache.set(cacheKey, result);
    return result;
};

const analyzeDataExpression = (
    expressionPath: NodePath<t.Expression>,
    analysisCache: Map<string, TDataAnalysis>,
): TDataAnalysis => {
    const unwrappedPath = unwrapExpressionPath(expressionPath);

    if (unwrappedPath.isNullLiteral()) {
        return {
            kind: 'ok',
            hasDataAfterMigration: false,
            movedOptionProperties: [],
        };
    }

    if (unwrappedPath.isArrowFunctionExpression() || unwrappedPath.isFunctionExpression()) {
        return analyzeFunctionPath(unwrappedPath, analysisCache);
    }

    if (!unwrappedPath.isIdentifier()) {
        return {
            kind: 'manual',
            reason: 'Data provider must be a local function expression/reference or null.',
        };
    }

    const binding = expressionPath.scope.getBinding(unwrappedPath.node.name);
    if (!binding) {
        return {
            kind: 'manual',
            reason: `Could not resolve local data provider "${unwrappedPath.node.name}".`,
        };
    }

    const functionPath = resolveFunctionPathFromBinding(binding);
    if (!functionPath) {
        return {
            kind: 'manual',
            reason: `Data provider "${unwrappedPath.node.name}" is not a directly analyzable local function.`,
        };
    }

    return analyzeFunctionPath(functionPath, analysisCache);
};

const cloneObjectProperties = (properties: t.ObjectProperty[]) =>
    properties.map((property) => t.cloneNode(property, true));

const buildNextOptionsExpression = (optionsNode: t.Expression, movedOptionProperties: t.ObjectProperty[]) => {
    if (movedOptionProperties.length === 0) return t.cloneNode(optionsNode, true);

    if (t.isObjectExpression(optionsNode) && optionsNode.properties.length === 0) {
        return t.objectExpression(cloneObjectProperties(movedOptionProperties));
    }

    return t.objectExpression([
        t.spreadElement(t.cloneNode(optionsNode, true)),
        ...cloneObjectProperties(movedOptionProperties),
    ]);
};

const transformFile = (filepath: string) => {
    const source = fs.readFileSync(filepath, 'utf8');
    if (!source.includes('Router.page(')) {
        return {
            changed: false,
            manualFixes: [] as TPageContractManualFix[],
            output: source,
        };
    }

    const ast = parse(source, {
        sourceType: 'module',
        errorRecovery: true,
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });

    const routeCalls: NodePath<t.CallExpression>[] = [];
    const manualFixes: TPageContractManualFix[] = [];
    const analysisCache = new Map<string, TDataAnalysis>();

    traverse(ast, {
        CallExpression(callPath: NodePath<t.CallExpression>) {
            if (!isRouterPageCall(callPath)) return;
            routeCalls.push(callPath);
        },
    });

    let mutated = false;

    for (const callPath of routeCalls) {
        const argumentPaths = callPath.get('arguments') as NodePath<t.Expression>[];
        if (argumentPaths.length < 2 || argumentPaths.length > 4) {
            const pathArgument = argumentPaths[0]?.node;
            const routeLabel = pathArgument ? getRouteLabel(pathArgument) : '(unknown route)';
            const location = getRouteLocation(callPath);

            manualFixes.push({
                filepath,
                routeLabel,
                line: location.line,
                column: location.column,
                reason: 'Unsupported Router.page signature.',
            });
            continue;
        }

        const pathArgument = argumentPaths[0].node;
        const routeLabel = getRouteLabel(pathArgument);
        const location = getRouteLocation(callPath);

        let optionsNode: t.Expression;
        let dataPath: NodePath<t.Expression> | null;
        let renderNode: t.Expression;
        const isExplicitSignature = argumentPaths.length === 4;

        if (argumentPaths.length === 2) {
            optionsNode = t.objectExpression([]);
            dataPath = null;
            renderNode = t.cloneNode(argumentPaths[1].node, true);
        } else if (argumentPaths.length === 3) {
            const secondArgKind = classifyLegacySecondArg(argumentPaths[1]);
            if (secondArgKind === 'manual') {
                manualFixes.push({
                    filepath,
                    routeLabel,
                    line: location.line,
                    column: location.column,
                    reason: 'Could not classify the legacy second Router.page argument as options or data.',
                });
                continue;
            }

            if (secondArgKind === 'options') {
                optionsNode = t.cloneNode(argumentPaths[1].node, true);
                dataPath = null;
                renderNode = t.cloneNode(argumentPaths[2].node, true);
            } else {
                optionsNode = t.objectExpression([]);
                dataPath = argumentPaths[1];
                renderNode = t.cloneNode(argumentPaths[2].node, true);
            }
        } else {
            optionsNode = t.cloneNode(argumentPaths[1].node, true);
            dataPath = argumentPaths[2];
            renderNode = t.cloneNode(argumentPaths[3].node, true);
        }

        let dataNode: t.Expression = t.nullLiteral();
        let movedOptionProperties: t.ObjectProperty[] = [];
        let shouldRewrite = !isExplicitSignature;

        if (dataPath) {
            const analysis = analyzeDataExpression(dataPath, analysisCache);
            if (analysis.kind === 'manual') {
                if (isExplicitSignature) continue;

                manualFixes.push({
                    filepath,
                    routeLabel,
                    line: location.line,
                    column: location.column,
                    reason: analysis.reason,
                });
                continue;
            }

            movedOptionProperties = analysis.movedOptionProperties;
            dataNode = analysis.hasDataAfterMigration ? t.cloneNode(dataPath.node, true) : t.nullLiteral();
            shouldRewrite =
                shouldRewrite ||
                movedOptionProperties.length > 0 ||
                (!analysis.hasDataAfterMigration && !unwrapExpressionPath(dataPath).isNullLiteral());
        }

        if (!shouldRewrite) continue;

        callPath.node.arguments = [
            t.cloneNode(pathArgument, true),
            buildNextOptionsExpression(optionsNode, movedOptionProperties),
            dataNode,
            renderNode,
        ];
        mutated = true;
    }

    if (manualFixes.length > 0) {
        return {
            changed: false,
            manualFixes,
            output: source,
        };
    }

    if (!mutated) {
        return {
            changed: false,
            manualFixes,
            output: source,
        };
    }

    return {
        changed: true,
        manualFixes,
        output: generate(ast, {
            comments: true,
            compact: false,
            retainLines: false,
        }).code,
    };
};

export const runPageContractMigration = ({
    appRoot,
    dryRun,
}: {
    appRoot: string;
    dryRun: boolean;
}): TPageContractMigrationSummary => {
    const pagesRoot = path.join(appRoot, 'client', 'pages');
    const changedFiles: string[] = [];
    const manualFixes: TPageContractManualFix[] = [];
    const files = findFiles(pagesRoot);

    for (const filepath of files) {
        const result = transformFile(filepath);
        manualFixes.push(...result.manualFixes);

        if (!result.changed) continue;

        changedFiles.push(filepath);
        if (!dryRun) fs.writeFileSync(filepath, result.output);
    }

    return {
        appRoot,
        changedFiles,
        dryRun,
        manualFixes,
        scannedFiles: files.length,
    };
};
