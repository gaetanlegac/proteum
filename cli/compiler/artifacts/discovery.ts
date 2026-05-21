import path from 'path';
import fs from 'fs-extra';
import ts from 'typescript';

import { normalizePath } from './shared';

type TRouteSide = 'client' | 'server';

const legacyRouterMethods = new Set([
    'page',
    'error',
    'all',
    'options',
    'get',
    'post',
    'put',
    'delete',
    'patch',
    'express',
]);
const routeDefinitionHelpers = new Set([
    'definePageRoute',
    'defineErrorRoute',
    'defineServerRoute',
    'defineServerRoutes',
]);
const routeDefinitionImportSources = new Set(['@common/router', '@common/router/definitions']);

const parseSourceFile = (filepath: string, content: string) =>
    ts.createSourceFile(
        filepath,
        content,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

const getCallExpressionName = (node: ts.Expression) => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
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

const resolveIdentifierExpression = (
    expression: ts.Expression,
    constInitializers: Map<string, ts.Expression>,
): ts.Expression => {
    if (!ts.isIdentifier(expression)) return expression;

    return constInitializers.get(expression.text) || expression;
};

const getDefaultExportExpression = (sourceFile: ts.SourceFile) => {
    const constInitializers = collectConstInitializers(sourceFile);

    for (const statement of sourceFile.statements) {
        if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;

        return resolveIdentifierExpression(statement.expression, constInitializers);
    }

    return undefined;
};

const hasRouteDefinitionHelperImport = (sourceFile: ts.SourceFile) =>
    sourceFile.statements.some((statement) => {
        if (!ts.isImportDeclaration(statement)) return false;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
        if (!routeDefinitionImportSources.has(statement.moduleSpecifier.text)) return false;
        if (!statement.importClause?.namedBindings) return false;
        if (!ts.isNamedImports(statement.importClause.namedBindings)) return false;

        return statement.importClause.namedBindings.elements.some((specifier) =>
            routeDefinitionHelpers.has(specifier.propertyName?.text || specifier.name.text),
        );
    });

const hasExplicitRouteDefinitionExport = (sourceFile: ts.SourceFile) => {
    const defaultExportExpression = getDefaultExportExpression(sourceFile);

    return (
        !!defaultExportExpression &&
        ts.isCallExpression(defaultExportExpression) &&
        !!getCallExpressionName(defaultExportExpression.expression) &&
        routeDefinitionHelpers.has(getCallExpressionName(defaultExportExpression.expression)!)
    );
};

const hasLegacyRouteMagic = (sourceFile: ts.SourceFile, side: TRouteSide) => {
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            if (statement.moduleSpecifier.text === '@app') return true;
        }

        if (!ts.isExpressionStatement(statement)) continue;
        if (!ts.isCallExpression(statement.expression)) continue;
        if (!ts.isPropertyAccessExpression(statement.expression.expression)) continue;

        const callee = statement.expression.expression;
        if (!ts.isIdentifier(callee.expression)) continue;
        if (callee.expression.text !== 'Router') continue;
        if (!legacyRouterMethods.has(callee.name.text)) continue;

        return true;
    }

    return false;
};

const hasRegisteredRouteDefinitions = (filepath: string, content: string, side: TRouteSide) => {
    const sourceFile = parseSourceFile(filepath, content);

    return (
        hasExplicitRouteDefinitionExport(sourceFile) ||
        hasRouteDefinitionHelperImport(sourceFile) ||
        hasLegacyRouteMagic(sourceFile, side)
    );
};

const findRegisteredRouteFiles = (
    dir: string,
    side: TRouteSide,
    options: { excludeLayoutDirectories?: boolean } = {},
): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filePath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            if (options.excludeLayoutDirectories && dirent.name === '_layout') continue;

            files.push(...findRegisteredRouteFiles(filePath, side, options));
            continue;
        }

        if (!dirent.isFile()) continue;
        if (!/\.(ts|tsx)$/.test(dirent.name)) continue;

        const content = fs.readFileSync(filePath, 'utf8');
        if (!hasRegisteredRouteDefinitions(filePath, content, side)) continue;

        files.push(filePath);
    }

    return files;
};

export const findClientRouteFiles = (dir: string) => findRegisteredRouteFiles(dir, 'client', { excludeLayoutDirectories: true });

export const findServerRouteFiles = (dir: string) => findRegisteredRouteFiles(dir, 'server');

const getApp = () => require('../../app').default as typeof import('../../app').default;

export const findLayoutFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filePath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findLayoutFiles(filePath));
            continue;
        }

        if (!dirent.isFile()) continue;
        if (dirent.name !== 'index.tsx') continue;
        if (!normalizePath(filePath).includes('/_layout/')) continue;

        files.push(filePath);
    }

    return files;
};

export const readPreloadedRouteChunks = () => {
    const app = getApp();
    const preloadPath = path.join(app.paths.pages, 'preload.json');

    if (!fs.existsSync(preloadPath)) return new Set<string>();

    const content = fs.readJsonSync(preloadPath);

    if (!Array.isArray(content)) {
        throw new Error(`Invalid client/pages/preload.json format: expected an array of chunk ids.`);
    }

    return new Set<string>(content.filter((value): value is string => typeof value === 'string'));
};
