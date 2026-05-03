import path from 'path';

import app from '../../app';
import cli from '../..';
import { indexControllers, printControllerTree, type TControllerFileMeta } from '../common/controllers';
import { TProteumManifestController } from '../common/proteumManifest';
import writeIfChanged from '../writeIfChanged';
import { resolveConnectedProjectContracts, writeConnectedProjectContract } from './connectedProjects';
import { normalizeAbsolutePath } from './shared';

const reservedConnectedContextKeys = new Set(['app', 'context', 'request', 'response', 'route', 'api', 'Router']);

const getManifestScopeFromImportPath = (importPath: string) =>
    importPath.startsWith('@server/controllers/') ? 'framework' : 'app';

const insertTreeLeaf = (tree: Record<string, any>, accessor: string, value: string) => {
    const segments = accessor.split('.').filter(Boolean);
    let cursor = tree;

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const isLeaf = index === segments.length - 1;

        if (isLeaf) {
            cursor[segment] = value;
            return;
        }

        cursor[segment] = cursor[segment] || {};
        cursor = cursor[segment];
    }
};

const buildLocalControllers = (): TControllerFileMeta[] =>
    indexControllers([
        { importPrefix: '@server/controllers/', root: path.join(cli.paths.core.root, 'server', 'controllers') },
        { importPrefix: '@/server/controllers/', root: path.join(app.paths.root, 'server', 'controllers') },
    ]);

const assertConnectedProjectNamespaces = (localControllers: TControllerFileMeta[]) => {
    const localTopLevelKeys = new Set<string>();

    for (const controller of localControllers) {
        for (const method of controller.methods) {
            const topLevelKey = method.routePath.split('/')[0];
            if (topLevelKey) localTopLevelKeys.add(topLevelKey);
        }
    }

    for (const namespace of Object.keys(app.connectedProjects)) {
        if (reservedConnectedContextKeys.has(namespace)) {
            throw new Error(`Connected project namespace "${namespace}" collides with a reserved route context key.`);
        }

        if (localTopLevelKeys.has(namespace)) {
            throw new Error(`Connected project namespace "${namespace}" collides with an existing local controller root.`);
        }
    }
};

export const generateControllerArtifacts = async () => {
    const localControllers = buildLocalControllers();
    assertConnectedProjectNamespaces(localControllers);
    writeConnectedProjectContract(localControllers);

    const connectedProjectContracts = await resolveConnectedProjectContracts(app.connectedProjects);
    const manifestControllers: TProteumManifestController[] = [];
    const runtimeTree: Record<string, any> = {};
    const typeTree: Record<string, any> = {};
    const typeImports: string[] = [];

    localControllers.forEach((controller, index) => {
        typeImports.push(`import type Controller${index} from ${JSON.stringify(controller.importPath)};`);

        controller.methods.forEach((method) => {
            const resultType = `TControllerResult<Controller${index}, ${JSON.stringify(method.name)}>`;
            const clientAccessor = method.routePath.split('/').join('.');

            manifestControllers.push({
                className: controller.className,
                importPath: controller.importPath,
                filepath: normalizeAbsolutePath(controller.filepath),
                sourceLocation: method.sourceLocation,
                routeBasePath: controller.routeBasePath,
                methodName: method.name,
                inputCallsCount: method.inputCallsCount,
                hasInput: method.inputCallsCount > 0,
                routePath: method.routePath,
                httpPath: '/api/' + method.routePath,
                clientAccessor,
                scope: getManifestScopeFromImportPath(controller.importPath),
            });

            insertTreeLeaf(
                runtimeTree,
                clientAccessor,
                JSON.stringify({
                    connected: undefined,
                    hasInput: method.inputCallsCount > 0,
                    httpPath: '/api/' + method.routePath,
                    methodName: method.name,
                    resultType,
                    typeName: `Controller${index}`,
                }),
            );

            insertTreeLeaf(
                typeTree,
                clientAccessor,
                JSON.stringify({
                    hasInput: method.inputCallsCount > 0,
                    methodName: method.name,
                    typeName: `Controller${index}`,
                }),
            );
        });
    });

    const connectedControllerTypeImports: string[] = [];
    const connectedManifestControllers: TProteumManifestController[] = [];

    connectedProjectContracts.forEach(({ namespace, cachedContractFilepath, contract, sourceKind, sourceValue, typeImportModuleSpecifier, typingMode }) => {
        let connectedTypeName: string | null = null;

        if (typingMode === 'local-typed' && typeImportModuleSpecifier) {
            connectedTypeName = `ConnectedControllers_${namespace.replace(/[^A-Za-z0-9_$]+/g, '_')}`;
            connectedControllerTypeImports.push(
                `import type { TConnectedControllers as ${connectedTypeName} } from ${JSON.stringify(typeImportModuleSpecifier)};`,
            );
            typeTree[namespace] = JSON.stringify({ rawType: connectedTypeName });
        } else {
            typeTree[namespace] = JSON.stringify({ runtimeOnly: true });
        }

        contract.controllers.forEach((controller) => {
            const clientAccessor = `${namespace}.${controller.clientAccessor}`;
            connectedManifestControllers.push({
                className: controller.className,
                importPath: `connected:${namespace}/${controller.importPath}`,
                filepath:
                    sourceKind === 'file'
                        ? normalizeAbsolutePath(path.join(sourceValue, controller.relativeFilepath))
                        : cachedContractFilepath,
                sourceLocation: controller.sourceLocation,
                routeBasePath: controller.routeBasePath,
                methodName: controller.methodName,
                inputCallsCount: controller.inputCallsCount,
                hasInput: controller.hasInput,
                routePath: controller.routePath,
                httpPath: controller.httpPath,
                clientAccessor,
                scope: 'connected',
                connectedProjectNamespace: namespace,
                connectedProjectIdentifier: contract.identity.identifier,
            });

            insertTreeLeaf(
                runtimeTree,
                clientAccessor,
                JSON.stringify({
                    connected: {
                        controllerAccessor: controller.clientAccessor,
                        httpPath: controller.httpPath,
                        namespace,
                    },
                    hasInput: controller.hasInput,
                    httpPath: controller.httpPath,
                    methodName: controller.methodName,
                    resultType: connectedTypeName
                        ? `TConnectedControllerResult<${connectedTypeName}, ${JSON.stringify(controller.clientAccessor)}>`
                        : 'unknown',
                }),
            );
        });
    });

    const runtimeLeaf = (leaf: string) => {
        const meta = JSON.parse(leaf) as {
            connected?: {
                controllerAccessor: string;
                httpPath: string;
                namespace: string;
            };
            hasInput: boolean;
            httpPath: string;
            resultType: string;
        };

        const connectedOptions = meta.connected
            ? `, { connected: ${JSON.stringify(meta.connected)} }`
            : '';

        return meta.hasInput
            ? `(data) => api.createFetcher<${meta.resultType}>('POST', ${JSON.stringify(meta.httpPath)}, data${connectedOptions})`
            : `() => api.createFetcher<${meta.resultType}>('POST', ${JSON.stringify(meta.httpPath)}, undefined${connectedOptions})`;
    };

    const typeLeaf = (leaf: string) => {
        const meta = JSON.parse(leaf) as
            | {
                  rawType: string;
              }
            | {
                  runtimeOnly: true;
              }
            | {
                  hasInput: boolean;
                  methodName: string;
                  typeName: string;
              };

        if ('rawType' in meta) return meta.rawType;
        if ('runtimeOnly' in meta) return 'any';
        const fetcherType = `TControllerFetcher<${meta.typeName}, ${JSON.stringify(meta.methodName)}>`;

        return meta.hasInput ? `(data: any) => ${fetcherType}` : `() => ${fetcherType}`;
    };

    const createControllersContent = `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from server controller files.
// Do not edit it manually.

import type ApiClient from '@common/router/request/api';
import type { TFetcher } from '@common/router/request/api';
${[...typeImports, ...connectedControllerTypeImports].join('\n') ? '\n' + [...typeImports, ...connectedControllerTypeImports].join('\n') : ''}

type TControllerResult<TController, TMethod extends keyof TController> =
    TController[TMethod] extends (...args: any[]) => infer TResult ? Awaited<TResult> : never;

type TControllerFetcher<TController, TMethod extends keyof TController> = TFetcher<TControllerResult<TController, TMethod>>;

type TConnectedFallbackValue =
    | string
    | number
    | boolean
    | null
    | TConnectedFallbackValue[]
    | { [key: string]: TConnectedFallbackValue | undefined };

type TConnectedControllerLeaf<TControllerTree, TAccessor extends string> =
    TAccessor extends \`${'${infer THead}.${infer TTail}'}\`
        ? THead extends keyof TControllerTree
            ? TConnectedControllerLeaf<TControllerTree[THead], TTail>
            : undefined
        : TAccessor extends keyof TControllerTree
            ? TControllerTree[TAccessor]
            : undefined;

type TConnectedControllerResult<TControllerTree, TAccessor extends string> =
    TConnectedControllerLeaf<TControllerTree, TAccessor> extends (...args: infer TArgs) => TFetcher<infer TResult>
        ? Awaited<TResult>
        : TConnectedFallbackValue;

export type TControllers = ${printControllerTree(typeTree, typeLeaf)};

export const createControllers = (
    api: Pick<ApiClient, 'createFetcher'>
): TControllers => (
${printControllerTree(runtimeTree, runtimeLeaf)}
);

export default createControllers;
`;

    writeIfChanged(path.join(app.paths.common.generated, 'controllers.ts'), createControllersContent);

    writeIfChanged(
        path.join(app.paths.client.generated, 'controllers.ts'),
        `export { createControllers, default } from '@generated/common/controllers';
export type { TControllers } from '@generated/common/controllers';
`,
    );

    const controllerImports = localControllers
        .map((controller, index) => `import Controller${index} from ${JSON.stringify(controller.importPath)};`)
        .join('\n');

    const controllerEntries = localControllers.flatMap((controller, controllerIndex) =>
        controller.methods.map(
            (method) => `    {
        path: ${JSON.stringify('/api/' + method.routePath)},
        filepath: ${JSON.stringify(normalizeAbsolutePath(controller.filepath))},
        sourceLocation: { line: ${method.sourceLocation.line}, column: ${method.sourceLocation.column} },
        Controller: Controller${controllerIndex},
        method: ${JSON.stringify(method.name)},
    },`,
        ),
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'controllers.ts'),
        `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from server controller files.
// Do not edit it manually.

import type Controller from '@server/app/controller';
${controllerImports ? '\n' + controllerImports : ''}

export type TGeneratedControllerDefinition = {
    path: string,
    filepath: string,
    sourceLocation: { line: number, column: number },
    Controller: new (request: any) => Controller,
    method: string,
}

const controllers: TGeneratedControllerDefinition[] = [
${controllerEntries.join('\n')}
];

export default controllers;
`,
    );

    return {
        connectedProjects: connectedProjectContracts,
        controllers: [...manifestControllers, ...connectedManifestControllers],
    };
};
