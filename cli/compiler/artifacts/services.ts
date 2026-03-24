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
