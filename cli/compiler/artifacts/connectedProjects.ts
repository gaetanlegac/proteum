import childProcess from 'child_process';
import fs from 'fs-extra';
import got from 'got';
import path from 'path';

import app from '../../app';
import cli from '../..';
import {
    connectedProjectContractVersion,
    connectedProjectSourceKinds,
    getConnectedProjectSlug,
    normalizeConnectedProjectsConfig,
    type TConnectedProjectContract,
    type TConnectedProjectContractController,
    type TConnectedProjectConfig,
    type TConnectedProjectSourceKind,
    type TConnectedProjectTypingMode,
    type TConnectedProjectsConfig,
} from '../../../common/connectedProjects';
import { resolveIdentityConfigFilepath, resolveSetupConfigFilepath } from '../../../common/applicationConfigLoader';
import type { TControllerFileMeta } from '../common/controllers';
import { printControllerTree } from '../common/controllers';
import writeIfChanged from '../writeIfChanged';
import { normalizeAbsolutePath, normalizePath } from './shared';

export type TResolvedConnectedProjectContract = {
    namespace: string;
    cachedContractFilepath: string;
    contract: TConnectedProjectContract;
    sourceKind: TConnectedProjectSourceKind;
    sourceValue: string;
    typingMode: TConnectedProjectTypingMode;
    typeImportModuleSpecifier?: string;
};

const connectedContractJsonFilename = 'proteum.connected.json';
const connectedContractDtsFilename = 'proteum.connected.d.ts';
const connectedContractsCacheDir = path.join(app.paths.proteum, 'connected');
const connectedTypesPackageScope = '@proteum-connected';
const connectedRefreshStackEnvKey = 'PROTEUM_CONNECTED_REFRESH_STACK';

type TParsedConnectedProjectSource =
    | {
          kind: 'file';
          producerAppRoot: string;
          sourceValue: string;
        }
    | {
          kind: 'github';
          contractPath: string;
          ref: string;
          repo: string;
          sourceValue: string;
        };

const normalizeImportPath = (filepath: string) =>
    normalizePath(filepath).replace(/\.ts$/, '');

const normalizeImportSpecifier = (filepath: string) => {
    const importPath = normalizeImportPath(filepath);

    return importPath.startsWith('.') ? importPath : `./${importPath.replace(/^\.\//, '')}`;
};

const buildContractControllers = (controllers: TControllerFileMeta[]): TConnectedProjectContractController[] =>
    controllers
        .filter((controller) => controller.importPath.startsWith('@/server/controllers/'))
        .flatMap((controller) =>
            controller.methods.map((method) => ({
                className: controller.className,
                methodName: method.name,
                routeBasePath: controller.routeBasePath,
                routePath: method.routePath,
                httpPath: '/api/' + method.routePath,
                clientAccessor: method.routePath.split('/').join('.'),
                hasInput: method.inputCallsCount > 0,
                inputCallsCount: method.inputCallsCount,
                importPath: normalizeImportPath(path.relative(app.paths.root, controller.filepath)),
                relativeFilepath: normalizePath(path.relative(app.paths.root, controller.filepath)),
                sourceLocation: method.sourceLocation,
            })),
        )
        .sort((left, right) => left.httpPath.localeCompare(right.httpPath));

const createControllerTree = (controllers: TConnectedProjectContractController[]) => {
    const root: Record<string, any> = {};

    for (const controller of controllers) {
        const segments = controller.clientAccessor.split('.');
        let cursor = root;

        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const isLeaf = index === segments.length - 1;

            if (isLeaf) {
                cursor[segment] = JSON.stringify(controller);
                continue;
            }

            cursor[segment] = cursor[segment] || {};
            cursor = cursor[segment];
        }
    }

    return root;
};

const buildConnectedContractDts = (contract: TConnectedProjectContract) => {
    const typeImports = contract.controllers
        .map((controller, index) =>
            `import type Controller${index} from ${JSON.stringify(
                normalizeImportSpecifier(path.relative(app.paths.proteum, path.join(app.paths.root, controller.relativeFilepath))),
            )};`,
        )
        .join('\n');
    const controllerIndexByAccessor = new Map(contract.controllers.map((controller, index) => [controller.clientAccessor, index]));

    const typeLeaf = (leaf: string) => {
        const controller = JSON.parse(leaf) as TConnectedProjectContractController;
        const index = controllerIndexByAccessor.get(controller.clientAccessor);
        if (index === undefined) throw new Error(`Missing connected controller type import for ${controller.clientAccessor}.`);

        const resultType = `TControllerResult<Controller${index}, ${JSON.stringify(controller.methodName)}>`;
        return controller.hasInput
            ? `(data: any) => TFetcher<${resultType}>`
            : `() => TFetcher<${resultType}>`;
    };

    return `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from app controller files.
// Do not edit it manually.

import type { TFetcher } from 'proteum/common/router/request/api';
${typeImports ? '\n' + typeImports : ''}

type TControllerResult<TController, TMethod extends keyof TController> =
    TController[TMethod] extends (...args: any[]) => infer TResult ? Awaited<TResult> : never;

export type TConnectedControllers = ${printControllerTree(createControllerTree(contract.controllers), typeLeaf)};
`;
};

const validateContract = ({
    contract,
    contractFilepath,
}: {
    contract: unknown;
    contractFilepath: string;
}): TConnectedProjectContract => {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        throw new Error(`Connected project contract at ${contractFilepath} is invalid. Expected an object.`);
    }

    const candidate = contract as Partial<TConnectedProjectContract>;
    if (candidate.version !== connectedProjectContractVersion) {
        throw new Error(
            `Connected project contract at ${contractFilepath} uses version ${String(candidate.version)}. Expected ${connectedProjectContractVersion}.`,
        );
    }
    if (candidate.packageName !== undefined && (typeof candidate.packageName !== 'string' || candidate.packageName.trim() === '')) {
        throw new Error(`Connected project contract at ${contractFilepath} has invalid package metadata.`);
    }
    if (!candidate.identity || typeof candidate.identity !== 'object') {
        throw new Error(`Connected project contract at ${contractFilepath} is missing identity metadata.`);
    }
    if (!Array.isArray(candidate.controllers)) {
        throw new Error(`Connected project contract at ${contractFilepath} is missing controllers.`);
    }

    return candidate as TConnectedProjectContract;
};

const getConnectedRefreshStack = () =>
    (process.env[connectedRefreshStackEnvKey] || '')
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => normalizeAbsolutePath(entry));

const requireConnectedSourceValue = (namespace: string, config: TConnectedProjectConfig) => {
    const sourceValue = config.source?.trim();

    if (sourceValue) return sourceValue;

    throw new Error(
        `Connected project "${namespace}" requires connect.${namespace}.source in ${path.join(app.paths.root, 'proteum.config.ts')}. Set it explicitly in Application.setup(...), for example source: process.env.MY_CONNECTED_SOURCE.`,
    );
};

const isAbsoluteOrDrivePath = (value: string) => path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);

const parseConnectedProjectSource = (namespace: string, config: TConnectedProjectConfig): TParsedConnectedProjectSource => {
    const sourceValue = requireConnectedSourceValue(namespace, config);
    const separatorIndex = sourceValue.indexOf(':');

    if (separatorIndex === -1) {
        throw new Error(
            `Invalid connect.${namespace}.source="${sourceValue}". Expected one of ${connectedProjectSourceKinds.join(', ')}: sources.`,
        );
    }

    const kind = sourceValue.substring(0, separatorIndex).trim() as TConnectedProjectSourceKind;
    const rawValue = sourceValue.substring(separatorIndex + 1).trim();

    if (!connectedProjectSourceKinds.includes(kind)) {
        throw new Error(
            `Invalid connect.${namespace}.source="${sourceValue}". Expected one of ${connectedProjectSourceKinds.join(', ')}: sources.`,
        );
    }

    if (kind === 'file') {
        if (!rawValue) {
            throw new Error(`Invalid connect.${namespace}.source="${sourceValue}". Expected a local producer app root after "file:".`);
        }

        const producerAppRoot = normalizeAbsolutePath(
            isAbsoluteOrDrivePath(rawValue) ? rawValue : path.resolve(app.paths.root, rawValue),
        );

        return {
            kind,
            producerAppRoot,
            sourceValue: producerAppRoot,
        };
    }

    const repoAndQueryMatch = rawValue.match(/^([^?]+\/[^?]+)(?:\?(.*))?$/);
    if (!repoAndQueryMatch) {
        throw new Error(
            `Invalid connect.${namespace}.source="${sourceValue}". Expected github:<owner>/<repo>?ref=<ref>&path=proteum.connected.json.`,
        );
    }

    const [, repo, rawQuery = ''] = repoAndQueryMatch;
    const params = new URLSearchParams(rawQuery);
    const ref = params.get('ref')?.trim();
    const contractPath = params.get('path')?.trim();

    if (!ref || !contractPath) {
        throw new Error(
            `Invalid connect.${namespace}.source="${sourceValue}". Expected github:<owner>/<repo>?ref=<ref>&path=proteum.connected.json.`,
        );
    }

    return {
        kind,
        contractPath,
        ref,
        repo,
        sourceValue: `github:${repo}?ref=${ref}&path=${contractPath}`,
    };
};

const assertProducerAppRoot = (namespace: string, producerAppRoot: string) => {
    const missingEntries = [
        'package.json',
        resolveIdentityConfigFilepath(producerAppRoot),
        resolveSetupConfigFilepath(producerAppRoot),
        path.join(producerAppRoot, 'server', 'index.ts'),
    ].filter((filepath) => !fs.existsSync(filepath));

    if (missingEntries.length === 0) return;

    throw new Error(
        `Connected project "${namespace}" source ${producerAppRoot} is not a Proteum app root. Missing: ${missingEntries.join(', ')}.`,
    );
};

const refreshProducerApp = (namespace: string, producerAppRoot: string) => {
    const connectedRefreshStack = getConnectedRefreshStack();
    if (connectedRefreshStack.includes(producerAppRoot)) {
        throw new Error(
            `Connected project "${namespace}" creates a refresh cycle through ${producerAppRoot}. Break the circular connected-project dependency first.`,
        );
    }

    const cliBin = path.join(cli.paths.core.root, 'cli', 'bin.js');
    const currentAppRoot = normalizeAbsolutePath(app.paths.root);
    const nextRefreshStack = [...connectedRefreshStack, currentAppRoot].join(path.delimiter);
    const result = childProcess.spawnSync(process.execPath, [cliBin, 'refresh'], {
        cwd: producerAppRoot,
        env: {
            ...process.env,
            [connectedRefreshStackEnvKey]: nextRefreshStack,
        },
        encoding: 'utf8',
        stdio: 'pipe',
    });

    if (result.status === 0) return;

    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    const details = [stdout, stderr].filter(Boolean).join('\n').trim();

    throw new Error(
        `Connected project "${namespace}" failed to refresh producer ${producerAppRoot}.${details ? `\n${details}` : ''}`,
    );
};

const ensureSymlink = (linkPath: string, targetPath: string) => {
    fs.ensureDirSync(path.dirname(linkPath));

    try {
        const linkStats = fs.lstatSync(linkPath);

        if (linkStats.isSymbolicLink()) {
            const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
            if (currentTarget === path.resolve(targetPath)) return;
        }

        fs.removeSync(linkPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
};

const getConnectedTypesPackageName = (namespace: string) =>
    `${connectedTypesPackageScope}/${getConnectedProjectSlug(namespace).toLowerCase().replace(/_/g, '-')}`;

const ensureConnectedTypesPackage = (namespace: string, producerAppRoot: string) => {
    const packageName = getConnectedTypesPackageName(namespace);
    const packageRoot = path.join(app.paths.root, 'node_modules', connectedTypesPackageScope, packageName.split('/')[1]);

    ensureSymlink(packageRoot, producerAppRoot);
    return packageName;
};

const writeCachedConnectedContract = (namespace: string, contract: TConnectedProjectContract) => {
    fs.ensureDirSync(connectedContractsCacheDir);
    const cachedContractFilepath = path.join(connectedContractsCacheDir, `${namespace}.json`);
    writeIfChanged(cachedContractFilepath, JSON.stringify(contract, null, 2) + '\n');
    return normalizeAbsolutePath(cachedContractFilepath);
};

const fetchGithubConnectedContract = async (namespace: string, source: Extract<TParsedConnectedProjectSource, { kind: 'github' }>) => {
    const encodedPath = source.contractPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    const apiUrl = `https://api.github.com/repos/${source.repo}/contents/${encodedPath}`;
    const githubToken = process.env.GITHUB_TOKEN?.trim();

    if (!githubToken) {
        throw new Error(
            `Connected project "${namespace}" uses a github: source but GITHUB_TOKEN is not set. Private GitHub contract fetches require GITHUB_TOKEN.`,
        );
    }

    const rawContract = await got(apiUrl, {
        headers: {
            Accept: 'application/vnd.github.raw',
            Authorization: `Bearer ${githubToken}`,
            'User-Agent': 'proteum-connected-contract-fetch',
        },
        responseType: 'text',
        retry: { limit: 0 },
        searchParams: {
            ref: source.ref,
        },
    }).text();

    return JSON.parse(rawContract);
};

export const writeConnectedProjectContract = (controllers: TControllerFileMeta[]) => {
    const contract = {
        version: connectedProjectContractVersion,
        packageName: String(app.packageJson.name || '').trim() || undefined,
        identity: {
            name: app.identity.name,
            identifier: app.identity.identifier,
        },
        controllers: buildContractControllers(controllers),
    } satisfies TConnectedProjectContract;

    writeIfChanged(path.join(app.paths.root, connectedContractJsonFilename), JSON.stringify(contract, null, 2) + '\n');
    writeIfChanged(path.join(app.paths.proteum, connectedContractDtsFilename), buildConnectedContractDts(contract));
    fs.removeSync(path.join(app.paths.root, connectedContractDtsFilename));
};

export const resolveConnectedProjectContracts = async (
    rawConnectedProjects: TConnectedProjectsConfig,
): Promise<TResolvedConnectedProjectContract[]> => {
    const connectedProjects = Object.entries(normalizeConnectedProjectsConfig(rawConnectedProjects)).sort(([left], [right]) =>
        left.localeCompare(right),
    );

    const contracts: TResolvedConnectedProjectContract[] = [];

    for (const [namespace, config] of connectedProjects) {
        const source = parseConnectedProjectSource(namespace, config);

        if (source.kind === 'file') {
            assertProducerAppRoot(namespace, source.producerAppRoot);
            refreshProducerApp(namespace, source.producerAppRoot);

            const producerContractFilepath = path.join(source.producerAppRoot, connectedContractJsonFilename);
            const producerTypesFilepath = path.join(source.producerAppRoot, '.proteum', connectedContractDtsFilename);

            if (!fs.existsSync(producerContractFilepath)) {
                throw new Error(
                    `Connected project "${namespace}" expected ${producerContractFilepath}, but it is missing after producer refresh.`,
                );
            }

            if (!fs.existsSync(producerTypesFilepath)) {
                throw new Error(
                    `Connected project "${namespace}" expected ${producerTypesFilepath}, but it is missing after producer refresh.`,
                );
            }

            const contract = validateContract({
                contract: fs.readJsonSync(producerContractFilepath),
                contractFilepath: normalizeAbsolutePath(producerContractFilepath),
            });

            contracts.push({
                namespace,
                cachedContractFilepath: writeCachedConnectedContract(namespace, contract),
                contract,
                sourceKind: source.kind,
                sourceValue: source.sourceValue,
                typingMode: 'local-typed',
                typeImportModuleSpecifier: `${ensureConnectedTypesPackage(namespace, source.producerAppRoot)}/.proteum/proteum.connected`,
            });

            continue;
        }

        const contract = validateContract({
            contract: await fetchGithubConnectedContract(namespace, source),
            contractFilepath: source.sourceValue,
        });

        contracts.push({
            namespace,
            cachedContractFilepath: writeCachedConnectedContract(namespace, contract),
            contract,
            sourceKind: source.kind,
            sourceValue: source.sourceValue,
            typingMode: 'runtime-only',
        });
    }

    return contracts;
};
