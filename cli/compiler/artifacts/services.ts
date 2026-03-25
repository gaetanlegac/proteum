import path from 'path';
import fs from 'fs-extra';
import ts from 'typescript';

import app from '../../app';
import cli from '../..';
import { TProteumManifestScope, TProteumManifestService } from '../common/proteumManifest';
import writeIfChanged from '../writeIfChanged';
import { findServiceDirectories } from './discovery';
import { normalizeAbsolutePath } from './shared';

type TServiceMetas = {
    id: string;
    name: string;
    parent: string;
    dependences: string[];
    importationPath: string;
    priority: number;
    sourceDir: string;
    metasFilepath: string;
    scope: TProteumManifestScope;
};

type TParsedService = {
    registeredName: string;
    priority: number;
    meta: TServiceMetas;
};

type TParsedAppBootstrap = {
    rootServices: TParsedService[];
    routerPlugins: TParsedService[];
};

type TServicesAvailable = Record<string, TServiceMetas>;
type TCommandServiceStubSource = {
    aliasImportPath: string;
    filepath: string;
};
type TGeneratedCommandServiceStubs = {
    declarations: string;
    typeNamesByAliasImportPath: Map<string, string>;
};

const buildServicesAvailable = (): TServicesAvailable => {
    const searchDirs = [
        { path: '@server/services/', priority: -1, root: path.join(cli.paths.core.root, 'server', 'services') },
        { path: '@/server/services/', priority: 0, root: path.join(app.paths.root, 'server', 'services') },
    ];

    const servicesAvailable: TServicesAvailable = {};

    for (const searchDir of searchDirs) {
        const services = findServiceDirectories(searchDir.root);

        for (const serviceDir of services) {
            const metasFile = path.join(serviceDir, 'service.json');
            const importationPath = searchDir.path + serviceDir.substring(searchDir.root.length + 1);
            const serviceMetas = fs.readJsonSync(metasFile) as {
                id: string;
                name: string;
                parent: string;
                dependences: string[];
                priority?: number;
            };

            servicesAvailable[serviceMetas.id] = {
                importationPath,
                priority: searchDir.priority,
                sourceDir: normalizeAbsolutePath(serviceDir),
                metasFilepath: normalizeAbsolutePath(metasFile),
                scope: searchDir.path.startsWith('@server/services/') ? 'framework' : 'app',
                ...serviceMetas,
            };
        }
    }

    return servicesAvailable;
};

const getAppServerEntryFilepath = () => {
    const filepath = app.paths.server.entry;

    if (!fs.existsSync(filepath)) {
        throw new Error(`Expected an explicit server application entrypoint at ${filepath}.`);
    }

    return filepath;
};

const createSourceFile = (filepath: string) =>
    ts.createSourceFile(
        filepath,
        fs.readFileSync(filepath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

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
    const imports = new Map<string, string>();

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!statement.importClause) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const importPath = statement.moduleSpecifier.text;
        const { importClause } = statement;

        if (importClause.name) {
            imports.set(importClause.name.text, importPath);
        }

        const namedBindings = importClause.namedBindings;
        if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

        for (const element of namedBindings.elements) {
            imports.set(element.name.text, importPath);
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

const extractPriorityFromConfig = (configExpression?: ts.Expression) => {
    if (!configExpression) return 0;

    const expression = unwrapExpression(configExpression);
    if (!ts.isObjectLiteralExpression(expression)) return 0;

    const priorityProperty = expression.properties.find((property) => {
        if (!ts.isPropertyAssignment(property)) return false;

        return getPropertyNameText(property.name) === 'priority';
    });

    if (!priorityProperty || !ts.isPropertyAssignment(priorityProperty)) return 0;

    const priorityExpression = unwrapExpression(priorityProperty.initializer);
    if (ts.isNumericLiteral(priorityExpression)) return Number(priorityExpression.text);

    if (ts.isPrefixUnaryExpression(priorityExpression) && priorityExpression.operator === ts.SyntaxKind.MinusToken) {
        const operand = unwrapExpression(priorityExpression.operand);
        if (ts.isNumericLiteral(operand)) return -Number(operand.text);
    }

    return 0;
};

const resolveImportedService = (
    expression: ts.LeftHandSideExpression,
    imports: Map<string, string>,
    servicesAvailable: TServicesAvailable,
) => {
    if (!ts.isIdentifier(expression)) return undefined;

    const importPath = imports.get(expression.text);
    if (!importPath) return undefined;

    return Object.values(servicesAvailable).find((serviceMeta) => serviceMeta.importationPath === importPath);
};

const parseServiceInstantiation = (
    registeredName: string,
    expression: ts.Expression,
    imports: Map<string, string>,
    servicesAvailable: TServicesAvailable,
    configArgIndex: number,
): TParsedService | undefined => {
    const unwrappedExpression = unwrapExpression(expression);
    if (!ts.isNewExpression(unwrappedExpression)) return undefined;

    const meta = resolveImportedService(unwrappedExpression.expression, imports, servicesAvailable);
    if (!meta) return undefined;

    const configExpression = unwrappedExpression.arguments?.[configArgIndex];

    return {
        registeredName,
        priority: extractPriorityFromConfig(configExpression),
        meta,
    };
};

const getObjectLiteralProperty = (expression: ts.ObjectLiteralExpression, propertyName: string) =>
    expression.properties.find((property) => {
        if (!ts.isPropertyAssignment(property)) return false;

        return getPropertyNameText(property.name) === propertyName;
    });

const extractRouterPlugins = (
    routerConfigExpression: ts.Expression | undefined,
    imports: Map<string, string>,
    servicesAvailable: TServicesAvailable,
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

        const routerPlugin = parseServiceInstantiation(registeredName, property.initializer, imports, servicesAvailable, 0);
        if (!routerPlugin) continue;

        routerPlugins.push(routerPlugin);
    }

    return routerPlugins;
};

const parseAppBootstrap = (servicesAvailable: TServicesAvailable): TParsedAppBootstrap => {
    const sourceFile = createSourceFile(getAppServerEntryFilepath());
    const imports = buildImportIndex(sourceFile);
    const appClass = getDefaultExportClassDeclaration(sourceFile);

    const rootServices: TParsedService[] = [];
    let routerPlugins: TParsedService[] = [];

    for (const member of appClass.members) {
        if (!ts.isPropertyDeclaration(member) || !member.initializer) continue;

        const registeredName = getPropertyNameText(member.name);
        if (!registeredName) continue;

        const rootService = parseServiceInstantiation(registeredName, member.initializer, imports, servicesAvailable, 1);
        if (!rootService) continue;

        rootServices.push(rootService);

        if (rootService.meta.id === 'Core/Router') {
            const initializer = unwrapExpression(member.initializer);
            if (!ts.isNewExpression(initializer)) continue;

            routerPlugins = extractRouterPlugins(initializer.arguments?.[1], imports, servicesAvailable);
        }
    }

    if (rootServices.length === 0) {
        throw new Error(`No root services were found in ${sourceFile.fileName}.`);
    }

    return { rootServices, routerPlugins };
};

const commandServiceSearchRoots = [
    { root: normalizeAbsolutePath(path.join(cli.paths.core.root, 'server', 'services')), prefix: '@server/services/' },
    { root: normalizeAbsolutePath(path.join(app.paths.root, 'server', 'services')), prefix: '@/server/services/' },
];

const resolveExistingModuleFilepath = (importPath: string) => {
    const candidates = [importPath, `${importPath}.ts`, `${importPath}.tsx`, path.join(importPath, 'index.ts'), path.join(importPath, 'index.tsx')];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        if (!fs.statSync(candidate).isFile()) continue;

        return normalizeAbsolutePath(candidate);
    }

    return undefined;
};

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
    imports: Map<string, string>,
    sourceFilepath: string,
    getStubTypeName: (source: TCommandServiceStubSource) => string,
    enqueueStub: (source: TCommandServiceStubSource) => void,
) => {
    const initializer = property.initializer ? unwrapExpression(property.initializer) : undefined;

    if (initializer && ts.isNewExpression(initializer)) {
        if (ts.isIdentifier(initializer.expression)) {
            const nestedImportPath = imports.get(initializer.expression.text);
            if (nestedImportPath) {
                const nestedSource = resolveCommandServiceStubSource(nestedImportPath, sourceFilepath);

                if (nestedSource) {
                    enqueueStub(nestedSource);
                    return getStubTypeName(nestedSource);
                }
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
        const source = resolveCommandServiceStubSource(rootService.meta.importationPath);
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
    id: service.meta.id,
    registeredName: service.registeredName,
    metaName: service.meta.name,
    parent,
    priority: service.priority || service.meta.priority || 0,
    importPath: service.meta.importationPath,
    sourceDir: service.meta.sourceDir,
    metasFilepath: service.meta.metasFilepath,
    scope: service.meta.scope,
});

export const generateServiceArtifacts = () => {
    const servicesAvailable = buildServicesAvailable();
    const { rootServices, routerPlugins } = parseAppBootstrap(servicesAvailable);
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
    __proteumClientContexts?: Record<string, React.Context<ClientContext>>;
};

const globalClientContextStore = globalThis as GlobalClientContextStore;
const clientContexts = (globalClientContextStore.__proteumClientContexts ??= {});

export const ReactClientContext =
    clientContexts['${appClassIdentifier}'] ?? (clientContexts['${appClassIdentifier}'] = React.createContext<ClientContext>({} as ClientContext));
export default (): ClientContext => React.useContext<ClientContext>(ReactClientContext);`,
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
        const typeName = commandServiceStubs.typeNamesByAliasImportPath.get(service.meta.importationPath) || 'any';

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
