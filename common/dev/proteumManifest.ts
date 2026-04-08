import type {
    TConnectedProjectSourceKind,
    TConnectedProjectTypingMode,
} from '../connectedProjects';

export type TProteumManifestScope = 'app' | 'framework' | 'connected';
export type TProteumManifestSourceLocation = { line: number; column: number };
export type TProteumManifestRouteTargetResolution = 'literal' | 'static-expression' | 'dynamic-expression';
export type TProteumManifestDiagnosticLevel = 'warning' | 'error';

export type TProteumManifestDiagnostic = {
    level: TProteumManifestDiagnosticLevel;
    code: string;
    message: string;
    filepath: string;
    sourceLocation?: TProteumManifestSourceLocation;
    fixHint?: string;
    relatedFilepaths?: string[];
};

export type TProteumManifestService = {
    kind: 'service' | 'ref';
    registeredName: string;
    className?: string;
    parent: string;
    priority: number;
    importPath?: string;
    sourceFilepath?: string;
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
    connectedProjectNamespace?: string;
    connectedProjectIdentifier?: string;
};

export type TProteumManifestConnectedProject = {
    namespace: string;
    packageName?: string;
    identityIdentifier?: string;
    identityName?: string;
    sourceKind?: TConnectedProjectSourceKind;
    sourceValue?: string;
    cachedContractFilepath?: string;
    typingMode?: TConnectedProjectTypingMode;
    urlInternal?: string;
    controllerCount: number;
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
    hasData: boolean;
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
    version: 10;
    app: {
        root: string;
        coreRoot: string;
        identityFilepath: string;
        setupFilepath: string;
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
        setup: {
            transpile?: string[];
            connect?: Record<string, { source?: string; urlInternal?: string }>;
        };
    };
    conventions: {
        routeOptionKeys: string[];
        reservedRouteOptionKeys: string[];
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
            routerInternalUrl: string;
        };
    };
    connectedProjects: TProteumManifestConnectedProject[];
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
