import path from 'path';
import fs from 'fs-extra';
import ts from 'typescript';

import app from '../../app';
import cli from '../..';
import { TProteumManifestScope, TProteumManifestService } from '../common/proteumManifest';
import writeIfChanged from '../writeIfChanged';
import { normalizeAbsolutePath } from './shared';

type TImportedBinding =
    | {
          kind: 'default' | 'named';
          importPath: string;
          localName: string;
          exportedName: string;
      }
    | {
          kind: 'namespace';
          importPath: string;
          localName: string;
      };

type TParsedService = {
    className: string;
    importPath: string;
    priority: number;
    registeredName: string;
    scope: TProteumManifestScope;
    sourceFilepath?: string;
};

type TParsedAppBootstrap = {
    rootServices: TParsedService[];
    routerPlugins: TParsedService[];
};

type TCommandServiceStubSource = {
    aliasImportPath: string;
    filepath: string;
};

type TGeneratedCommandServiceStubs = {
    declarations: string;
    typeNamesByAliasImportPath: Map<string, string>;
};

type TResolvedImportSource = {
    scope?: TProteumManifestScope;
    sourceFilepath?: string;
};

const coreServicesRoot = normalizeAbsolutePath(path.join(cli.paths.core.root, 'server', 'services'));
const appServicesRoot = normalizeAbsolutePath(path.join(app.paths.root, 'server', 'services'));
const coreServerRoot = normalizeAbsolutePath(path.join(cli.paths.core.root, 'server'));
const appServerRoot = normalizeAbsolutePath(path.join(app.paths.root, 'server'));

const moduleSourceCache = new Map<string, ts.SourceFile>();
const exportExpressionCache = new Map<string, ts.Expression | undefined>();

const getAppServerEntryFilepath = () => {
    const filepath = app.paths.server.entry;

    if (!fs.existsSync(filepath)) {
        throw new Error(`Expected an explicit server application entrypoint at ${filepath}.`);
    }

    return filepath;
};

const createSourceFile = (filepath: string) => {
    const normalizedFilepath = normalizeAbsolutePath(filepath);
    const existing = moduleSourceCache.get(normalizedFilepath);
    if (existing) return existing;

    const sourceFile = ts.createSourceFile(
        normalizedFilepath,
        fs.readFileSync(normalizedFilepath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        normalizedFilepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    moduleSourceCache.set(normalizedFilepath, sourceFile);
    return sourceFile;
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => {
    const modifiers = (node as ts.Node & { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;

    return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
};

const getDefaultExportClassDeclaration = (sourceFile: ts.SourceFile) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isClassDeclaration(statement)) continue;
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
        if (!hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) continue;

        return statement;
    }

    let defaultExportIdentifier: string | undefined;

    for (const statement of sourceFile.statements) {
        if (!ts.isExportAssignment(statement)) continue;
        if (!ts.isIdentifier(statement.expression)) continue;

        defaultExportIdentifier = statement.expression.text;
        break;
    }

    if (!defaultExportIdentifier) {
        throw new Error(`Expected ${sourceFile.fileName} to default-export an Application subclass.`);
    }

    const declaration = sourceFile.statements.find(
        (statement): statement is ts.ClassDeclaration =>
            ts.isClassDeclaration(statement) && statement.name?.text === defaultExportIdentifier,
    );

    if (!declaration) {
        throw new Error(
            `Unable to resolve the default-exported Application class "${defaultExportIdentifier}" in ${sourceFile.fileName}.`,
        );
    }

    return declaration;
};

const buildImportIndex = (sourceFile: ts.SourceFile) => {
    const imports = new Map<string, TImportedBinding>();

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!statement.importClause) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const importPath = statement.moduleSpecifier.text;
        const { importClause } = statement;

        if (importClause.name) {
            imports.set(importClause.name.text, {
                kind: 'default',
                importPath,
                localName: importClause.name.text,
                exportedName: 'default',
            });
        }

        const namedBindings = importClause.namedBindings;
        if (!namedBindings) continue;

        if (ts.isNamespaceImport(namedBindings)) {
            imports.set(namedBindings.name.text, {
                kind: 'namespace',
                importPath,
                localName: namedBindings.name.text,
            });
            continue;
        }

        if (!ts.isNamedImports(namedBindings)) continue;

        for (const element of namedBindings.elements) {
            imports.set(element.name.text, {
                kind: 'named',
                importPath,
                localName: element.name.text,
                exportedName: element.propertyName?.text || element.name.text,
            });
        }
    }

    return imports;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
    if (ts.isParenthesizedExpression(expression)) return unwrapExpression(expression.expression);
    if (ts.isAsExpression(expression)) return unwrapExpression(expression.expression);
    if (ts.isSatisfiesExpression(expression)) return unwrapExpression(expression.expression);
    if (ts.isNonNullExpression(expression)) return unwrapExpression(expression.expression);

    return expression;
};

const getPropertyNameText = (propertyName: ts.PropertyName | undefined): string | undefined => {
    if (!propertyName) return undefined;
    if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNumericLiteral(propertyName))
        return propertyName.text;

    return undefined;
};

const resolveExistingModuleFilepath = (importPath: string) => {
    const candidates = [
        importPath,
        `${importPath}.ts`,
        `${importPath}.tsx`,
        path.join(importPath, 'index.ts'),
        path.join(importPath, 'index.tsx'),
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        if (!fs.statSync(candidate).isFile()) continue;

        return normalizeAbsolutePath(candidate);
    }

    return undefined;
};

const resolveImportSource = (importPath: string, fromFilepath: string): TResolvedImportSource => {
    if (importPath.startsWith('@server/')) {
        return {
            scope: 'framework',
            sourceFilepath: resolveExistingModuleFilepath(path.join(cli.paths.core.root, importPath.slice(1))),
        };
    }

    if (importPath.startsWith('@/')) {
        return {
            scope: 'app',
            sourceFilepath: resolveExistingModuleFilepath(path.join(app.paths.root, importPath.slice(2))),
        };
    }

    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const sourceFilepath = resolveExistingModuleFilepath(path.resolve(path.dirname(fromFilepath), importPath));
        if (!sourceFilepath) return {};

        if (sourceFilepath === appServerRoot || sourceFilepath.startsWith(`${appServerRoot}/`)) {
            return { scope: 'app', sourceFilepath };
        }

        if (sourceFilepath === coreServerRoot || sourceFilepath.startsWith(`${coreServerRoot}/`)) {
            return { scope: 'framework', sourceFilepath };
        }

        return { sourceFilepath };
    }

    return {};
};

const getObjectLiteralProperty = (expression: ts.ObjectLiteralExpression, propertyName: string) =>
    expression.properties.find((property) => {
        if (!ts.isPropertyAssignment(property)) return false;

        return getPropertyNameText(property.name) === propertyName;
    });

const readNumericLiteral = (expression: ts.Expression) => {
    const unwrappedExpression = unwrapExpression(expression);

    if (ts.isNumericLiteral(unwrappedExpression)) return Number(unwrappedExpression.text);

    if (
        ts.isPrefixUnaryExpression(unwrappedExpression) &&
        unwrappedExpression.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(unwrapExpression(unwrappedExpression.operand))
    ) {
        return -Number((unwrapExpression(unwrappedExpression.operand) as ts.NumericLiteral).text);
    }

    return undefined;
};

const getExportedExpression = (moduleFilepath: string, exportName: string): ts.Expression | undefined => {
    const cacheKey = `${normalizeAbsolutePath(moduleFilepath)}::${exportName}`;
    if (exportExpressionCache.has(cacheKey)) return exportExpressionCache.get(cacheKey);

    const sourceFile = createSourceFile(moduleFilepath);
    const namedExports = new Map<string, string>();

    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;

        for (const element of statement.exportClause.elements) {
            const exportedName = element.name.text;
            const localName = element.propertyName?.text || element.name.text;
            namedExports.set(exportedName, localName);
        }
    }

    const localName = namedExports.get(exportName) || exportName;

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== localName || !declaration.initializer) continue;

            exportExpressionCache.set(cacheKey, declaration.initializer);
            return declaration.initializer;
        }
    }

    exportExpressionCache.set(cacheKey, undefined);
    return undefined;
};

const extractPriorityFromConfigExpression = (
    configExpression: ts.Expression | undefined,
    imports: Map<string, TImportedBinding>,
    sourceFilepath: string,
    seen = new Set<string>(),
): number => {
    if (!configExpression) return 0;

    const expression = unwrapExpression(configExpression);

    if (ts.isObjectLiteralExpression(expression)) {
        const priorityProperty = getObjectLiteralProperty(expression, 'priority');
        if (!priorityProperty || !ts.isPropertyAssignment(priorityProperty)) return 0;
        return readNumericLiteral(priorityProperty.initializer) || 0;
    }

    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
        const callee = expression.expression;

        if (
            ts.isIdentifier(callee.expression) &&
            callee.expression.text === 'Services' &&
            callee.name.text === 'config'
        ) {
            return extractPriorityFromConfigExpression(expression.arguments[1], imports, sourceFilepath, seen);
        }
    }

    if (ts.isIdentifier(expression)) {
        const imported = imports.get(expression.text);
        if (!imported || imported.kind === 'namespace') return 0;

        const resolved = resolveImportSource(imported.importPath, sourceFilepath);
        if (!resolved.sourceFilepath) return 0;

        const cacheKey = `${resolved.sourceFilepath}::${imported.exportedName}`;
        if (seen.has(cacheKey)) return 0;

        seen.add(cacheKey);
        return extractPriorityFromConfigExpression(
            getExportedExpression(resolved.sourceFilepath, imported.exportedName),
            buildImportIndex(createSourceFile(resolved.sourceFilepath)),
            resolved.sourceFilepath,
            seen,
        );
    }

    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
        const imported = imports.get(expression.expression.text);
        if (!imported || imported.kind !== 'namespace') return 0;

        const resolved = resolveImportSource(imported.importPath, sourceFilepath);
        if (!resolved.sourceFilepath) return 0;

        const exportName = expression.name.text;
        const cacheKey = `${resolved.sourceFilepath}::${exportName}`;
        if (seen.has(cacheKey)) return 0;

        seen.add(cacheKey);
        return extractPriorityFromConfigExpression(
            getExportedExpression(resolved.sourceFilepath, exportName),
            buildImportIndex(createSourceFile(resolved.sourceFilepath)),
            resolved.sourceFilepath,
            seen,
        );
    }

    return 0;
};

const resolveImportedService = (
    expression: ts.LeftHandSideExpression,
    imports: Map<string, TImportedBinding>,
    sourceFilepath: string,
) => {
    if (!ts.isIdentifier(expression)) return undefined;

    const imported = imports.get(expression.text);
    if (!imported || imported.kind === 'namespace') return undefined;

    const resolved = resolveImportSource(imported.importPath, sourceFilepath);
    if (!resolved.scope) return undefined;

    return {
        className: expression.text,
        importPath: imported.importPath,
        scope: resolved.scope,
        sourceFilepath: resolved.sourceFilepath,
    };
};

const parseServiceInstantiation = (
    registeredName: string,
    expression: ts.Expression,
    imports: Map<string, TImportedBinding>,
    sourceFilepath: string,
    configArgIndex: number,
): TParsedService | undefined => {
    const unwrappedExpression = unwrapExpression(expression);
    if (!ts.isNewExpression(unwrappedExpression)) return undefined;

    const resolvedService = resolveImportedService(unwrappedExpression.expression, imports, sourceFilepath);
    if (!resolvedService) return undefined;

    const configExpression = unwrappedExpression.arguments?.[configArgIndex];

    return {
        ...resolvedService,
        registeredName,
        priority: extractPriorityFromConfigExpression(configExpression, imports, sourceFilepath),
    };
};

const extractRouterPlugins = (
    routerConfigExpression: ts.Expression | undefined,
    imports: Map<string, TImportedBinding>,
    sourceFilepath: string,
) => {
    if (!routerConfigExpression) return [];

    const configExpression = unwrapExpression(routerConfigExpression);
    if (!ts.isObjectLiteralExpression(configExpression)) return [];

    const pluginsProperty = getObjectLiteralProperty(configExpression, 'plugins');
    if (!pluginsProperty || !ts.isPropertyAssignment(pluginsProperty)) return [];

    const pluginsExpression = unwrapExpression(pluginsProperty.initializer);
    if (!ts.isObjectLiteralExpression(pluginsExpression)) return [];

    const routerPlugins: TParsedService[] = [];

    for (const property of pluginsExpression.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        const registeredName = getPropertyNameText(property.name);
        if (!registeredName) continue;

        const routerPlugin = parseServiceInstantiation(registeredName, property.initializer, imports, sourceFilepath, 0);
        if (!routerPlugin) continue;

        routerPlugins.push(routerPlugin);
    }

    return routerPlugins;
};

const parseAppBootstrap = (): TParsedAppBootstrap => {
    const sourceFile = createSourceFile(getAppServerEntryFilepath());
    const imports = buildImportIndex(sourceFile);
    const appClass = getDefaultExportClassDeclaration(sourceFile);

    const rootServices: TParsedService[] = [];
    let routerPlugins: TParsedService[] = [];

    for (const member of appClass.members) {
        if (!ts.isPropertyDeclaration(member) || !member.initializer) continue;

        const registeredName = getPropertyNameText(member.name);
        if (!registeredName) continue;

        const rootService = parseServiceInstantiation(registeredName, member.initializer, imports, sourceFile.fileName, 1);
        if (!rootService) continue;

        rootServices.push(rootService);

        if (rootService.importPath === '@server/services/router') {
            const initializer = unwrapExpression(member.initializer);
            if (!ts.isNewExpression(initializer)) continue;

            routerPlugins = extractRouterPlugins(initializer.arguments?.[1], imports, sourceFile.fileName);
        }
    }

    if (rootServices.length === 0) {
        throw new Error(`No root services were found in ${sourceFile.fileName}.`);
    }

    return { rootServices, routerPlugins };
};

const commandServiceSearchRoots = [
    { root: coreServicesRoot, prefix: '@server/services/' },
    { root: appServicesRoot, prefix: '@/server/services/' },
];

const getCommandServiceAliasFromFilepath = (filepath: string) => {
    const normalizedFilepath = normalizeAbsolutePath(filepath);

    for (const searchRoot of commandServiceSearchRoots) {
        if (!normalizedFilepath.startsWith(searchRoot.root + '/')) continue;

        let relativePath = normalizedFilepath.substring(searchRoot.root.length + 1).replace(/\.(ts|tsx)$/, '');
        if (relativePath.endsWith('/index')) relativePath = relativePath.substring(0, relativePath.length - '/index'.length);

        return searchRoot.prefix + relativePath;
    }

    return undefined;
};

const resolveCommandServiceStubSource = (
    importPath: string,
    sourceFilepath?: string,
): TCommandServiceStubSource | undefined => {
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        if (!sourceFilepath) return undefined;

        const resolvedFilepath = resolveExistingModuleFilepath(path.resolve(path.dirname(sourceFilepath), importPath));
        if (!resolvedFilepath) return undefined;

        const aliasImportPath = getCommandServiceAliasFromFilepath(resolvedFilepath);
        if (!aliasImportPath) return undefined;

        return { aliasImportPath, filepath: resolvedFilepath };
    }

    const searchRoot = commandServiceSearchRoots.find((entry) => importPath.startsWith(entry.prefix));
    if (!searchRoot) return undefined;

    const relativeImportPath = importPath.substring(searchRoot.prefix.length);
    const resolvedFilepath = resolveExistingModuleFilepath(path.join(searchRoot.root, relativeImportPath));
    if (!resolvedFilepath) return undefined;

    const aliasImportPath = getCommandServiceAliasFromFilepath(resolvedFilepath);
    if (!aliasImportPath) return undefined;

    return { aliasImportPath, filepath: resolvedFilepath };
};

const getCommandServiceStubTypeName = (aliasImportPath: string) =>
    `ProteumCommandService_${aliasImportPath.replace(/[^A-Za-z0-9_$]+/g, '_')}`;

const isPrivateOrProtectedInstanceMember = (member: ts.ClassElement) =>
    hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(member, ts.SyntaxKind.ProtectedKeyword) ||
    hasModifier(member, ts.SyntaxKind.StaticKeyword);

const getPropertyDeclarationType = (
    property: ts.PropertyDeclaration,
    imports: Map<string, TImportedBinding>,
    sourceFilepath: string,
    getStubTypeName: (source: TCommandServiceStubSource) => string,
    enqueueStub: (source: TCommandServiceStubSource) => void,
) => {
    const initializer = property.initializer ? unwrapExpression(property.initializer) : undefined;

    if (initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression)) {
        const nestedImport = imports.get(initializer.expression.text);
        if (nestedImport && nestedImport.kind !== 'namespace') {
            const nestedSource = resolveCommandServiceStubSource(nestedImport.importPath, sourceFilepath);

            if (nestedSource) {
                enqueueStub(nestedSource);
                return getStubTypeName(nestedSource);
            }
        }
    }

    if (!initializer) return 'any';
    if (ts.isArrayLiteralExpression(initializer)) return 'any[]';
    if (ts.isObjectLiteralExpression(initializer)) return 'Record<string, any>';
    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) return 'string';
    if (ts.isNumericLiteral(initializer)) return 'number';
    if (initializer.kind === ts.SyntaxKind.TrueKeyword || initializer.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
    if (initializer.kind === ts.SyntaxKind.NullKeyword) return 'null';

    return 'any';
};

const getCommandMethodParameter = (parameter: ts.ParameterDeclaration, index: number) => {
    const parameterName = ts.isIdentifier(parameter.name) ? parameter.name.text : `arg${index}`;

    if (parameter.dotDotDotToken) return `...${parameterName}: any[]`;

    return `${parameterName}${parameter.questionToken || parameter.initializer ? '?' : ''}: any`;
};

const isPromiseTypeNode = (typeNode?: ts.TypeNode) =>
    !!typeNode &&
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'Promise';

const isArrayLikeTypeNode = (typeNode?: ts.TypeNode): boolean => {
    if (!typeNode) return false;
    if (ts.isArrayTypeNode(typeNode)) return true;

    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
        if (typeNode.typeName.text === 'Array' || typeNode.typeName.text === 'ReadonlyArray') return true;

        if (typeNode.typeName.text === 'Promise' && typeNode.typeArguments?.[0]) {
            return isArrayLikeTypeNode(typeNode.typeArguments[0]);
        }
    }

    return false;
};

const getCommandMethodReturnType = (method: ts.MethodDeclaration) => {
    const isPromise = hasModifier(method, ts.SyntaxKind.AsyncKeyword) || isPromiseTypeNode(method.type);
    const containsArrayResult = isArrayLikeTypeNode(method.type);

    if (isPromise && containsArrayResult) return 'Promise<any[]>';
    if (isPromise) return 'Promise<any>';
    if (containsArrayResult) return 'any[]';

    return 'any';
};

const createCommandServiceStubDeclarations = (rootServices: TParsedService[]): TGeneratedCommandServiceStubs => {
    const stubs = new Map<string, string>();
    const typeNamesByAliasImportPath = new Map<string, string>();
    const pendingSources: TCommandServiceStubSource[] = [];
    const seenSources = new Set<string>();
    const getStubTypeName = (source: TCommandServiceStubSource) => {
        const existingTypeName = typeNamesByAliasImportPath.get(source.aliasImportPath);
        if (existingTypeName) return existingTypeName;

        const typeName = getCommandServiceStubTypeName(source.aliasImportPath);
        typeNamesByAliasImportPath.set(source.aliasImportPath, typeName);

        return typeName;
    };
    const enqueueStub = (source: TCommandServiceStubSource) => {
        if (seenSources.has(source.aliasImportPath)) return;

        seenSources.add(source.aliasImportPath);
        pendingSources.push(source);
    };

    for (const rootService of rootServices) {
        const source = resolveCommandServiceStubSource(rootService.importPath, rootService.sourceFilepath);
        if (source) enqueueStub(source);
    }

    while (pendingSources.length > 0) {
        const source = pendingSources.shift()!;
        const sourceFile = createSourceFile(source.filepath);
        const imports = buildImportIndex(sourceFile);
        let defaultClass: ts.ClassDeclaration | undefined;

        try {
            defaultClass = getDefaultExportClassDeclaration(sourceFile);
        } catch {
            defaultClass = undefined;
        }

        if (!defaultClass) {
            stubs.set(
                source.aliasImportPath,
                `declare class ${getStubTypeName(source)} {
    app: import("@/server/index").default;
    [key: string]: any;
}`,
            );
            continue;
        }

        const className = getStubTypeName(source);
        const classMembers = [`    app: import("@/server/index").default;`];

        for (const member of defaultClass.members) {
            if (isPrivateOrProtectedInstanceMember(member)) continue;

            if (ts.isPropertyDeclaration(member)) {
                const propertyName = getPropertyNameText(member.name);
                if (!propertyName) continue;

                classMembers.push(
                    `    ${propertyName}: ${getPropertyDeclarationType(member, imports, source.filepath, getStubTypeName, enqueueStub)};`,
                );
                continue;
            }

            if (ts.isGetAccessorDeclaration(member)) {
                const propertyName = getPropertyNameText(member.name);
                if (!propertyName) continue;

                classMembers.push(`    ${propertyName}: any;`);
                continue;
            }

            if (ts.isMethodDeclaration(member)) {
                const methodName = getPropertyNameText(member.name);
                if (!methodName) continue;

                const parameters = member.parameters.map((parameter, index) => getCommandMethodParameter(parameter, index)).join(', ');
                const returnType = getCommandMethodReturnType(member);

                classMembers.push(`    ${methodName}(${parameters}): ${returnType};`);
            }
        }

        stubs.set(
            source.aliasImportPath,
            `declare class ${className} {
${classMembers.join('\n')}
}`,
        );
    }

    return {
        declarations: Array.from(stubs.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([, declaration]) => declaration)
            .join('\n\n'),
        typeNamesByAliasImportPath,
    };
};

const resolveManifestService = (service: TParsedService, parent: string): TProteumManifestService => ({
    kind: 'service',
    registeredName: service.registeredName,
    className: service.className,
    parent,
    priority: service.priority,
    importPath: service.importPath,
    sourceFilepath: service.sourceFilepath,
    scope: service.scope,
});

export const generateServiceArtifacts = () => {
    const { rootServices, routerPlugins } = parseAppBootstrap();
    const appClassIdentifier = app.identity.identifier;
    const containerServices = app.containerServices.map((serviceName) => "'" + serviceName + "'").join('|');
    const appServices = rootServices.map((service) => resolveManifestService(service, 'app'));
    const routerPluginServices = routerPlugins.map((service) => resolveManifestService(service, 'Router.plugins'));
    const commandServiceStubs = createCommandServiceStubDeclarations(rootServices);

    writeIfChanged(
        path.join(app.paths.client.generated, 'services.d.ts'),
        `declare type ${appClassIdentifier} = import("@/server/index").default;

declare module "@app" {

    import { ${appClassIdentifier} as ${appClassIdentifier}Client } from "@/client";
    import ${appClassIdentifier}Server from "@/server/index";
  
    export const Router: ${appClassIdentifier}Client['Router'];

    ${rootServices
        .map((service) =>
            service.registeredName !== 'Router'
                ? `export const ${service.registeredName}: ${appClassIdentifier}Server["${service.registeredName}"];`
                : '',
        )
        .join('\n')}

}
    
declare module '@models/types' {
    export * from '@generated/client/models';
}

declare module '@common/errors' {
            
    export * from '@common/errors/index';
    export { default } from '@common/errors/index';

    export const AuthRequired: typeof import('@common/errors/index').AuthRequired<FeatureKeys>;
    export type AuthRequired = import('@common/errors/index').AuthRequired<FeatureKeys>;

    export const UpgradeRequired: typeof import('@common/errors/index').UpgradeRequired<FeatureKeys>;
    export type UpgradeRequired = import('@common/errors/index').UpgradeRequired<FeatureKeys>;
}

declare namespace preact.JSX {
    interface HTMLAttributes {
        src?: string;
    }
}
`,
    );

    writeIfChanged(
        path.join(app.paths.client.generated, 'models.ts'),
        `export * from '@/var/prisma/browser';
`,
    );

    writeIfChanged(
        path.join(app.paths.client.generated, 'context.ts'),
        `// TODO: move it into core (but how to make sure usecontext returns ${appClassIdentifier}'s context ?)
import React from 'react';

import type ${appClassIdentifier}Client from '@/client/index';

export type ClientContext = ${appClassIdentifier}Client["Router"]["context"];

type GlobalClientContextStore = typeof globalThis & {
    __proteumClientContexts?: Record<string, React.Context<ClientContext | undefined>>;
};

const globalClientContextStore = globalThis as GlobalClientContextStore;
const clientContexts = (globalClientContextStore.__proteumClientContexts ??= {});

export const ReactClientContext =
    clientContexts['${appClassIdentifier}'] ?? (clientContexts['${appClassIdentifier}'] = React.createContext<ClientContext | undefined>(undefined));
export default (): ClientContext => {
    const context = React.useContext<ClientContext | undefined>(ReactClientContext);
    if (context) return context;

    throw new Error(
        'Proteum router context hook was called outside the App provider. This is a framework contract failure. ' +
            'Likely fix: move the hook back under Router.page render ownership or pass the required values explicitly. ' +
            'Re-check both SSR and client navigation after the fix.',
    );
};`,
    );

    writeIfChanged(
        path.join(app.paths.common.generated, 'services.d.ts'),
        `declare type ${appClassIdentifier} = import("@/server/index").default;

declare module '@models/types' {
    export * from '@generated/common/models';
}`,
    );

    writeIfChanged(
        path.join(app.paths.common.generated, 'models.ts'),
        `export * from '@/var/prisma/browser';
`,
    );

    fs.removeSync(path.join(app.paths.server.generated, 'app.ts'));

    writeIfChanged(
        path.join(app.paths.server.generated, 'commands.d.ts'),
        `declare type ${appClassIdentifier} = import("@/server/index").default;

declare module "@models/types" {
    const Models: any;
    export = Models;
}

export {};
`,
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'commands.app.d.ts'),
        `${commandServiceStubs.declarations}

declare class ${appClassIdentifier} implements import("@server/app/commands").TCommandApplication {
    env: import("@server/app/commands").TCommandApplication["env"];
    identity: import("@server/app/commands").TCommandApplication["identity"];
    getRootServices: import("@server/app/commands").TCommandApplication["getRootServices"];
    findService?: import("@server/app/commands").TCommandApplication["findService"];
    models?: import("@server/app/commands").TCommandApplication["models"];
    Models?: import("@server/app/commands").TCommandApplication["Models"];
${rootServices
    .map((service) => {
        const source = resolveCommandServiceStubSource(service.importPath, service.sourceFilepath);
        const typeName = source ? commandServiceStubs.typeNamesByAliasImportPath.get(source.aliasImportPath) || 'any' : 'any';

        return `    ${service.registeredName}: ${typeName};`;
    })
    .join('\n')}
}

export default ${appClassIdentifier};
`,
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'models.ts'),
        `export * from '@/var/prisma/client';
`,
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'services.d.ts'),
        `type InstalledServices = import("@server/app").RootServicesOf<import("@/server/index").default>;

declare type ${appClassIdentifier} = import("@/server/index").default;

declare module "@app" {

    import { ApplicationContainer } from '@server/app/container';

    const ServerServices: (
        Pick< 
            ApplicationContainer<InstalledServices>, 
            ${containerServices}
        >
        & 
        ${appClassIdentifier}
    )

    export = ServerServices
}

declare module '@server/app' {

    import { Application } from "@server/app";
    import { Environment } from "@server/app";
    import { ServicesContainer } from "@server/app/service/container";

    abstract class ApplicationWithServices extends Application<
        ServicesContainer<InstalledServices>
    > {}

    export interface Exported {
        Application: typeof ApplicationWithServices,
        Environment: Environment,
    }

    const foo: Exported;

    export = foo;
}

declare module '@common/errors' {
        
    export * from '@common/errors/index';
    export { default } from '@common/errors/index';

    export const AuthRequired: typeof import('@common/errors/index').AuthRequired<FeatureKeys>;
    export type AuthRequired = import('@common/errors/index').AuthRequired<FeatureKeys>;

    export const UpgradeRequired: typeof import('@common/errors/index').UpgradeRequired<FeatureKeys>;
    export type UpgradeRequired = import('@common/errors/index').UpgradeRequired<FeatureKeys>;
}
    
declare module '@models/types' {
    export * from '@generated/server/models';
}`,
    );

    return { app: appServices, routerPlugins: routerPluginServices };
};
