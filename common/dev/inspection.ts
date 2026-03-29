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
    query: string;
    request?: TRequestTrace;
    serverLogs: TDevConsoleLogsResponse;
    suspects: TDiagnoseSuspect[];
};

type TManifestEntry =
    | { details: string[]; kind: 'command'; label: string; searchTerms: string[]; source: TOwnerSource }
    | { details: string[]; kind: 'controller'; label: string; searchTerms: string[]; source: TOwnerSource }
    | { details: string[]; kind: 'diagnostic'; label: string; searchTerms: string[]; source: TOwnerSource }
    | { details: string[]; kind: 'layout'; label: string; searchTerms: string[]; source: TOwnerSource }
    | { details: string[]; kind: 'route'; label: string; searchTerms: string[]; source: TOwnerSource }
    | { details: string[]; kind: 'service'; label: string; searchTerms: string[]; source: TOwnerSource };

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
const tokenize = (value: string) =>
    normalizeText(value)
        .split(/[^a-z0-9/_.-]+/i)
        .map((token) => token.trim())
        .filter(Boolean);

/*----------------------------------
- HELPERS
----------------------------------*/

const toSource = (filepath: string, sourceLocation?: TProteumManifestSourceLocation, scope?: TProteumManifestScope): TOwnerSource => ({
    filepath,
    line: sourceLocation?.line,
    column: sourceLocation?.column,
    ...(scope ? { scope } : {}),
});

const pushTerm = (terms: Set<string>, value?: string) => {
    if (!value) return;

    const normalized = normalizeText(value);
    if (!normalized) return;
    terms.add(normalized);

    const basename = normalized.split('/').pop();
    if (basename) terms.add(basename);

    for (const token of tokenize(value)) terms.add(token);
};

const createRouteEntry = (route: TProteumManifestRoute): TManifestEntry => {
    const terms = new Set<string>();

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
            `setup=${route.hasSetup ? 'yes' : 'no'}`,
        ],
        kind: 'route',
        label: route.path || route.pathRaw || route.chunkId || route.filepath,
        searchTerms: [...terms],
        source: toSource(route.filepath, route.sourceLocation, route.scope),
    };
};

const createControllerEntry = (controller: TProteumManifestController): TManifestEntry => {
    const terms = new Set<string>();

    pushTerm(terms, controller.filepath);
    pushTerm(terms, controller.className);
    pushTerm(terms, controller.methodName);
    pushTerm(terms, controller.routePath);
    pushTerm(terms, controller.httpPath);
    pushTerm(terms, controller.clientAccessor);

    return {
        details: [
            controller.className,
            `method=${controller.methodName}`,
            `http=${controller.httpPath}`,
            `client=${controller.clientAccessor}`,
        ],
        kind: 'controller',
        label: controller.httpPath,
        searchTerms: [...terms],
        source: toSource(controller.filepath, controller.sourceLocation, controller.scope),
    };
};

const createCommandEntry = (command: TProteumManifestCommand): TManifestEntry => {
    const terms = new Set<string>();

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
    };
};

const createServiceEntry = (service: TProteumManifestService): TManifestEntry => {
    const terms = new Set<string>();
    const sourceFilepath = service.sourceFilepath || '';

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
        source: toSource(sourceFilepath || service.importPath || service.registeredName, undefined, service.scope),
    };
};

const createLayoutEntry = (layout: TProteumManifestLayout): TManifestEntry => {
    const terms = new Set<string>();

    pushTerm(terms, layout.filepath);
    pushTerm(terms, layout.chunkId);
    pushTerm(terms, layout.importPath);

    return {
        details: [`chunk=${layout.chunkId}`, `depth=${layout.depth}`],
        kind: 'layout',
        label: layout.chunkId || layout.filepath,
        searchTerms: [...terms],
        source: toSource(layout.filepath, undefined, layout.scope),
    };
};

const createDiagnosticEntry = (diagnostic: TProteumManifestDiagnostic): TManifestEntry => {
    const terms = new Set<string>();

    pushTerm(terms, diagnostic.code);
    pushTerm(terms, diagnostic.message);
    pushTerm(terms, diagnostic.filepath);
    for (const related of diagnostic.relatedFilepaths || []) pushTerm(terms, related);

    return {
        details: [`[${diagnostic.level}]`, diagnostic.message, ...(diagnostic.relatedFilepaths || []).map((filepath) => `related=${filepath}`)],
        kind: 'diagnostic',
        label: diagnostic.code,
        searchTerms: [...terms],
        source: toSource(diagnostic.filepath, diagnostic.sourceLocation),
    };
};

const buildManifestEntries = (manifest: TProteumManifest) => [
    ...manifest.routes.client.map(createRouteEntry),
    ...manifest.routes.server.map(createRouteEntry),
    ...manifest.controllers.map(createControllerEntry),
    ...manifest.commands.map(createCommandEntry),
    ...manifest.services.app.map(createServiceEntry),
    ...manifest.services.routerPlugins.map(createServiceEntry),
    ...manifest.layouts.map(createLayoutEntry),
    ...manifest.diagnostics.map(createDiagnosticEntry),
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

export const buildTraceAttribution = (manifest: TProteumManifest, request?: TRequestTrace): TTraceAttributionResponse | undefined => {
    if (!request) return undefined;

    const primaryQuery = request.path;
    const primary = primaryQuery
        ? buildTraceItemOwner(manifest, primaryQuery, 'request', request.id, `${request.method} ${request.path}`)
        : undefined;

    return {
        calls: request.calls.flatMap((call) => {
                const query = call.path || call.label;
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
                const ownerQuery = query.callerPath || query.callerLabel || query.query;
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
