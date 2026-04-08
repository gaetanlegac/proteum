import { buildExplainSummaryItems, type TDoctorResponse } from './diagnostics';
import type { TDevConsoleLogsResponse } from './console';
import type {
    TProteumManifest,
    TProteumManifestCommand,
    TProteumManifestController,
    TProteumManifestDiagnostic,
    TProteumManifestLayout,
    TProteumManifestRoute,
    TProteumManifestScope,
    TProteumManifestService,
    TProteumManifestSourceLocation,
} from './proteumManifest';
import type { TRequestTrace, TTraceEvent } from './requestTrace';

/*----------------------------------
- TYPES
----------------------------------*/

export type TOwnerKind = 'route' | 'controller' | 'command' | 'service' | 'layout' | 'diagnostic';
export type TOwnerScopeLabel = 'local' | 'generated' | 'connected' | 'framework';
export type TChainKind = 'route' | 'controller' | 'service' | 'cache' | 'connected' | 'sql';

export type TOwnerSource = {
    filepath: string;
    line?: number;
    column?: number;
    scope?: TProteumManifestScope;
};

export type TExplainOwnerMatch = {
    details: string[];
    kind: TOwnerKind;
    label: string;
    matchedOn: string[];
    originHint: string;
    scopeLabel: TOwnerScopeLabel;
    score: number;
    source: TOwnerSource;
};

export type TExplainOwnerResponse = {
    matches: TExplainOwnerMatch[];
    normalizedQuery: string;
    query: string;
};

export type TTraceAttributionItem = {
    kind: 'request' | 'event' | 'call' | 'sql';
    label: string;
    owner?: TExplainOwnerMatch;
    reference: string;
};

export type TTraceAttributionResponse = {
    calls: TTraceAttributionItem[];
    events: TTraceAttributionItem[];
    primary?: TTraceAttributionItem;
    sqlQueries: TTraceAttributionItem[];
};

export type TOrientGuidance = {
    agents: string;
    diagnostics: string;
    optimizations: string;
    codingStyle: string;
    areaAgents: string[];
};

export type TOrientConnected = {
    imports: Array<{
        namespace: string;
        clientAccessor: string;
        httpPath: string;
        filepath: string;
        scopeLabel: TOwnerScopeLabel;
        originHint: string;
    }>;
    producers: Array<{
        namespace: string;
        identityIdentifier?: string;
        identityName?: string;
        sourceKind?: string;
        sourceValue?: string;
        urlInternal?: string;
        controllerCount: number;
        cachedContractFilepath?: string;
        typingMode?: string;
    }>;
};

export type TOrientationNextStep = {
    label: string;
    command: string;
    reason: string;
};

export type TOrientResponse = {
    query: string;
    normalizedQuery: string;
    app: {
        appRoot: string;
        repoRoot: string;
        identifier: string;
        routerPort?: number;
    };
    guidance: TOrientGuidance;
    owner: TExplainOwnerResponse;
    connected: TOrientConnected;
    nextSteps: TOrientationNextStep[];
    warnings: string[];
};

export type TDiagnoseChainItem = {
    kind: TChainKind;
    label: string;
    source?: TOwnerSource;
    details: string[];
};

export type TDiagnoseSuspect = {
    filepath: string;
    label: string;
    line?: number;
    column?: number;
    reasons: string[];
    score: number;
};

export type TDiagnoseResponse = {
    attribution?: TTraceAttributionResponse;
    contracts: TDoctorResponse;
    doctor: TDoctorResponse;
    explainSummary: string[];
    owner: TExplainOwnerResponse;
    orientation?: Pick<TOrientResponse, 'guidance' | 'connected' | 'nextSteps'>;
    chain?: TDiagnoseChainItem[];
    query: string;
    request?: TRequestTrace;
    serverLogs: TDevConsoleLogsResponse;
    suspects: TDiagnoseSuspect[];
};

type TManifestEntry = {
    details: string[];
    kind: TOwnerKind;
    label: string;
    searchTerms: string[];
    source: TOwnerSource;
    originHint: string;
    scopeLabel: TOwnerScopeLabel;
};

type TSuspectAccumulator = {
    column?: number;
    filepath: string;
    label: string;
    line?: number;
    reasons: Set<string>;
    score: number;
};

/*----------------------------------
- CONSTANTS
----------------------------------*/

const normalizeText = (value: string) => value.trim().replace(/\\/g, '/').toLowerCase();
const normalizeFilepath = (value: string) => value.replace(/\\/g, '/');
const tokenize = (value: string) =>
    normalizeText(value)
        .split(/[^a-z0-9/_.-]+/i)
        .map((token) => token.trim())
        .filter(Boolean);

type TNodeFs = {
    existsSync: (filepath: string) => boolean;
};

type TNodePath = {
    dirname: (filepath: string) => string;
    join: (...segments: string[]) => string;
    relative: (from: string, to: string) => string;
    resolve: (...segments: string[]) => string;
};

type TConnectModule = {
    buildConnectResponse: (typeof import('./connect'))['buildConnectResponse'];
};

let cachedNodeFs: TNodeFs | null | undefined;
let cachedNodePath: TNodePath | null | undefined;
let cachedConnectModule: TConnectModule | null | undefined;

const getNodeFs = () => {
    if (cachedNodeFs !== undefined) return cachedNodeFs || undefined;

    try {
        cachedNodeFs = (eval('require')('fs') as TNodeFs) || null;
    } catch (_error) {
        cachedNodeFs = null;
    }

    return cachedNodeFs || undefined;
};

const getNodePath = () => {
    if (cachedNodePath !== undefined) return cachedNodePath || undefined;

    try {
        cachedNodePath = (eval('require')('path') as TNodePath) || null;
    } catch (_error) {
        cachedNodePath = null;
    }

    return cachedNodePath || undefined;
};

const getConnectModule = () => {
    if (cachedConnectModule !== undefined) return cachedConnectModule || undefined;

    try {
        cachedConnectModule = (eval('require')('./connect') as TConnectModule) || null;
    } catch (_error) {
        cachedConnectModule = null;
    }

    return cachedConnectModule || undefined;
};

const joinPath = (...segments: string[]) => {
    const nodePath = getNodePath();
    if (nodePath) return nodePath.join(...segments);
    return normalizeFilepath(segments.filter(Boolean).join('/')).replace(/\/{2,}/g, '/');
};

const resolvePath = (...segments: string[]) => {
    const nodePath = getNodePath();
    if (nodePath) return nodePath.resolve(...segments);
    return normalizeFilepath(segments.filter(Boolean).join('/')).replace(/\/{2,}/g, '/');
};

const dirnamePath = (filepath: string) => {
    const nodePath = getNodePath();
    if (nodePath) return nodePath.dirname(filepath);

    const normalized = normalizeFilepath(filepath).replace(/\/+$/, '');
    const slashIndex = normalized.lastIndexOf('/');
    if (slashIndex <= 0) return slashIndex === 0 ? '/' : '.';
    return normalized.slice(0, slashIndex);
};

const relativePath = (from: string, to: string) => {
    const nodePath = getNodePath();
    if (nodePath) return nodePath.relative(from, to);

    const normalizedFrom = normalizeFilepath(from).replace(/\/+$/, '');
    const normalizedTo = normalizeFilepath(to);
    if (normalizedTo.startsWith(`${normalizedFrom}/`)) return normalizedTo.slice(normalizedFrom.length + 1);
    return normalizedTo;
};

const fileExists = (filepath: string) => getNodeFs()?.existsSync(filepath) === true;

/*----------------------------------
- HELPERS
----------------------------------*/

const toSource = (filepath: string, sourceLocation?: TProteumManifestSourceLocation, scope?: TProteumManifestScope): TOwnerSource => ({
    filepath,
    line: sourceLocation?.line,
    column: sourceLocation?.column,
    ...(scope ? { scope } : {}),
});

const isGeneratedFilepath = (manifest: TProteumManifest, filepath: string) => {
    const normalizedFilepath = normalizeFilepath(filepath);
    const normalizedAppRoot = normalizeFilepath(manifest.app.root);

    return (
        normalizedFilepath.includes('/.proteum/') ||
        normalizedFilepath === `${normalizedAppRoot}/proteum.connected.json` ||
        normalizedFilepath.endsWith('/proteum.connected.json')
    );
};

const resolveScopeLabel = ({
    filepath,
    manifest,
    scope,
}: {
    filepath: string;
    manifest: TProteumManifest;
    scope?: TProteumManifestScope;
}): TOwnerScopeLabel => {
    if (scope === 'connected') return 'connected';
    if (scope === 'framework') return 'framework';
    if (isGeneratedFilepath(manifest, filepath)) return 'generated';
    return 'local';
};

const resolveOriginHint = ({
    manifest,
    filepath,
    scopeLabel,
    fallback,
    connectedNamespace,
}: {
    manifest: TProteumManifest;
    filepath: string;
    scopeLabel: TOwnerScopeLabel;
    fallback: string;
    connectedNamespace?: string;
}) => {
    if (scopeLabel === 'connected') {
        return connectedNamespace ? `connected boundary import from ${connectedNamespace}` : 'connected boundary import';
    }

    if (scopeLabel === 'framework') {
        const relativeFrameworkPath = normalizeFilepath(relativePath(manifest.app.coreRoot, filepath));
        return relativeFrameworkPath && relativeFrameworkPath !== '..'
            ? `framework-owned source ${relativeFrameworkPath}`
            : 'framework-owned source';
    }

    if (scopeLabel === 'generated') return 'generated Proteum artifact';
    return fallback;
};

const pushTerm = (terms: Set<string>, value?: string) => {
    if (!value) return;

    const normalized = normalizeText(value);
    if (!normalized) return;
    terms.add(normalized);

    const basename = normalized.split('/').pop();
    if (basename) terms.add(basename);

    for (const token of tokenize(value)) terms.add(token);
};

const createRouteEntry = (manifest: TProteumManifest, route: TProteumManifestRoute): TManifestEntry => {
    const terms = new Set<string>();
    const filepath = route.filepath;
    const scopeLabel = resolveScopeLabel({ filepath, manifest, scope: route.scope });

    pushTerm(terms, route.filepath);
    pushTerm(terms, route.path);
    pushTerm(terms, route.pathRaw);
    pushTerm(terms, route.codeRaw);
    pushTerm(terms, route.chunkId);
    pushTerm(terms, route.chunkFilepath);
    pushTerm(terms, route.kind);
    pushTerm(terms, route.methodName);

    return {
        details: [
            `${route.kind} ${route.methodName}`,
            ...(route.path ? [`path=${route.path}`] : []),
            ...(route.chunkId ? [`chunk=${route.chunkId}`] : []),
            `data=${route.hasData ? 'yes' : 'no'}`,
        ],
        kind: 'route',
        label: route.path || route.pathRaw || route.chunkId || route.filepath,
        searchTerms: [...terms],
        source: toSource(route.filepath, route.sourceLocation, route.scope),
        originHint: resolveOriginHint({
            manifest,
            filepath,
            scopeLabel,
            fallback: route.chunkId ? `local route chunk ${route.chunkId}` : 'local route source',
        }),
        scopeLabel,
    };
};

const createControllerEntry = (manifest: TProteumManifest, controller: TProteumManifestController): TManifestEntry => {
    const terms = new Set<string>();
    const filepath = controller.filepath;
    const scopeLabel = controller.connectedProjectNamespace
        ? 'connected'
        : resolveScopeLabel({ filepath, manifest, scope: controller.scope });

    pushTerm(terms, controller.filepath);
    pushTerm(terms, controller.className);
    pushTerm(terms, controller.methodName);
    pushTerm(terms, controller.routePath);
    pushTerm(terms, controller.httpPath);
    pushTerm(terms, controller.clientAccessor);
    pushTerm(terms, controller.connectedProjectNamespace);

    return {
        details: [
            controller.className,
            `method=${controller.methodName}`,
            `http=${controller.httpPath}`,
            `client=${controller.clientAccessor}`,
            ...(controller.connectedProjectNamespace ? [`connected=${controller.connectedProjectNamespace}`] : []),
        ],
        kind: 'controller',
        label: controller.httpPath,
        searchTerms: [...terms],
        source: toSource(controller.filepath, controller.sourceLocation, controller.scope),
        originHint: resolveOriginHint({
            manifest,
            filepath,
            scopeLabel,
            fallback: `local controller ${controller.className}`,
            connectedNamespace: controller.connectedProjectNamespace,
        }),
        scopeLabel,
    };
};

const createCommandEntry = (manifest: TProteumManifest, command: TProteumManifestCommand): TManifestEntry => {
    const terms = new Set<string>();
    const filepath = command.filepath;
    const scopeLabel = resolveScopeLabel({ filepath, manifest, scope: command.scope });

    pushTerm(terms, command.filepath);
    pushTerm(terms, command.className);
    pushTerm(terms, command.methodName);
    pushTerm(terms, command.path);

    return {
        details: [command.className, `method=${command.methodName}`, `path=${command.path}`],
        kind: 'command',
        label: command.path,
        searchTerms: [...terms],
        source: toSource(command.filepath, command.sourceLocation, command.scope),
        originHint: resolveOriginHint({
            manifest,
            filepath,
            scopeLabel,
            fallback: `local command ${command.className}`,
        }),
        scopeLabel,
    };
};

const createServiceEntry = (manifest: TProteumManifest, service: TProteumManifestService): TManifestEntry => {
    const terms = new Set<string>();
    const sourceFilepath = service.sourceFilepath || service.importPath || service.registeredName;
    const scopeLabel = resolveScopeLabel({ filepath: sourceFilepath, manifest, scope: service.scope });

    pushTerm(terms, service.registeredName);
    pushTerm(terms, service.className);
    pushTerm(terms, service.parent);
    pushTerm(terms, service.refTo);
    pushTerm(terms, service.importPath);
    pushTerm(terms, sourceFilepath);

    return {
        details: [
            service.kind,
            `registered=${service.registeredName}`,
            ...(service.className ? [`class=${service.className}`] : []),
            ...(service.importPath ? [`import=${service.importPath}`] : []),
            ...(service.refTo ? [`ref=${service.refTo}`] : []),
        ],
        kind: 'service',
        label: service.registeredName,
        searchTerms: [...terms],
        source: toSource(sourceFilepath, undefined, service.scope),
        originHint: resolveOriginHint({
            manifest,
            filepath: sourceFilepath,
            scopeLabel,
            fallback: `service registration ${service.registeredName}`,
        }),
        scopeLabel,
    };
};

const createLayoutEntry = (manifest: TProteumManifest, layout: TProteumManifestLayout): TManifestEntry => {
    const terms = new Set<string>();
    const filepath = layout.filepath;
    const scopeLabel = resolveScopeLabel({ filepath, manifest, scope: layout.scope });

    pushTerm(terms, layout.filepath);
    pushTerm(terms, layout.chunkId);
    pushTerm(terms, layout.importPath);

    return {
        details: [`chunk=${layout.chunkId}`, `depth=${layout.depth}`],
        kind: 'layout',
        label: layout.chunkId || layout.filepath,
        searchTerms: [...terms],
        source: toSource(layout.filepath, undefined, layout.scope),
        originHint: resolveOriginHint({
            manifest,
            filepath,
            scopeLabel,
            fallback: layout.chunkId ? `layout chunk ${layout.chunkId}` : 'layout source',
        }),
        scopeLabel,
    };
};

const createDiagnosticEntry = (manifest: TProteumManifest, diagnostic: TProteumManifestDiagnostic): TManifestEntry => {
    const terms = new Set<string>();
    const filepath = diagnostic.filepath;
    const scopeLabel = resolveScopeLabel({ filepath, manifest });

    pushTerm(terms, diagnostic.code);
    pushTerm(terms, diagnostic.message);
    pushTerm(terms, diagnostic.filepath);
    pushTerm(terms, diagnostic.fixHint);
    for (const related of diagnostic.relatedFilepaths || []) pushTerm(terms, related);

    return {
        details: [
            `[${diagnostic.level}]`,
            diagnostic.message,
            ...(diagnostic.fixHint ? [`fix=${diagnostic.fixHint}`] : []),
            ...(diagnostic.relatedFilepaths || []).map((relatedFilepath) => `related=${relatedFilepath}`),
        ],
        kind: 'diagnostic',
        label: diagnostic.code,
        searchTerms: [...terms],
        source: toSource(diagnostic.filepath, diagnostic.sourceLocation),
        originHint: resolveOriginHint({
            manifest,
            filepath,
            scopeLabel,
            fallback: 'local diagnostic source',
        }),
        scopeLabel,
    };
};

const buildManifestEntries = (manifest: TProteumManifest) => [
    ...manifest.routes.client.map((route) => createRouteEntry(manifest, route)),
    ...manifest.routes.server.map((route) => createRouteEntry(manifest, route)),
    ...manifest.controllers.map((controller) => createControllerEntry(manifest, controller)),
    ...manifest.commands.map((command) => createCommandEntry(manifest, command)),
    ...manifest.services.app.map((service) => createServiceEntry(manifest, service)),
    ...manifest.services.routerPlugins.map((service) => createServiceEntry(manifest, service)),
    ...manifest.layouts.map((layout) => createLayoutEntry(manifest, layout)),
    ...manifest.diagnostics.map((diagnostic) => createDiagnosticEntry(manifest, diagnostic)),
];

const scoreOwnerMatch = (query: string, entry: TManifestEntry) => {
    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenize(query);
    let score = 0;
    const matchedOn: string[] = [];

    for (const term of entry.searchTerms) {
        if (term === normalizedQuery) {
            score += 120;
            matchedOn.push(term);
            continue;
        }

        if (normalizedQuery.length >= 3 && term.includes(normalizedQuery)) {
            score += 40;
            matchedOn.push(term);
        }
    }

    for (const token of queryTokens) {
        if (entry.searchTerms.some((term) => term === token)) {
            score += 18;
            matchedOn.push(token);
            continue;
        }

        if (token.length >= 3 && entry.searchTerms.some((term) => term.includes(token))) {
            score += 8;
            matchedOn.push(token);
        }
    }

    if ((entry.kind === 'controller' && entry.label === query) || (entry.kind === 'route' && entry.label === query)) score += 30;

    if (entry.scopeLabel === 'connected' && tokenize(query).some((token) => token === 'connected')) score += 6;
    if (entry.scopeLabel === 'generated' && normalizeText(query).includes('.proteum')) score += 8;

    return {
        matchedOn: [...new Set(matchedOn)],
        score,
    };
};

const toOwnerMatch = (entry: TManifestEntry, score: number, matchedOn: string[]): TExplainOwnerMatch => ({
    details: entry.details,
    kind: entry.kind,
    label: entry.label,
    matchedOn,
    originHint: entry.originHint,
    scopeLabel: entry.scopeLabel,
    score,
    source: entry.source,
});

const summarizeTraceStatus = (statusCode?: number, errorMessage?: string) => {
    if (errorMessage) return errorMessage;
    if (statusCode === undefined) return 'pending';
    return String(statusCode);
};

const buildTraceItemOwner = (
    manifest: TProteumManifest,
    query: string,
    kind: TTraceAttributionItem['kind'],
    reference: string,
    label: string,
) => {
    const owner = explainOwner(manifest, query).matches[0];
    return {
        kind,
        label,
        owner,
        reference,
    } satisfies TTraceAttributionItem;
};

const getEventQuery = (event: TTraceEvent) => {
    const source = event.details.source;
    if (typeof source === 'object' && source && 'entries' in source) {
        const filepath = source.entries.filepath;
        if (typeof filepath === 'string') return filepath;
    }

    const routePath = event.details.routePath;
    if (typeof routePath === 'string' && routePath) return routePath;

    const target = event.details.target;
    if (typeof target === 'string' && target) return target;

    const filepath = event.details.filepath;
    if (typeof filepath === 'string' && filepath) return filepath;

    return '';
};

const readEventString = (event: TTraceEvent | undefined, key: string) => {
    if (!event) return undefined;
    const value = event.details[key];
    return typeof value === 'string' ? value : undefined;
};

const readEventNumber = (event: TTraceEvent | undefined, key: string) => {
    if (!event) return undefined;
    const value = event.details[key];
    return typeof value === 'number' ? value : undefined;
};

const readEventSource = (event: TTraceEvent): TOwnerSource | undefined => {
    const source = event.details.source;
    if (typeof source !== 'object' || !source || !('entries' in source)) return undefined;

    const filepath = source.entries.filepath;
    if (typeof filepath !== 'string' || !filepath) return undefined;

    const line = source.entries.line;
    const column = source.entries.column;

    return {
        filepath,
        ...(typeof line === 'number' && line > 0 ? { line } : {}),
        ...(typeof column === 'number' && column > 0 ? { column } : {}),
    };
};

const addSuspect = (
    suspects: Map<string, TSuspectAccumulator>,
    owner: TExplainOwnerMatch | undefined,
    weight: number,
    reason: string,
) => {
    if (!owner) return;

    const key = `${owner.source.filepath}:${owner.source.line || 0}:${owner.source.column || 0}`;
    const existing = suspects.get(key);

    if (existing) {
        existing.score += weight;
        existing.reasons.add(reason);
        return;
    }

    suspects.set(key, {
        column: owner.source.column,
        filepath: owner.source.filepath,
        label: owner.label,
        line: owner.source.line,
        reasons: new Set([reason]),
        score: weight,
    });
};

const findRepoRoot = (startPath: string) => {
    let currentPath = resolvePath(startPath);

    while (true) {
        const gitDir = joinPath(currentPath, '.git');
        if (fileExists(gitDir)) return currentPath;

        const parentPath = dirnamePath(currentPath);
        if (parentPath === currentPath) return resolvePath(startPath);
        currentPath = parentPath;
    }
};

const resolveGuidanceFile = ({
    appRoot,
    fallbackFilepath,
    relativePath,
}: {
    appRoot: string;
    fallbackFilepath: string;
    relativePath: string;
}) => {
    const localFilepath = joinPath(appRoot, relativePath);
    if (fileExists(localFilepath)) return { filepath: localFilepath, warning: undefined as string | undefined };

    return {
        filepath: fallbackFilepath,
        warning: `Missing ${relativePath} in ${appRoot}; using ${fallbackFilepath}.`,
    };
};

const resolveAreaAgents = ({
    appRoot,
    coreRoot,
    ownerFilepath,
}: {
    appRoot: string;
    coreRoot: string;
    ownerFilepath?: string;
}) => {
    if (!ownerFilepath) return [];

    const fallbackRoot = joinPath(coreRoot, 'agents', 'project');
    const normalizedOwner = normalizeFilepath(resolvePath(ownerFilepath));
    const normalizedAppRoot = normalizeFilepath(resolvePath(appRoot));
    const relativeOwner = normalizedOwner.startsWith(`${normalizedAppRoot}/`)
        ? normalizeFilepath(relativePath(appRoot, ownerFilepath))
        : undefined;

    if (!relativeOwner) return [];

    const relativeDir = normalizeFilepath(dirnamePath(relativeOwner));
    if (relativeDir === '.' || relativeDir === '') return [];

    const segments = relativeDir.split('/').filter(Boolean);
    const areaAgents: string[] = [];
    for (let index = 0; index < segments.length; index++) {
        const areaRelativePath = joinPath(...segments.slice(0, index + 1), 'AGENTS.md');
        const localFilepath = joinPath(appRoot, areaRelativePath);
        const fallbackFilepath = joinPath(fallbackRoot, areaRelativePath);

        if (fileExists(localFilepath)) areaAgents.push(localFilepath);
        else if (fileExists(fallbackFilepath)) areaAgents.push(fallbackFilepath);
    }

    return [...new Set(areaAgents)];
};

const resolveGuidance = ({
    manifest,
    ownerFilepath,
}: {
    manifest: TProteumManifest;
    ownerFilepath?: string;
}) => {
    const fallbackRoot = joinPath(manifest.app.coreRoot, 'agents', 'project');
    const warnings: string[] = [];
    const agents = resolveGuidanceFile({
        appRoot: manifest.app.root,
        fallbackFilepath: joinPath(fallbackRoot, 'AGENTS.md'),
        relativePath: 'AGENTS.md',
    });
    const diagnostics = resolveGuidanceFile({
        appRoot: manifest.app.root,
        fallbackFilepath: joinPath(fallbackRoot, 'diagnostics.md'),
        relativePath: 'diagnostics.md',
    });
    const optimizations = resolveGuidanceFile({
        appRoot: manifest.app.root,
        fallbackFilepath: joinPath(fallbackRoot, 'optimizations.md'),
        relativePath: 'optimizations.md',
    });
    const codingStyle = resolveGuidanceFile({
        appRoot: manifest.app.root,
        fallbackFilepath: joinPath(fallbackRoot, 'CODING_STYLE.md'),
        relativePath: 'CODING_STYLE.md',
    });

    for (const warning of [agents.warning, diagnostics.warning, optimizations.warning, codingStyle.warning]) {
        if (warning) warnings.push(warning);
    }

    return {
        guidance: {
            agents: agents.filepath,
            diagnostics: diagnostics.filepath,
            optimizations: optimizations.filepath,
            codingStyle: codingStyle.filepath,
            areaAgents: resolveAreaAgents({
                appRoot: manifest.app.root,
                coreRoot: manifest.app.coreRoot,
                ownerFilepath,
            }),
        } satisfies TOrientGuidance,
        warnings,
    };
};

const getConnectedNamespaceForOwner = (manifest: TProteumManifest, owner?: TExplainOwnerMatch) => {
    if (!owner || owner.kind !== 'controller') return undefined;

    const controller = manifest.controllers.find(
        (candidate) =>
            candidate.httpPath === owner.label &&
            candidate.filepath === owner.source.filepath &&
            candidate.sourceLocation.line === (owner.source.line || candidate.sourceLocation.line),
    );

    return controller?.connectedProjectNamespace;
};

const buildConnectedSummary = ({
    manifest,
    owner,
    query,
}: {
    manifest: TProteumManifest;
    owner: TExplainOwnerResponse;
    query: string;
}) => {
    const tokens = tokenize(query);
    const topOwner = owner.matches[0];
    const ownerNamespace = getConnectedNamespaceForOwner(manifest, topOwner);
    const queryLikelyCrossesBoundary =
        owner.matches.some((match) => match.scopeLabel === 'connected') ||
        manifest.connectedProjects.some((project) =>
            [project.namespace, project.identityIdentifier, project.identityName].some(
                (value) => typeof value === 'string' && tokens.some((token) => normalizeText(value).includes(token)),
            ),
        );

    const imports = manifest.controllers
        .filter((controller) => controller.connectedProjectNamespace)
        .map((controller) => {
            const namespace = controller.connectedProjectNamespace as string;
            const score =
                (ownerNamespace === namespace ? 100 : 0) +
                (topOwner?.source.filepath === controller.filepath ? 40 : 0) +
                (tokens.some((token) => normalizeText(namespace).includes(token)) ? 20 : 0) +
                (tokens.some((token) => normalizeText(controller.clientAccessor).includes(token)) ? 18 : 0) +
                (tokens.some((token) => normalizeText(controller.httpPath).includes(token)) ? 18 : 0);

            return {
                namespace,
                controller,
                score,
            };
        })
        .filter(({ score }) => score > 0 || queryLikelyCrossesBoundary)
        .sort((left, right) => right.score - left.score || left.controller.clientAccessor.localeCompare(right.controller.clientAccessor))
        .slice(0, queryLikelyCrossesBoundary ? 6 : 4)
        .map(({ namespace, controller }) => ({
            namespace,
            clientAccessor: controller.clientAccessor,
            httpPath: controller.httpPath,
            filepath: controller.filepath,
            scopeLabel: 'connected' as const,
            originHint: `connected boundary import from ${namespace}`,
        }));

    const producerNamespaceSet = new Set<string>([ownerNamespace, ...imports.map((item) => item.namespace)].filter(Boolean) as string[]);
    const producers = manifest.connectedProjects
        .map((project) => {
            const score =
                (producerNamespaceSet.has(project.namespace) ? 100 : 0) +
                (tokens.some((token) => normalizeText(project.namespace).includes(token)) ? 20 : 0) +
                (tokens.some((token) => normalizeText(project.identityIdentifier || '').includes(token)) ? 18 : 0) +
                (tokens.some((token) => normalizeText(project.identityName || '').includes(token)) ? 18 : 0);

            return {
                project,
                score,
            };
        })
        .filter(({ score }) => score > 0 || (queryLikelyCrossesBoundary && manifest.connectedProjects.length > 0))
        .sort((left, right) => right.score - left.score || left.project.namespace.localeCompare(right.project.namespace))
        .slice(0, queryLikelyCrossesBoundary ? 4 : 2)
        .map(({ project }) => ({
            namespace: project.namespace,
            identityIdentifier: project.identityIdentifier,
            identityName: project.identityName,
            sourceKind: project.sourceKind,
            sourceValue: project.sourceValue,
            urlInternal: project.urlInternal,
            controllerCount: project.controllerCount,
            cachedContractFilepath: project.cachedContractFilepath,
            typingMode: project.typingMode,
        }));

    return {
        imports,
        producers,
    } satisfies TOrientConnected;
};

const quoteShellArgument = (value: string) => JSON.stringify(value);

const resolveRequestTarget = (owner: TExplainOwnerResponse, query: string) => {
    if (query.startsWith('/')) return query;

    const topOwner = owner.matches[0];
    if (!topOwner) return undefined;
    if ((topOwner.kind === 'route' || topOwner.kind === 'controller') && topOwner.label.startsWith('/')) return topOwner.label;

    return undefined;
};

const buildNextSteps = ({
    connected,
    owner,
    query,
}: {
    connected: TOrientConnected;
    owner: TExplainOwnerResponse;
    query: string;
}) => {
    const requestTarget = resolveRequestTarget(owner, query);
    const topOwner = owner.matches[0];
    const steps: TOrientationNextStep[] = [
        {
            label: 'Verify Owner',
            command: `proteum verify owner ${quoteShellArgument(query)}`,
            reason: 'Separate owner-scoped blocking findings from unrelated global diagnostics.',
        },
    ];

    if (topOwner?.kind === 'command') {
        steps.push({
            label: 'Run Command',
            command: `proteum command ${quoteShellArgument(topOwner.label)}`,
            reason: 'Exercise the smallest trustworthy runtime surface for the matched command owner.',
        });
    } else if (requestTarget) {
        steps.push({
            label: 'Diagnose Request',
            command: `proteum diagnose ${quoteShellArgument(requestTarget)} --hit ${quoteShellArgument(requestTarget)}`,
            reason: 'Hit the real runtime once and capture owner lookup, trace data, and server diagnostics together.',
        });
    } else {
        steps.push({
            label: 'Explain Owner',
            command: `proteum explain owner ${quoteShellArgument(query)}`,
            reason: 'Inspect the exact manifest owner match before reading more source.',
        });
    }

    if (connected.imports.length > 0 || connected.producers.length > 0) {
        steps.push({
            label: 'Inspect Connected',
            command: 'proteum connect --controllers',
            reason: 'Confirm imported controllers, contract cache state, and runtime internal URLs for the connected boundary.',
        });
    } else if (requestTarget) {
        steps.push({
            label: 'Inspect Perf',
            command: `proteum perf request ${quoteShellArgument(requestTarget)}`,
            reason: 'Summarize SQL, render, cache, and fetcher cost for the same request surface.',
        });
    } else {
        steps.push({
            label: 'Check Contracts',
            command: 'proteum doctor --contracts',
            reason: 'Confirm the framework-owned source and generated artifact contract before broader checks.',
        });
    }

    return steps
        .filter((step, index, list) => list.findIndex((candidate) => candidate.command === step.command) === index)
        .slice(0, 3);
};

const getServiceSource = (manifest: TProteumManifest, label: string): TOwnerSource | undefined => {
    const service = [...manifest.services.app, ...manifest.services.routerPlugins].find((candidate) => candidate.registeredName === label);
    if (!service || !service.sourceFilepath) return undefined;

    return {
        filepath: service.sourceFilepath,
        ...(service.scope ? { scope: service.scope } : {}),
    };
};

const pushChainItem = (items: TDiagnoseChainItem[], item: TDiagnoseChainItem | undefined) => {
    if (!item) return;

    const key = `${item.kind}:${item.label}:${item.source?.filepath || ''}:${item.source?.line || 0}:${item.source?.column || 0}`;
    if (items.some((candidate) => `${candidate.kind}:${candidate.label}:${candidate.source?.filepath || ''}:${candidate.source?.line || 0}:${candidate.source?.column || 0}` === key)) return;

    items.push(item);
};

export const buildRequestChain = ({
    manifest,
    owner,
    request,
}: {
    manifest: TProteumManifest;
    owner: TExplainOwnerResponse;
    request?: TRequestTrace;
}) => {
    if (!request) return undefined;

    const chain: TDiagnoseChainItem[] = [];
    const topOwner = owner.matches[0];

    if (topOwner && (topOwner.kind === 'route' || topOwner.kind === 'controller')) {
        pushChainItem(chain, {
            kind: topOwner.kind,
            label: topOwner.label,
            source: topOwner.source,
            details: [`scope=${topOwner.scopeLabel}`, `origin=${topOwner.originHint}`],
        });
    }

    const routeEvent = request.events.find((event) => event.type === 'resolve.route-match');
    const routeLabel = readEventString(routeEvent as TTraceEvent, 'routePath');
    if (!topOwner || topOwner.kind !== 'route') {
        pushChainItem(
            chain,
            routeEvent && routeLabel
                ? {
                      kind: 'route',
                      label: routeLabel,
                      source: readEventSource(routeEvent),
                      details: [
                          ...(readEventString(routeEvent, 'method') ? [`method=${readEventString(routeEvent, 'method')}`] : []),
                          ...(readEventString(routeEvent, 'accept') ? [`accept=${readEventString(routeEvent, 'accept')}`] : []),
                      ],
                  }
                : undefined,
        );
    }

    const controllerEvent = request.events.find((event) => event.type === 'resolve.controller-route' || event.type === 'controller.start');
    const controllerLabel = readEventString(controllerEvent as TTraceEvent, 'target') || request.path;
    if ((!topOwner || topOwner.kind !== 'controller') && request.path.startsWith('/api')) {
        pushChainItem(
            chain,
            controllerEvent
                ? {
                      kind: 'controller',
                      label: controllerLabel,
                      source: readEventSource(controllerEvent),
                      details: [
                          ...(readEventString(controllerEvent, 'filepath') ? [`source=${readEventString(controllerEvent, 'filepath')}`] : []),
                      ],
                  }
                : undefined,
        );
    }

    const serviceLabels = [
        ...request.calls.flatMap((call) => (call.serviceLabel ? [call.serviceLabel] : [])),
        ...request.sqlQueries.flatMap((query) => (query.serviceLabel ? [query.serviceLabel] : [])),
    ].filter(Boolean);

    for (const serviceLabel of [...new Set(serviceLabels)].slice(0, 6)) {
        pushChainItem(chain, {
            kind: 'service',
            label: serviceLabel,
            source: getServiceSource(manifest, serviceLabel),
            details: ['service method observed in traced call or SQL stack'],
        });
    }

    const cacheHitEvent = request.events.find((event) => event.type === 'cache.hit');
    if (cacheHitEvent) {
        pushChainItem(chain, {
            kind: 'cache',
            label: `html-cache ${readEventString(cacheHitEvent, 'cachePhase') || 'hit'}`,
            details: [
                ...(readEventString(cacheHitEvent, 'cacheKey') ? [`key=${readEventString(cacheHitEvent, 'cacheKey')}`] : []),
            ],
        });
    }

    const cacheWriteEvents = request.events.filter((event) => event.type === 'cache.write');
    if (!cacheHitEvent && cacheWriteEvents.length > 0) {
        for (const cacheWriteEvent of cacheWriteEvents.slice(0, 3)) {
            pushChainItem(chain, {
                kind: 'cache',
                label: `html-cache ${readEventString(cacheWriteEvent, 'cachePhase') || 'write'}`,
                details: [
                    ...(readEventString(cacheWriteEvent, 'cacheKey') ? [`key=${readEventString(cacheWriteEvent, 'cacheKey')}`] : []),
                ],
            });
        }
    }

    const connectedNamespaces = [
        ...request.calls.flatMap((call) => (call.connectedProjectNamespace ? [call.connectedProjectNamespace] : [])),
        ...request.sqlQueries.flatMap((query) => (query.connectedNamespace ? [query.connectedNamespace] : [])),
    ].filter(Boolean);

    for (const namespace of [...new Set(connectedNamespaces)].slice(0, 4)) {
        const project = manifest.connectedProjects.find((candidate) => candidate.namespace === namespace);
        pushChainItem(chain, {
            kind: 'connected',
            label: namespace,
            details: [
                ...(project?.identityIdentifier ? [`identifier=${project.identityIdentifier}`] : []),
                ...(project?.urlInternal ? [`urlInternal=${project.urlInternal}`] : []),
                ...(project?.sourceKind ? [`source=${project.sourceKind}`] : []),
            ],
        });
    }

    const sqlFingerprints = request.sqlQueries
        .flatMap((query) => (query.fingerprint ? [query.fingerprint] : []))
        .filter(Boolean);
    for (const fingerprint of [...new Set(sqlFingerprints)].slice(0, 8)) {
        const matchingQuery = request.sqlQueries.find((query) => query.fingerprint === fingerprint);
        pushChainItem(chain, {
            kind: 'sql',
            label: fingerprint,
            details: [
                ...(matchingQuery?.operation ? [`operation=${matchingQuery.operation}`] : []),
                ...(matchingQuery?.model ? [`model=${matchingQuery.model}`] : []),
            ],
        });
    }

    return chain.length > 0 ? chain : undefined;
};

/*----------------------------------
- PUBLIC API
----------------------------------*/

export const explainOwner = (manifest: TProteumManifest, query: string): TExplainOwnerResponse => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return { matches: [], normalizedQuery, query };

    const matches = buildManifestEntries(manifest)
        .map((entry) => {
            const { score, matchedOn } = scoreOwnerMatch(query, entry);
            return score > 0 ? toOwnerMatch(entry, score, matchedOn) : undefined;
        })
        .filter((match): match is TExplainOwnerMatch => match !== undefined)
        .sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label))
        .slice(0, 12);

    return { matches, normalizedQuery, query };
};

export const buildOrientationResponse = (manifest: TProteumManifest, query: string): TOrientResponse => {
    const owner = explainOwner(manifest, query);
    const ownerFilepath = owner.matches[0]?.source.filepath;
    const guidanceResolution = resolveGuidance({ manifest, ownerFilepath });
    const connected = buildConnectedSummary({ manifest, owner, query });
    const nextSteps = buildNextSteps({ connected, owner, query });
    const connectResponse = getConnectModule()?.buildConnectResponse(manifest, { includeControllers: true });
    const warnings = [...guidanceResolution.warnings];

    if (owner.matches.length === 0) warnings.push(`No manifest owner matched "${query}".`);
    if (connectResponse?.diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
        warnings.push('Connected project diagnostics contain errors; inspect `proteum connect --controllers` before broader verification.');
    }

    return {
        query,
        normalizedQuery: owner.normalizedQuery,
        app: {
            appRoot: manifest.app.root,
            repoRoot: findRepoRoot(manifest.app.root),
            identifier: manifest.app.identity.identifier,
            ...(typeof manifest.env?.resolved?.routerPort === 'number' ? { routerPort: manifest.env.resolved.routerPort } : {}),
        },
        guidance: guidanceResolution.guidance,
        owner,
        connected,
        nextSteps,
        warnings,
    };
};

export const buildTraceAttribution = (manifest: TProteumManifest, request?: TRequestTrace): TTraceAttributionResponse | undefined => {
    if (!request) return undefined;

    const primaryQuery = request.path;
    const primary = primaryQuery
        ? buildTraceItemOwner(manifest, primaryQuery, 'request', request.id, `${request.method} ${request.path}`)
        : undefined;

    return {
        calls: request.calls.flatMap((call) => {
            const query = call.ownerFilepath || call.path || call.label;
            return query
                ? [buildTraceItemOwner(manifest, query, 'call', call.id, `${call.method || ''} ${call.path || call.label}`.trim())]
                : [];
        }),
        events: request.events.flatMap((event) => {
            const query = getEventQuery(event);
            return query ? [buildTraceItemOwner(manifest, query, 'event', `${event.index}`, `${event.type}`)] : [];
        }),
        primary,
        sqlQueries: request.sqlQueries.flatMap((query) => {
            const ownerQuery = query.ownerFilepath || query.callerPath || query.callerLabel || query.query;
            return ownerQuery
                ? [buildTraceItemOwner(manifest, ownerQuery, 'sql', query.id, `${query.operation} ${query.model || query.callerPath || 'query'}`)]
                : [];
        }),
    };
};

export const buildDiagnoseResponse = ({
    contracts,
    doctor,
    manifest,
    query,
    request,
    serverLogs,
}: {
    contracts: TDoctorResponse;
    doctor: TDoctorResponse;
    manifest: TProteumManifest;
    query: string;
    request?: TRequestTrace;
    serverLogs: TDevConsoleLogsResponse;
}): TDiagnoseResponse => {
    const owner = explainOwner(manifest, query);
    const attribution = buildTraceAttribution(manifest, request);
    const suspects = new Map<string, TSuspectAccumulator>();
    const orientation = buildOrientationResponse(manifest, query);
    const chain = buildRequestChain({ manifest, owner, request });

    addSuspect(suspects, owner.matches[0], 5, 'owner query');
    addSuspect(suspects, attribution?.primary?.owner, 8, 'primary request');

    for (const item of attribution?.events || []) addSuspect(suspects, item.owner, 2, `event:${item.label}`);
    for (const item of attribution?.calls || []) addSuspect(suspects, item.owner, 3, `call:${item.label}`);
    for (const item of attribution?.sqlQueries || []) addSuspect(suspects, item.owner, 1, `sql:${item.label}`);

    for (const diagnostic of [...doctor.diagnostics, ...contracts.diagnostics]) {
        const topOwner = explainOwner(manifest, diagnostic.filepath).matches[0];
        addSuspect(suspects, topOwner, diagnostic.level === 'error' ? 4 : 2, diagnostic.code);
    }

    return {
        attribution,
        contracts,
        doctor,
        explainSummary: buildExplainSummaryItems(manifest),
        owner,
        orientation: {
            guidance: orientation.guidance,
            connected: orientation.connected,
            nextSteps: orientation.nextSteps,
        },
        chain,
        query,
        request,
        serverLogs,
        suspects: [...suspects.values()]
            .sort((left, right) => right.score - left.score || left.filepath.localeCompare(right.filepath))
            .slice(0, 12)
            .map((suspect) => ({
                column: suspect.column,
                filepath: suspect.filepath,
                label: suspect.label,
                line: suspect.line,
                reasons: [...suspect.reasons],
                score: suspect.score,
            })),
    };
};

export const summarizeTraceForDiagnose = (request?: TRequestTrace) =>
    !request
        ? 'No request trace matched the diagnose query.'
        : `${request.method} ${request.path} status=${summarizeTraceStatus(request.statusCode, request.errorMessage)} capture=${request.capture} calls=${request.calls.length} sql=${request.sqlQueries.length} events=${request.events.length}`;
