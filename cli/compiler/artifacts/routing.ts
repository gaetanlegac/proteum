import path from 'path';
import fs from 'fs-extra';

import app from '../../app';
import cli from '../..';
import writeIfChanged from '../writeIfChanged';
import { TProteumManifestLayout, TProteumManifestRoute } from '../common/proteumManifest';
import {
    getGeneratedRouteModuleFilepath,
    indexRouteDefinitions,
    writeGeneratedRouteModule,
} from '../common/generatedRouteModules';
import {
    findClientRouteFiles,
    findLayoutFiles,
    findServerRouteFiles,
    readPreloadedRouteChunks,
} from './discovery';
import { getGeneratedImportPath, normalizeAbsolutePath, normalizePath } from './shared';

type TClientRouteLoader = { filepath: string; chunkId: string; preload: boolean };

const cleanupObsoleteGeneratedArtifacts = () => {
    fs.removeSync(path.join(app.paths.root, 'client', '.generated'));
    fs.removeSync(path.join(app.paths.root, 'common', '.generated'));
    fs.removeSync(path.join(app.paths.root, 'server', '.generated'));
    fs.removeSync(path.join(app.paths.root, 'common', 'generated.d.ts'));
    fs.removeSync(path.join(app.paths.root, '.proteum', 'client', '.generated'));
    fs.removeSync(path.join(app.paths.root, '.proteum', 'common', '.generated'));
    fs.removeSync(path.join(app.paths.root, '.proteum', 'server', '.generated'));
    fs.removeSync(path.join(app.paths.client.generated, 'route-modules'));
    fs.removeSync(path.join(app.paths.server.generated, 'route-modules'));
    fs.removeSync(path.join(app.paths.client.generated, 'index.ts'));
};

const getGeneratedClientRouteModuleFilepath = (filepath: string) =>
    getGeneratedRouteModuleFilepath(app.paths.client.generated, app.paths.pages, filepath);

const getGeneratedServerRouteModuleFilepath = (filepath: string) =>
    getGeneratedRouteModuleFilepath(app.paths.server.generated, app.paths.root, filepath);

const buildClientRouteManifestEntry = (filepath: string): TProteumManifestRoute => {
    const [definition] = indexRouteDefinitions({ side: 'client', sourceFilepath: filepath });
    const pageChunk = cli.paths.getPageChunk(app, filepath);

    return {
        kind: definition.methodName === 'error' ? 'client-error' : 'client-page',
        methodName: definition.methodName,
        serviceLocalName: definition.serviceLocalName,
        filepath: normalizeAbsolutePath(filepath),
        sourceLocation: definition.sourceLocation,
        targetResolution: definition.targetResolution,
        path: definition.path,
        pathRaw: definition.pathRaw,
        code: definition.code,
        codeRaw: definition.codeRaw,
        optionKeys: definition.optionKeys,
        normalizedOptionKeys: definition.normalizedOptionKeys,
        invalidOptionKeys: definition.invalidOptionKeys,
        reservedOptionKeys: definition.reservedOptionKeys,
        optionsRaw: definition.optionsRaw,
        hasData: definition.hasData,
        chunkId: pageChunk.chunkId,
        chunkFilepath: normalizePath(pageChunk.filepath),
        scope: 'app',
    };
};

const buildServerRouteManifestEntries = (filepath: string) =>
    indexRouteDefinitions({ side: 'server', sourceFilepath: filepath }).map<TProteumManifestRoute>((definition) => ({
        kind: 'server-route',
        methodName: definition.methodName,
        serviceLocalName: definition.serviceLocalName,
        filepath: normalizeAbsolutePath(filepath),
        sourceLocation: definition.sourceLocation,
        targetResolution: definition.targetResolution,
        path: definition.path,
        pathRaw: definition.pathRaw,
        code: definition.code,
        codeRaw: definition.codeRaw,
        optionKeys: definition.optionKeys,
        normalizedOptionKeys: definition.normalizedOptionKeys,
        invalidOptionKeys: definition.invalidOptionKeys,
        reservedOptionKeys: definition.reservedOptionKeys,
        optionsRaw: definition.optionsRaw,
        hasData: definition.hasData,
        scope: 'app',
    }));

const generateClientRouteWrapperModules = () => {
    const clientRouteFiles = findClientRouteFiles(app.paths.pages).sort((a, b) => a.localeCompare(b));
    const routeSourceFilepaths = new Set(clientRouteFiles.map((filepath) => normalizePath(path.resolve(filepath))));
    const routes = clientRouteFiles.map((filepath) => buildClientRouteManifestEntry(filepath));

    for (const filepath of clientRouteFiles) {
        const pageChunk = cli.paths.getPageChunk(app, filepath);

        writeGeneratedRouteModule({
            outputFilepath: getGeneratedClientRouteModuleFilepath(filepath),
            runtime: 'client',
            side: 'client',
            sourceFilepath: filepath,
            clientRoute: { chunkId: pageChunk.chunkId },
            routeSourceFilepaths,
        });

        writeGeneratedRouteModule({
            outputFilepath: getGeneratedServerRouteModuleFilepath(filepath),
            runtime: 'server',
            side: 'client',
            sourceFilepath: filepath,
            clientRoute: { chunkId: pageChunk.chunkId },
            routeSourceFilepaths,
        });
    }

    return routes;
};

const generateServerRouteWrapperModules = () => {
    const serverRouteFiles = findServerRouteFiles(path.join(app.paths.root, 'server', 'routes')).sort((a, b) =>
        a.localeCompare(b),
    );
    const routeSourceFilepaths = new Set(serverRouteFiles.map((filepath) => normalizePath(path.resolve(filepath))));
    const routes = serverRouteFiles.flatMap((filepath) => buildServerRouteManifestEntries(filepath));

    for (const filepath of serverRouteFiles) {
        writeGeneratedRouteModule({
            outputFilepath: getGeneratedServerRouteModuleFilepath(filepath),
            runtime: 'server',
            side: 'server',
            sourceFilepath: filepath,
            routeSourceFilepaths,
        });
    }

    return routes;
};

const generateClientRoutesModule = () => {
    const routeLoadersFile = path.join(app.paths.client.generated, 'routes.ts');
    const preloadedChunks = readPreloadedRouteChunks();

    const routes = findClientRouteFiles(app.paths.pages)
        .sort((a, b) => a.localeCompare(b))
        .map<TClientRouteLoader>((filepath) => {
            const { chunkId } = cli.paths.getPageChunk(app, filepath);

            return { filepath, chunkId, preload: preloadedChunks.has(chunkId) };
        });

    const imports: string[] = [];
    const routeEntries: string[] = [];

    routes.forEach((route, index) => {
        const normalizedImportPath = getGeneratedImportPath(
            app.paths.client.generated,
            getGeneratedClientRouteModuleFilepath(route.filepath),
        );

        if (route.preload) {
            const localIdentifier = `preloadedRoute${index}`;
            imports.push(`import { __register as ${localIdentifier} } from ${JSON.stringify(normalizedImportPath)};`);
            routeEntries.push(
                `    ${JSON.stringify(route.chunkId)}: () => Promise.resolve({ __register: ${localIdentifier} }),`,
            );
            return;
        }

        routeEntries.push(
            `    ${JSON.stringify(route.chunkId)}: () => import(/* webpackChunkName: ${JSON.stringify(route.chunkId)} */ ${JSON.stringify(normalizedImportPath)}),`,
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

    writeIfChanged(routeLoadersFile, content);
};

const generateClientLayoutsModule = () => {
    const layoutsFile = path.join(app.paths.client.generated, 'layouts.ts');

    const layouts = findLayoutFiles(app.paths.pages)
        .map<TProteumManifestLayout>((filepath) => {
            const { chunkId } = cli.paths.getLayoutChunk(app, filepath);
            const importPath = getGeneratedImportPath(app.paths.client.generated, filepath);
            const relativePath = normalizePath(path.relative(app.paths.root, filepath));
            const depth = relativePath.split('/').filter(Boolean).length;

            return {
                filepath: normalizeAbsolutePath(filepath),
                chunkId,
                depth,
                importPath,
                scope: 'app',
            };
        })
        .sort((a, b) => {
            if (b.depth !== a.depth) return b.depth - a.depth;
            return a.filepath.localeCompare(b.filepath);
        });

    const imports = layouts
        .map((layout, index) => `import * as layoutModule${index} from ${JSON.stringify(layout.importPath)};`)
        .join('\n');

    const layoutEntries = layouts
        .map((layout, index) => `    ${JSON.stringify(layout.chunkId)}: layoutModule${index},`)
        .join('\n');

    const orderedLayoutIds = layouts.map((layout) => `    ${JSON.stringify(layout.chunkId)},`).join('\n');

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from app layout files.
// Do not edit it manually.

${imports}
${imports ? '\n' : ''}const layouts = {
${layoutEntries}
};

export const layoutOrder = [
${orderedLayoutIds}
];

export default layouts;
`;

    writeIfChanged(layoutsFile, content);

    return layouts;
};

const generateServerRoutesModule = () => {
    const routeModulesFile = path.join(app.paths.server.generated, 'routes.ts');
    const serverRouteFiles = findServerRouteFiles(path.join(app.paths.root, 'server', 'routes'))
        .sort((a, b) => a.localeCompare(b))
        .map((filepath) => ({
            filepath: normalizePath(path.relative(app.paths.root, filepath)),
            importPath: getGeneratedImportPath(app.paths.server.generated, getGeneratedServerRouteModuleFilepath(filepath)),
        }));

    const pageRouteFiles = findClientRouteFiles(app.paths.pages)
        .sort((a, b) => a.localeCompare(b))
        .map((filepath) => ({
            filepath: normalizePath(path.relative(app.paths.root, filepath)),
            importPath: getGeneratedImportPath(app.paths.server.generated, getGeneratedServerRouteModuleFilepath(filepath)),
        }));

    const routeModules = [...serverRouteFiles, ...pageRouteFiles];

    const imports = routeModules
        .map((routeModule, index) => `const routeModule${index} = require(${JSON.stringify(routeModule.importPath)});`)
        .join('\n');

    const routeEntries = routeModules
        .map(
            (routeModule, index) => `    {
        filepath: ${JSON.stringify(routeModule.filepath)},
        register: routeModule${index}.__register,
    },`,
        )
        .join('\n');

    const content = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from route registration files.
// Do not edit it manually.

import type { TRouteModule } from "@common/router";
${imports ? '\n' + imports : ''}

export type TGeneratedRouteModule = {
    filepath: string,
    register?: TRouteModule["__register"],
}

const routeModules: TGeneratedRouteModule[] = [
${routeEntries}
];

export default routeModules;
`;

    writeIfChanged(routeModulesFile, content);
};

export const generateRoutingArtifacts = () => {
    cleanupObsoleteGeneratedArtifacts();
    const clientRoutes = generateClientRouteWrapperModules();
    const serverRoutes = generateServerRouteWrapperModules();
    generateServerRoutesModule();
    generateClientRoutesModule();
    const layouts = generateClientLayoutsModule();

    return { clientRoutes, serverRoutes, layouts };
};
