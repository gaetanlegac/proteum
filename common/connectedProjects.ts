export const connectedProjectContractVersion = 1 as const;
export const connectedProjectHealthPath = '/api/__proteum/connected/ping';
export const connectedProjectProxyPathPrefix = '/api/__proteum/connected';

export const connectedProjectSourceKinds = ['file', 'github'] as const;

export type TConnectedProjectSourceKind = (typeof connectedProjectSourceKinds)[number];

export type TConnectedProjectTypingMode = 'local-typed' | 'runtime-only';

export type TConnectedProjectConfig = {
    source?: string;
    urlInternal?: string;
};

export type TConnectedProjectsConfig = Record<string, TConnectedProjectConfig>;

export type TConnectedProjectContractController = {
    className: string;
    methodName: string;
    routeBasePath: string;
    routePath: string;
    httpPath: string;
    clientAccessor: string;
    hasInput: boolean;
    inputCallsCount: number;
    importPath: string;
    relativeFilepath: string;
    sourceLocation: { line: number; column: number };
};

export type TConnectedProjectContract = {
    version: typeof connectedProjectContractVersion;
    packageName?: string;
    identity: {
        name: string;
        identifier: string;
    };
    controllers: TConnectedProjectContractController[];
};

export type TConnectedProjectEnvConfig = {
    namespace: string;
    urlInternal: string;
};

export type TConnectedProjectHealthResponse = {
    connectedProjects: string[];
    identifier: string;
    name: string;
    ok: true;
};

export type TConnectedFetcherTarget = {
    namespace: string;
    controllerAccessor: string;
    httpPath: string;
};

const normalizeNamespace = (value: string) => value.trim();

export const normalizeConnectedProjectsConfig = (value: unknown): TConnectedProjectsConfig => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const output: TConnectedProjectsConfig = {};

    for (const [rawNamespace, rawConfig] of Object.entries(value)) {
        const namespace = normalizeNamespace(rawNamespace);
        if (!namespace) continue;
        if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;

        if ('source' in rawConfig && rawConfig.source !== undefined && rawConfig.source !== null && typeof rawConfig.source !== 'string') {
            throw new Error(`Invalid connect.${namespace}.source. Expected a string.`);
        }
        if ('urlInternal' in rawConfig && rawConfig.urlInternal !== undefined && rawConfig.urlInternal !== null && typeof rawConfig.urlInternal !== 'string') {
            throw new Error(`Invalid connect.${namespace}.urlInternal. Expected a string.`);
        }
        const source =
            'source' in rawConfig && rawConfig.source !== undefined && rawConfig.source !== null
                ? String(rawConfig.source).trim() || undefined
                : undefined;
        const urlInternal =
            'urlInternal' in rawConfig && rawConfig.urlInternal !== undefined && rawConfig.urlInternal !== null
                ? String(rawConfig.urlInternal).trim() || undefined
                : undefined;

        output[namespace] = {
            ...(source ? { source } : {}),
            ...(urlInternal ? { urlInternal } : {}),
        };
    }

    return output;
};

export const getConnectedProjectSlug = (namespace: string) =>
    normalizeNamespace(namespace)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();

export const buildConnectedProjectProxyPath = (namespace: string, httpPath: string) => {
    const normalizedHttpPath = httpPath.startsWith('/') ? httpPath : `/${httpPath}`;
    return `${connectedProjectProxyPathPrefix}/${encodeURIComponent(normalizeNamespace(namespace))}${normalizedHttpPath}`;
};

export const parseConnectedProjectProxyPath = (pathname: string) => {
    if (!pathname.startsWith(`${connectedProjectProxyPathPrefix}/`)) return undefined;

    const remainder = pathname.slice(connectedProjectProxyPathPrefix.length + 1);
    const separatorIndex = remainder.indexOf('/');
    if (separatorIndex === -1) return undefined;

    const namespace = decodeURIComponent(remainder.slice(0, separatorIndex)).trim();
    const httpPath = `/${remainder.slice(separatorIndex + 1)}`;
    if (!namespace || httpPath === '/') return undefined;

    return { namespace, httpPath };
};
