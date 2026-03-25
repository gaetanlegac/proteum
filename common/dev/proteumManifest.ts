export type TProteumManifestScope = 'app' | 'framework';
export type TProteumManifestSourceLocation = { line: number; column: number };
export type TProteumManifestRouteTargetResolution = 'literal' | 'static-expression' | 'dynamic-expression';
export type TProteumManifestDiagnosticLevel = 'warning' | 'error';

export type TProteumManifestDiagnostic = {
    level: TProteumManifestDiagnosticLevel;
    code: string;
    message: string;
    filepath: string;
    sourceLocation?: TProteumManifestSourceLocation;
    relatedFilepaths?: string[];
};

export type TProteumManifestService = {
    kind: 'service' | 'ref';
    id?: string;
    registeredName: string;
    metaName?: string;
    parent: string;
    priority: number;
    importPath?: string;
    sourceDir?: string;
    metasFilepath?: string;
    refTo?: string;
    scope: TProteumManifestScope;
};

export type TProteumManifestController = {
    className: string;
    importPath: string;
    filepath: string;
    sourceLocation: TProteumManifestSourceLocation;
    routeBasePath: string;
    methodName: string;
    inputCallsCount: number;
    hasInput: boolean;
    routePath: string;
    httpPath: string;
    clientAccessor: string;
    scope: TProteumManifestScope;
};

export type TProteumManifestCommand = {
    className: string;
    importPath: string;
    filepath: string;
    sourceLocation: TProteumManifestSourceLocation;
    commandBasePath: string;
    methodName: string;
    path: string;
    scope: TProteumManifestScope;
};

export type TProteumManifestRoute = {
    kind: 'client-page' | 'client-error' | 'server-route';
    methodName: string;
    serviceLocalName: string;
    filepath: string;
    sourceLocation: TProteumManifestSourceLocation;
    targetResolution: TProteumManifestRouteTargetResolution;
    path?: string;
    pathRaw?: string;
    code?: number;
    codeRaw?: string;
    optionKeys: string[];
    normalizedOptionKeys: string[];
    invalidOptionKeys: string[];
    reservedOptionKeys: string[];
    optionsRaw?: string;
    hasSetup: boolean;
    chunkId?: string;
    chunkFilepath?: string;
    scope: TProteumManifestScope;
};

export type TProteumManifestLayout = {
    chunkId: string;
    filepath: string;
    importPath: string;
    depth: number;
    scope: TProteumManifestScope;
};

export type TProteumManifest = {
    version: 2;
    app: {
        root: string;
        coreRoot: string;
        identityFilepath: string;
        identity: {
            name: string;
            identifier: string;
            description: string;
            language?: string;
            locale?: string;
            title?: string;
            titleSuffix?: string;
            fullTitle?: string;
            webDescription?: string;
            version?: string;
        };
    };
    conventions: {
        routeSetupOptionKeys: string[];
        reservedRouteSetupKeys: string[];
    };
    env: {
        source: string;
        loadedVariableKeys: string[];
        requiredVariables: {
            key: string;
            possibleValues: string[];
            provided: boolean;
        }[];
        resolved: {
            name: string;
            profile: string;
            routerPort: number;
            routerCurrentDomain: string;
        };
    };
    services: {
        app: TProteumManifestService[];
        routerPlugins: TProteumManifestService[];
    };
    controllers: TProteumManifestController[];
    commands: TProteumManifestCommand[];
    routes: {
        client: TProteumManifestRoute[];
        server: TProteumManifestRoute[];
    };
    layouts: TProteumManifestLayout[];
    diagnostics: TProteumManifestDiagnostic[];
};
