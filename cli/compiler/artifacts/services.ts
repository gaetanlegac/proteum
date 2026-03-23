import path from 'path';
import fs from 'fs-extra';
import serialize from 'serialize-javascript';

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
    dependences: string;
    importationPath: string;
    priority: number;
    sourceDir: string;
    metasFilepath: string;
    scope: TProteumManifestScope;
};

type TRegisteredService = {
    id?: string;
    name: string;
    className: string;
    instanciation: (parentRef?: string, appRef?: string) => string;
    priority: number;
};

export const generateServiceArtifacts = () => {
    const searchDirs = [
        { path: '@server/services/', priority: -1, root: path.join(cli.paths.core.root, 'server', 'services') },
        { path: '@/server/services/', priority: 0, root: path.join(app.paths.root, 'server', 'services') },
    ];

    const servicesAvailable: { [id: string]: TServiceMetas } = {};
    for (const searchDir of searchDirs) {
        const services = findServiceDirectories(searchDir.root);

        for (const serviceDir of services) {
            const metasFile = path.join(serviceDir, 'service.json');
            const importationPath = searchDir.path + serviceDir.substring(searchDir.root.length + 1);
            const serviceMetas = fs.readJsonSync(metasFile) as {
                id: string;
                name: string;
                parent: string;
                dependences: string;
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

    const imported: string[] = [];
    const referencedNames: { [serviceId: string]: string } = {};
    let serviceImportIndex = 0;

    const refService = (serviceName: string, serviceConfig: any): TRegisteredService => {
        if (serviceConfig.refTo !== undefined) {
            const refTo = serviceConfig.refTo;
            return {
                name: serviceName,
                className: serviceName,
                instanciation: (_parentRef, appRef = 'this') => `${appRef}.${refTo}`,
                priority: 0,
            };
        }

        const serviceMetas = servicesAvailable[serviceConfig.id];
        if (serviceMetas === undefined) {
            throw new Error(
                `Service ${serviceConfig.id} not found. Referenced services: ${Object.keys(servicesAvailable).join('\n')}`,
            );
        }

        const referencedName = referencedNames[serviceConfig.id];
        if (referencedName !== undefined) {
            throw new Error(`Service ${serviceConfig.id} is already setup as ${referencedName}`);
        }

        const importIdentifier = `${serviceMetas.name}Class${serviceImportIndex++}`;
        imported.push(`import ${importIdentifier} from "${serviceMetas.importationPath}";`);

        if (serviceConfig.name !== undefined) referencedNames[serviceConfig.id] = serviceConfig.name;

        const processConfig = (config: any, nestingLevel: number = 0, appRef: string = 'this') => {
            let propsStr = '';
            for (const key in config) {
                const value = config[key];

                if (!value || typeof value !== 'object') {
                    propsStr += `"${key}":${serialize(value, { space: 4 })},\n`;
                } else if (value.type === 'service.setup' || value.type === 'service.ref') {
                    propsStr += `${key}:` + refService(key, value).instanciation(undefined, appRef) + ',\n';
                } else if (nestingLevel <= 4 && !Array.isArray(value)) {
                    propsStr += `"${key}":` + processConfig(value, nestingLevel + 1, appRef) + ',\n';
                } else {
                    propsStr += `"${key}":${serialize(value, { space: 4 })},\n`;
                }
            }

            return `{ ${propsStr} }`;
        };

        const instanciation = (parentRef?: string, appRef: string = 'this') => {
            const config = processConfig(serviceConfig.config || {}, 0, appRef);
            const typedRouterConfig =
                serviceMetas.id === 'Core/Router' && parentRef
                    ? `defineServiceConfig(${config} satisfies ConstructorParameters<typeof ${importIdentifier}>[1])`
                    : `defineServiceConfig(${config})`;

            return `new ${importIdentifier}( 
                    ${parentRef ? `${parentRef},` : ''}
                    ${typedRouterConfig},
                    ${appRef} 
                )`;
        };

        return {
            id: serviceConfig.id,
            name: serviceName,
            instanciation,
            className: importIdentifier,
            priority: serviceConfig.config?.priority || serviceMetas.priority || 0,
        };
    };

    const resolveManifestService = (
        registeredName: string,
        serviceConfig: any,
        parent: string,
    ): TProteumManifestService => {
        if (serviceConfig.refTo !== undefined) {
            return {
                kind: 'ref',
                registeredName,
                parent,
                priority: 0,
                refTo: serviceConfig.refTo,
                scope: 'app',
            };
        }

        const serviceMetas = servicesAvailable[serviceConfig.id];
        if (serviceMetas === undefined) {
            throw new Error(
                `Service ${serviceConfig.id} not found. Referenced services: ${Object.keys(servicesAvailable).join('\n')}`,
            );
        }

        return {
            kind: 'service',
            id: serviceMetas.id,
            registeredName,
            metaName: serviceMetas.name,
            parent,
            priority: serviceConfig.config?.priority || serviceMetas.priority || 0,
            importPath: serviceMetas.importationPath,
            sourceDir: serviceMetas.sourceDir,
            metasFilepath: serviceMetas.metasFilepath,
            scope: serviceMetas.scope,
        };
    };

    const registeredServices = Object.values(app.registered as Record<string, any>);
    const servicesCode = registeredServices.map((service) => refService(service.name, service));
    const sortedServices = servicesCode.sort((a, b) => a.priority - b.priority);
    const appServices = registeredServices
        .map<TProteumManifestService>((service) => resolveManifestService(service.name, service, 'app'))
        .sort((a, b) => a.registeredName.localeCompare(b.registeredName));
    const routerConfig = (app.registered as Record<string, any>)['Router']?.config;
    const routerPlugins = Object.entries(routerConfig?.plugins || {})
        .map<TProteumManifestService>(([registeredName, serviceConfig]) =>
            resolveManifestService(registeredName, serviceConfig, 'Router.plugins'),
        )
        .sort((a, b) => a.registeredName.localeCompare(b.registeredName));

    const appClassIdentifier = app.identity.identifier;
    const containerServices = app.containerServices.map((serviceName) => "'" + serviceName + "'").join('|');
    const generatedFactories = sortedServices
        .map((service) => {
            const factoryIdentifier = `create${service.className}`;
            const instanceIdentifier = `${service.className}Instance`;

            return `const ${factoryIdentifier} = (app: ${appClassIdentifier}) => ${service.instanciation('app', 'app')};

type ${instanceIdentifier} = ReturnType<typeof ${factoryIdentifier}>;`;
        })
        .join('\n\n');

    writeIfChanged(
        path.join(app.paths.client.generated, 'services.d.ts'),
        `declare type ${appClassIdentifier} = import("@generated/server/app").default;

declare module "@app" {

    import { ${appClassIdentifier} as ${appClassIdentifier}Client } from "@/client";
    import ${appClassIdentifier}Server from "@generated/server/app";
  
    export const Router: ${appClassIdentifier}Client['Router'];

    ${sortedServices
        .map((service) =>
            service.name !== 'Router'
                ? `export const ${service.name}: ${appClassIdentifier}Server["${service.name}"];`
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

export const ReactClientContext = React.createContext<ClientContext>({} as ClientContext);
export default (): ClientContext => React.useContext<ClientContext>(ReactClientContext);`,
    );

    writeIfChanged(
        path.join(app.paths.common.generated, 'services.d.ts'),
        `declare type ${appClassIdentifier} = import("@generated/server/app").default;

declare module '@models/types' {
    export * from '@generated/common/models';
}`,
    );

    writeIfChanged(
        path.join(app.paths.common.generated, 'models.ts'),
        `export * from '@/var/prisma/browser';
`,
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'app.ts'),
        `
import { Application } from '@server/app/index';
import { ServicesContainer } from '@server/app/service/container';

${imported.join('\n')}

type TLooseServiceConfig<TConfig> =
    TConfig extends (...args: any[]) => any ? TConfig
    : TConfig extends Array<infer TItem> ? Array<TLooseServiceConfig<TItem>>
    : TConfig extends object ? ({ [K in keyof TConfig]?: TLooseServiceConfig<TConfig[K]> } & Record<string, unknown>)
    : TConfig;

const defineServiceConfig = <TConfig>(value: TConfig): TConfig => value;

${generatedFactories}

export type InstalledServices = {
    ${sortedServices.map((service) => `${service.name}: ${service.className}Instance;`).join('\n    ')}
};

export default class ${appClassIdentifier} extends Application<ServicesContainer<InstalledServices>, CurrentUser> {

    // Make sure the services typigs are reflecting the config and referring to the app
    ${sortedServices.map((service) => `public ${service.name}!: ${service.className}Instance;`).join('\n')}

    protected registered: Record<string, { name: string; priority: number; start: () => import('@server/app/service').AnyService }> = {
        ${sortedServices
            .map(
                (service) =>
                    `"${service.id}": {
                name: "${service.name}",
                priority: ${service.priority},
                start: () => create${service.className}(this)
            }`,
            )
            .join(',\n')}
    };
}


`,
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'models.ts'),
        `export * from '@/var/prisma/client';
`,
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'services.d.ts'),
        `type InstalledServices = import("@generated/server/app").InstalledServices;

declare type ${appClassIdentifier} = import("@generated/server/app").default;

declare module '@cli/app' {

    type TSetupConfig<TConfig> =
        TConfig extends (...args: any[]) => any ? TConfig
        : TConfig extends Array<infer TItem> ? Array<TSetupConfig<TItem>>
        : TConfig extends object ? ({
            [K in keyof TConfig]?: TSetupConfig<TConfig[K]> | TServiceSetup | TServiceRef
        } & Record<string, unknown>)
        : TConfig;

    type App = {

        env: TEnvConfig;

        use: (referenceName: string) => TServiceRef;

        setup: <TServiceName extends keyof ${appClassIdentifier}>(...args: [
            servicePath: string,
            serviceConfig?: {}
        ] | [
            serviceName: TServiceName, 
            servicePath: string,
            serviceConfig?: TSetupConfig<${appClassIdentifier}[TServiceName]["config"]>
        ]) => TServiceSetup;
    }
    const app: App;
    export = app;
}

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

    return { app: appServices, routerPlugins };
};
