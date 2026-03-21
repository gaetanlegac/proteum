/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import webpack from 'webpack';
import fs from 'fs-extra';
import serialize from 'serialize-javascript';

import SpeedMeasurePlugin from "speed-measure-webpack-v5-plugin";
const smp = new SpeedMeasurePlugin({ disable: true });

// Core
import app from '../app';
import cli from '..';
import createServerConfig from './server';
import createClientConfig from './client';
import { TCompileMode, TCompileOutputTarget } from './common';

type TCompilerCallback = (compiler: webpack.Compiler) => void

type TServiceMetas = {
    id: string, 
    name: string, 
    parent: string, 
    dependences: string, 
    importationPath: string,
    priority: number
}

type TRegisteredService = {
    id?: string,
    name: string,
    className: string,
    instanciation: (parentRef?: string) => string,
    priority: number,
}

type TClientRouteLoader = {
    filepath: string,
    chunkId: string,
    preload: boolean,
}

/*----------------------------------
- FONCTION
----------------------------------*/
export default class Compiler {

    public compiling: { [compiler: string]: Promise<void> } = {};     
    private recentCompilationResults: { [compiler: string]: boolean } = {};

    public constructor(
        private mode: TCompileMode,
        private callbacks: {
            before?: TCompilerCallback,
            after?: TCompilerCallback,
        } = {},
        private debug: boolean = false,
        private outputTarget: TCompileOutputTarget = mode === 'dev' ? 'dev' : 'bin'
    ) {

    }

    public cleanup() {
        const outputPath = app.outputPath(this.outputTarget);
        const generatedPublicEntries = new Set(['app']);
        const outputPublicPath = path.join(outputPath, 'public');
        const preserveDevOutput = this.mode === 'dev' && this.outputTarget === 'dev';

        if (!preserveDevOutput)
            fs.emptyDirSync(outputPath);

        fs.ensureDirSync(outputPublicPath);
        this.syncPublicEntries(outputPublicPath, generatedPublicEntries, this.mode === 'dev');
    }
    /* FIX issue with npm link
        When we install a module with npm link, this module's deps are not installed in the parent project scope
        Which causes some issues:
        - The module's deps are not found by Typescript
        - Including React, so VSCode shows that JSX is missing
    */
    public fixNpmLinkIssues() {
        const corePath = path.join(app.paths.root, '/node_modules/proteum');
        if (!fs.lstatSync( corePath ).isSymbolicLink())
            return console.info("Not fixing npm issue because proteum wasn't installed with npm link.");

        this.debug && console.info(`Fix NPM link issues ...`);
        const outputPath = app.outputPath(this.outputTarget);

        const appModules = path.join(app.paths.root, 'node_modules');
        const coreModules = path.join(corePath, 'node_modules');

        // When the 5htp package is installed from npm link,
        // Modules are installed locally and not glbally as with with the 5htp package from NPM.
        // So we need to symbilnk the http-core node_modules in one of the parents of server.js.
        // It avoids errors like: "Error: Cannot find module 'intl'"
        this.ensureSymlinkSync(coreModules, path.join(outputPath, 'node_modules'));

        // Same problem: when 5htp-core is installed via npm link, 
        // Typescript doesn't detect React and shows mission JSX errors
        const preactCoreModule = path.join(coreModules, 'preact');
        const preactAppModule = path.join(appModules, 'preact');
        const reactAppModule = path.join(appModules, 'react');

        if (!fs.existsSync( preactAppModule ))
            fs.symlinkSync( preactCoreModule, preactAppModule );
        if (!fs.existsSync( reactAppModule ))
            fs.symlinkSync( path.join(preactCoreModule, 'compat'), reactAppModule );
    }

    private syncPublicEntries(
        outputPublicPath: string,
        generatedPublicEntries: Set<string>,
        useSymlinks: boolean
    ) {
        const publicFiles = new Set(
            fs.readdirSync(app.paths.public).filter((publicFile) => !generatedPublicEntries.has(publicFile))
        );

        for (const existingPublicFile of fs.readdirSync(outputPublicPath)) {
            if (generatedPublicEntries.has(existingPublicFile) || publicFiles.has(existingPublicFile))
                continue;

            fs.removeSync(path.join(outputPublicPath, existingPublicFile));
        }

        for (const publicFile of publicFiles) {
            const sourcePath = path.join(app.paths.public, publicFile);
            const outputFilePath = path.join(outputPublicPath, publicFile);

            if (useSymlinks) {
                this.ensureSymlinkSync(sourcePath, outputFilePath);
                continue;
            }

            if (fs.existsSync(outputFilePath))
                fs.removeSync(outputFilePath);

            fs.copySync(sourcePath, outputFilePath);
        }
    }

    private ensureSymlinkSync(targetPath: string, linkPath: string) {
        fs.ensureDirSync(path.dirname(linkPath));

        try {
            const linkStats = fs.lstatSync(linkPath);

            if (linkStats.isSymbolicLink()) {
                const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
                if (currentTarget === path.resolve(targetPath))
                    return;
            }

            fs.removeSync(linkPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }

        fs.symlinkSync(targetPath, linkPath);
    }

    private findServices( dir: string ) {

        const blacklist = ['node_modules', 'proteum']
        const files: string[] = [];
        const dirents = fs.readdirSync(dir, { withFileTypes: true });

        for (let dirent of dirents) {

            let fileName = dirent.name;
            let filePath = path.resolve(dir, fileName);

            if (blacklist.includes( fileName ))
                continue;

            // Define is we should recursively find service in the current item
            let iterate: boolean = false;
            if (dirent.isSymbolicLink()) {

                const realPath = path.resolve( dir, fs.readlinkSync(filePath) );
                const destinationInfos = fs.lstatSync( realPath );
                if (destinationInfos.isDirectory())
                    iterate = true;

            } else if (dirent.isDirectory())
                iterate = true;

            // Update the list of found services
            if (iterate) {
                files.push( ...this.findServices(filePath) );
            } else if (dirent.name === 'service.json') {
                files.push( path.dirname(filePath) );
            }
        }
        return files;
    }

    private findClientRouteFiles(dir: string): string[] {

        const files: string[] = [];

        for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
            const filePath = path.join(dir, dirent.name);

            if (dirent.isDirectory()) {
                if (dirent.name === '_layout')
                    continue;

                files.push(...this.findClientRouteFiles(filePath));
                continue;
            }

            if (!dirent.isFile())
                continue;

            if (!/^[a-z0-9]*\.tsx$/.test(dirent.name))
                continue;

            files.push(filePath);
        }

        return files;
    }

    private readPreloadedRouteChunks() {
        const preloadPath = path.join(app.paths.pages, 'preload.json');

        if (!fs.existsSync(preloadPath))
            return new Set<string>();

        const content = fs.readJsonSync(preloadPath);

        if (!Array.isArray(content))
            throw new Error(`Invalid client/pages/preload.json format: expected an array of chunk ids.`);

        return new Set<string>(content.filter((value): value is string => typeof value === 'string'));
    }

    private generateClientRoutesModule() {

        const routeLoadersFile = path.join(app.paths.client.generated, 'routes.ts');
        const preloadedChunks = this.readPreloadedRouteChunks();

        const routes = this.findClientRouteFiles(app.paths.pages)
            .sort((a, b) => a.localeCompare(b))
            .map<TClientRouteLoader>((filepath) => {
                const { chunkId } = cli.paths.getPageChunk(app, filepath);

                return {
                    filepath,
                    chunkId,
                    preload: preloadedChunks.has(chunkId),
                };
            });

        const imports: string[] = [];
        const routeEntries: string[] = [];

        routes.forEach((route, index) => {
            const importPath = path.relative(app.paths.client.generated, route.filepath)
                .replace(/\\/g, '/');
            const normalizedImportPath = importPath.startsWith('.')
                ? importPath
                : './' + importPath;

            if (route.preload) {
                const localIdentifier = `preloadedRoute${index}`;
                imports.push(`import { __register as ${localIdentifier} } from ${JSON.stringify(normalizedImportPath)};`);
                routeEntries.push(
                    `    ${JSON.stringify(route.chunkId)}: () => Promise.resolve({ __register: ${localIdentifier} }),`
                );
                return;
            }

            routeEntries.push(
                `    ${JSON.stringify(route.chunkId)}: () => import(/* webpackChunkName: ${JSON.stringify(route.chunkId)} */ ${JSON.stringify(normalizedImportPath)}),`
            );
        });

        const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum to avoid rebuilding the page loader map in Babel.
// Do not edit it manually.

${imports.join('\n')}
${imports.length ? '\n' : ''}const routes = {
${routeEntries.join('\n')}
};

export default routes;
`;

        fs.outputFileSync(routeLoadersFile, content);
    }

    private indexServices() {
        

        // Index services
        const searchDirs = [
            // The less priority is the first
            {
                path: '@server/services/',
                priority: -1,
                root: path.join(cli.paths.core.root, 'server', 'services')
            },
            {
                path: '@/server/services/',
                priority: 0,
                root: path.join(app.paths.root, 'server', 'services')
            },
            // Temp disabled because compile issue on vercel
            //'': path.join(app.paths.root, 'node_modules'),
        ]

        // Generate app class file
        const servicesAvailable: {[id: string]: TServiceMetas} = {};
        for (const searchDir of searchDirs) {

            const services = this.findServices(searchDir.root);

            for (const serviceDir of services) {
                const metasFile = path.join( serviceDir, 'service.json');

                // The +1 is to remove the slash
                const importationPath = searchDir.path + serviceDir.substring( searchDir.root.length + 1 );

                const serviceMetas = require(metasFile);

                servicesAvailable[ serviceMetas.id ] = {
                    importationPath,
                    priority: searchDir.priority,
                    ...serviceMetas,
                };
            }
        }

        // Read app services
        const imported: string[] = []
        const referencedNames: {[serviceId: string]: string} = {} // ID to Name

        const refService = (serviceName: string, serviceConfig: any, level: number = 0): TRegisteredService => {

            if (serviceConfig.refTo !== undefined) {
                const refTo = serviceConfig.refTo;
                return {
                    name: serviceName,
                    instanciation: () => `this.${refTo}`,
                    priority: 0
                }
            }

            const serviceMetas = servicesAvailable[ serviceConfig.id ];
            if (serviceMetas === undefined)
                throw new Error(`Service ${serviceConfig.id} not found. Referenced services: ${Object.keys(servicesAvailable).join('\n')}`);

            const referencedName = referencedNames[serviceConfig.id];
            if (referencedName !== undefined)
                throw new Error(`Service ${serviceConfig.id} is already setup as ${referencedName}`);
            
            // Generate index & typings
            imported.push(`import ${serviceMetas.name} from "${serviceMetas.importationPath}";`);

            if (serviceConfig.name !== undefined)
                referencedNames[serviceConfig.id] = serviceConfig.name;

            const processConfig = (config: any, level: number = 0) => {

                let propsStr = '';
                for (const key in config) {
                    const value = config[key];

                    if (!value || typeof value !== 'object')
                        propsStr += `"${key}":${serialize(value, { space: 4 })},\n`;

                    // Reference to a service
                    else if (value.type === 'service.setup' || value.type === 'service.ref') // TODO: more reliable way to detect a service reference
                        propsStr += `${key}:`+ refService(key, value, level + 1).instanciation() + ',\n'
                    
                    // Recursion
                    else if (level <= 4 && !Array.isArray(value))
                        propsStr += `"${key}":` + processConfig(value, level + 1) + ',\n';

                    else
                        propsStr += `"${key}":${serialize(value, { space: 4 })},\n`;

                }

                return `{ ${propsStr} }`;
            }
            const config = processConfig(serviceConfig.config || {});

            // Generate the service instance
            const instanciation = (parentRef?: string) => 
                `new ${serviceMetas.name}( 
                    ${parentRef ? `${parentRef},` : ''}
                    ${config},
                    this 
                )`

            return {
                id: serviceConfig.id,
                name: serviceName,
                instanciation,
                className: serviceMetas.name,
                priority: serviceConfig.config?.priority || serviceMetas.priority || 0,
            };
        }

        const servicesCode = Object.values(app.registered).map( s => refService(s.name, s, 0));
        const sortedServices = servicesCode.sort((a, b) => a.priority - b.priority);

        // Define the app class identifier
        const appClassIdentifier = app.identity.identifier;
        const containerServices = app.containerServices.map( s => "'" + s + "'").join('|');

        // @/client/.generated/services.d.ts
        fs.outputFileSync(
            path.join( app.paths.client.generated, 'services.d.ts'),
`declare module "@app" {

    import { ${appClassIdentifier} as ${appClassIdentifier}Client } from "@/client";
    import ${appClassIdentifier}Server from "@/server/.generated/app";
  
    export const Router: ${appClassIdentifier}Client['Router'];

    ${sortedServices.map(service => service.name !== 'Router'
        ? `export const ${service.name}: ${appClassIdentifier}Server["${service.name}"];`
        : ''
    ).join('\n')}

}
    
declare module '@models/types' {
    export * from '@/var/prisma/index';
}

declare module '@common/errors' {
            
    export * from '@common/errors/index';
    export { default } from '@common/errors/index';

    export const AuthRequired: typeof import('@common/errors/index').AuthRequired<FeatureKeys>;
    export type AuthRequired = import('@common/errors/index').AuthRequired<FeatureKeys>;

    export const UpgradeRequired: typeof import('@common/errors/index').UpgradeRequired<FeatureKeys>;
    export type UpgradeRequired = import('@common/errors/index').UpgradeRequired<FeatureKeys>;
}

declare module '@request' {
    
}

declare namespace preact.JSX {
    interface HTMLAttributes {
        src?: string;
    }
}
`
        );

        // @/client/.generated/context.ts
        fs.outputFileSync(
            path.join( app.paths.client.generated, 'context.ts'),
`// TODO: move it into core (but how to make sure usecontext returns ${appClassIdentifier}'s context ?)
import React from 'react';

import type ${appClassIdentifier}Server from '@/server/.generated/app';
import type { TRouterContext as TServerRouterRequestContext } from '@server/services/router/response';
import type { TRouterContext as TClientRouterRequestContext } from '@client/services/router/response';
import type ${appClassIdentifier}Client from '.';

// TO Fix: TClientRouterRequestContext is unable to get the right type of ${appClassIdentifier}Client["router"]
    //    (it gets ClientApplication instead of ${appClassIdentifier}Client)
type ClientRequestContext = TClientRouterRequestContext<${appClassIdentifier}Client["Router"], ${appClassIdentifier}Client>;
type ServerRequestContext = TServerRouterRequestContext<${appClassIdentifier}Server["Router"]>
type UniversalServices = ClientRequestContext | ServerRequestContext

// Non-universla services are flagged as potentially undefined
export type ClientContext = (
    UniversalServices 
    & 
    Partial<Omit<ClientRequestContext, keyof UniversalServices>>
    &
    {
        Router: ${appClassIdentifier}Client["Router"],
    }
)

export const ReactClientContext = React.createContext<ClientContext>({} as ClientContext);
export default (): ClientContext => React.useContext<ClientContext>(ReactClientContext);`);

        // @/common/.generated/services.d.ts
        fs.outputFileSync(
            path.join( app.paths.common.generated, 'services.d.ts'),
`declare module '@models/types' {
    export * from '@/var/prisma/index';
}`
        );

        // @/server/.generated/app.ts
        fs.outputFileSync(
            path.join( app.paths.server.generated, 'app.ts'),
`
import { Application } from '@server/app/index';
import { ServicesContainer } from '@server/app/service/container';

${imported.join('\n')}

export default class ${appClassIdentifier} extends Application<ServicesContainer, CurrentUser> {

    // Make sure the services typigs are reflecting the config and referring to the app
    ${sortedServices.map(service => 
        `public ${service.name}!: ReturnType<${appClassIdentifier}["registered"]["${service.id}"]["start"]>;`
    ).join('\n')}

    protected registered = {
        ${sortedServices.map(service => 
            `"${service.id}": {
                name: "${service.name}",
                priority: ${service.priority},
                start: () => ${service.instanciation('this')}
            }`
        ).join(',\n')}
    } as const;
}


`);

        // @/server/.generated/services.d.ts
        fs.outputFileSync(
            path.join( app.paths.server.generated, 'services.d.ts'),
`type InstalledServices = import('./services').Services;

declare type ${appClassIdentifier} = import("@/server/.generated/app").default;

declare module '@cli/app' {

    type TSetupConfig<TConfig> =
        TConfig extends (...args: any[]) => any ? TConfig
        : TConfig extends Array<infer TItem> ? Array<TSetupConfig<TItem>>
        : TConfig extends object ? {
            [K in keyof TConfig]: TSetupConfig<TConfig[K]> | TServiceSetup | TServiceRef
        }
        : TConfig;

    type App = {

        env: TEnvConfig;

        use: (referenceName: string) => TServiceRef;

        setup: <TServiceName extends keyof ${appClassIdentifier}>(...args: [
            // { user: app.setup('Core/User') }
            servicePath: string,
            serviceConfig?: {}
        ] | [
            // app.setup('User', 'Core/User')
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

declare module '@request' {
    import type { TRouterContext } from '@server/services/router/response';
    const routerContext: TRouterContext<${appClassIdentifier}["Router"]>;
    export = routerContext;
}
    
declare module '@models' {
    import { Prisma, PrismaClient } from '@/var/prisma/index';
  
    type ModelNames = Prisma.ModelName;
  
    type ModelDelegates = {
      [K in ModelNames]: PrismaClient[Uncapitalize<K>];
    };
  
    const models: ModelDelegates;
  
    export = models;
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
    export * from '@/var/prisma/index';
}`
        );
    }

    private async warmupApp() {

        await app.warmup();

    }

    public async refreshGeneratedTypings() {

        await this.warmupApp();

        this.indexServices();
        this.generateClientRoutesModule();

    }

    public consumeRecentCompilationResults() {
        const recentCompilationResults = { ...this.recentCompilationResults };
        this.recentCompilationResults = {};
        return recentCompilationResults;
    }

    public async create() {

        await this.warmupApp();

        this.cleanup();

        this.fixNpmLinkIssues();

        this.indexServices();
        this.generateClientRoutesModule();

        // Create compilers
        const multiCompiler = webpack([
            smp.wrap( createServerConfig(app, this.mode, this.outputTarget) ),
            smp.wrap( createClientConfig(app, this.mode, this.outputTarget) )
        ]);

        for (const compiler of multiCompiler.compilers) {

            const name = compiler.name;
            if (name === undefined)
                throw new Error(`A name must be specified to each compiler.`);

            let timeStart = new Date();

            let finished: (() => void);
            this.compiling[name] = new Promise((resolve) => finished = resolve);

            if (name === 'client') {
                const refreshClientRoutes = async () => {
                    this.generateClientRoutesModule();
                };

                compiler.hooks.beforeRun.tapPromise(name, refreshClientRoutes);
                compiler.hooks.watchRun.tapPromise(name, refreshClientRoutes);
            }

            compiler.hooks.compile.tap(name, (compilation) => {
                
                this.callbacks.before && this.callbacks.before( compiler );

                this.compiling[name] = new Promise((resolve) => finished = resolve);

                timeStart = new Date();
                console.info(`[${name}] Compiling ...`);
            });

            /* TODO: Ne pas résoudre la promise tant que la recompilation des données indexées (icones, identité, ...) 
                n'a pas été achevée */
            compiler.hooks.done.tap(name, stats => {
                const compilationSucceeded = !stats.hasErrors();
                this.recentCompilationResults[name] = compilationSucceeded;

                // Shiow status
                const timeEnd = new Date();
                const time = timeEnd.getTime() - timeStart.getTime();
                if (!compilationSucceeded) {

                    console.info(stats.toString(compiler.options.stats));
                    console.error(`[${name}] Failed to compile after ${time} ms`);

                    // Exit process with code 0, so the CI container can understand building failed
                    // Only in prod, because in dev, we want the compiler watcher continue running
                    if (this.mode === 'prod')
                        process.exit(0);

                } else {
                    this.debug && console.info(stats.toString(compiler.options.stats));
                    console.info(`[${name}] Finished compilation after ${time} ms`);
                }

                // Mark as finished
                finished();
                delete this.compiling[name];
            });
        }

        return multiCompiler;

    }

}
