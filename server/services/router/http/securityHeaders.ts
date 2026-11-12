/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type express from 'express';
import onHeaders from 'on-headers';

/*----------------------------------
- TYPES
----------------------------------*/

/** A Content-Security-Policy written by its real directive names, e.g. `{ 'frame-ancestors': ["'self'"] }`. */
export type TCspDirectives = Readonly<Record<string, readonly string[]>>;

export type TCspReportOnly = {
    /** A complete policy, sent as `Content-Security-Policy-Report-Only` on the answers that carry the app policy. */
    policy: TCspDirectives;
    /** Appended to the report-only policy as `report-uri`. */
    reportUri?: string;
};

/** The four historical lists. Proteum adds `'unsafe-inline' 'self' 'unsafe-eval'` to the scripts. */
export type TCspLegacyConfig = {
    default?: readonly string[];
    styles?: readonly string[];
    images?: readonly string[];
    scripts: readonly string[];
    /** More enforced directives by their real names, appended after the four lists. */
    directives?: TCspDirectives;
    policy?: undefined;
    reportOnly?: TCspReportOnly;
};

/** A complete enforced policy written in full by the app: Proteum adds nothing to it. */
export type TCspPolicyConfig = {
    policy: TCspDirectives;
    default?: undefined;
    styles?: undefined;
    images?: undefined;
    scripts?: undefined;
    directives?: undefined;
    reportOnly?: TCspReportOnly;
};

export type TCspConfig = TCspLegacyConfig | TCspPolicyConfig;

export type TContentSecurityPolicyHeaders = {
    /** The enforced `Content-Security-Policy` value: router answers outside `/api`, HTML under `/api`. */
    policy: string;
    /** The `Content-Security-Policy-Report-Only` value, on the answers that carry the app policy, when configured. */
    reportOnly?: string;
};

type TDirectiveEntries = Array<[string, string[]]>;

/*----------------------------------
- CONSTANTS
----------------------------------*/

export const contentSecurityPolicyHeader = 'Content-Security-Policy';
export const contentSecurityPolicyReportOnlyHeader = 'Content-Security-Policy-Report-Only';

/** Directives the four legacy lists own, whether or not the list is filled. */
const legacyDirectiveNames = new Set(['default-src', 'script-src', 'style-src', 'img-src']);
const legacyListNames = ['default', 'styles', 'images', 'scripts'] as const;

/** The CSP 3 directives a browser understands: any other name is a typo the browser would ignore. */
const knownDirectiveNames = new Set([
    'base-uri',
    'block-all-mixed-content',
    'child-src',
    'connect-src',
    'default-src',
    'fenced-frame-src',
    'font-src',
    'form-action',
    'frame-ancestors',
    'frame-src',
    'img-src',
    'manifest-src',
    'media-src',
    'object-src',
    'report-to',
    'report-uri',
    'require-trusted-types-for',
    'sandbox',
    'script-src',
    'script-src-attr',
    'script-src-elem',
    'style-src',
    'style-src-attr',
    'style-src-elem',
    'trusted-types',
    'upgrade-insecure-requests',
    'worker-src',
]);
/** Directives that take no value at all. */
const valuelessDirectiveNames = new Set(['upgrade-insecure-requests', 'block-all-mixed-content']);
/** Directives whose value list may be empty. */
const optionalValueDirectiveNames = new Set(['sandbox', 'trusted-types']);
/** Directives whose values are tokens or addresses, not sources. */
const nonSourceDirectiveNames = new Set(['sandbox', 'report-uri', 'report-to']);
/** Keywords that only mean something inside single quotes: bare, they name a host. */
const quotedKeywords = new Set([
    'self',
    'none',
    'unsafe-inline',
    'unsafe-eval',
    'unsafe-hashes',
    'strict-dynamic',
    'report-sample',
    'wasm-unsafe-eval',
]);
/** Printable ASCII with no whitespace, `;` or `,`: anything else breaks the header or the directive list. */
const headerTokenPattern = /^[\x21-\x2b\x2d-\x3a\x3c-\x7e]+$/;
/** HTML documents: under `/api`, the only answers that get the app policy. */
const documentContentTypePattern = /^\s*(?:text\/html|application\/xhtml\+xml)\s*(?:;|$)/i;

/*----------------------------------
- BUILD (boot time)
----------------------------------*/

const fail = (message: string): never => {
    throw new Error(`[http.csp] ${message}`);
};

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const readToken = (label: string, token: unknown): string => {
    if (typeof token !== 'string' || !headerTokenPattern.test(token))
        return fail(`${label} must be a non-empty source in printable ASCII with no whitespace, ";" or "," (got ${JSON.stringify(token)}).`);
    return token;
};

/**
 * A legacy list entry keeps its 2.6 meaning: helmet joined the entries with spaces, so an entry
 * holding several space-separated sources still writes the same header.
 */
// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const readLegacyList = (label: string, value: unknown): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return fail(`${label} must be an array of sources.`);

    return value.flatMap((entry, index) => {
        if (typeof entry !== 'string') return fail(`${label}[${index}] must be a string.`);
        return entry
            .split(/\s+/)
            .filter((token) => token !== '')
            .map((token) => readToken(`${label}[${index}]`, token));
    });
};

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const readSource = (label: string, directiveName: string, source: unknown): string => {
    const token = readToken(label, source);
    if (nonSourceDirectiveNames.has(directiveName)) return token;

    if (quotedKeywords.has(token.toLowerCase()))
        fail(`${label} is the bare word ${JSON.stringify(token)}, which names a host: write "'${token}'" with its single quotes.`);
    const startsQuoted = token.startsWith("'");
    const endsQuoted = token.endsWith("'");
    if ((startsQuoted || endsQuoted) && !(startsQuoted && endsQuoted && token.length > 2 && !token.slice(1, -1).includes("'")))
        fail(`${label} has unbalanced single quotes: ${JSON.stringify(token)}.`);

    return token;
};

/** Validates a directive record and returns it as ordered `[name, sources]` entries. */
// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const readDirectives = (label: string, value: unknown): TDirectiveEntries => {
    if (!isPlainRecord(value)) return fail(`${label} must be an object of directive name to sources.`);

    return Object.entries(value).map(([name, sources]) => {
        if (!knownDirectiveNames.has(name))
            return fail(`${label} has an unknown directive name ${JSON.stringify(name)}: use a real CSP directive name, lowercase, e.g. "frame-ancestors".`);
        if (!Array.isArray(sources)) return fail(`${label}['${name}'] must be an array of sources.`);

        const values = sources.map((source, index) => readSource(`${label}['${name}'][${index}]`, name, source));
        if (valuelessDirectiveNames.has(name) && values.length > 0)
            return fail(`${label}['${name}'] takes no value: write an empty array.`);
        if (values.length === 0 && !valuelessDirectiveNames.has(name) && !optionalValueDirectiveNames.has(name))
            return fail(`${label}['${name}'] is empty: a directive needs at least one source.`);

        return [name, values];
    });
};

/** Serializes directives in helmet 4.6's exact format, so legacy headers stay byte for byte. */
const serializeDirectives = (directives: TDirectiveEntries) =>
    directives.map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`)).join(';');

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const buildLegacyDirectives = (config: Record<string, unknown>): TDirectiveEntries => {
    if (config.scripts === undefined) fail('csp.scripts is required with the list form (an empty array is fine), or write the whole policy in csp.policy.');
    const defaults = readLegacyList('csp.default', config.default);
    const scripts = readLegacyList('csp.scripts', config.scripts);
    const styles = readLegacyList('csp.styles', config.styles);
    const images = readLegacyList('csp.images', config.images);

    const directives: TDirectiveEntries = [];
    if (defaults.length > 0) directives.push(['default-src', defaults]);
    directives.push(['script-src', ["'unsafe-inline'", "'self'", "'unsafe-eval'", ...scripts]]);
    if (styles.length > 0) directives.push(['style-src', styles]);
    if (images.length > 0) directives.push(['img-src', images]);

    if (config.directives !== undefined) {
        const extra = readDirectives('csp.directives', config.directives);
        for (const [name] of extra) {
            if (legacyDirectiveNames.has(name))
                fail(`csp.directives names ${JSON.stringify(name)}, which the legacy lists own: use default, scripts, styles or images, or write the whole policy in csp.policy.`);
        }
        directives.push(...extra);
    }

    return directives;
};

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const buildReportOnlyDirectives = (value: unknown): TDirectiveEntries => {
    if (!isPlainRecord(value)) return fail('csp.reportOnly must be an object with a policy.');

    const directives = readDirectives('csp.reportOnly.policy', value.policy);
    if (directives.length === 0) fail('csp.reportOnly.policy has no directive.');

    if (value.reportUri !== undefined) {
        const reportUri = readToken('csp.reportOnly.reportUri', value.reportUri);
        if (directives.some(([name]) => name === 'report-uri'))
            fail('csp.reportOnly sets report-uri twice: keep reportUri or the policy entry, not both.');
        directives.push(['report-uri', [reportUri]]);
    }

    return directives;
};

/**
 * Builds the policy header values once, at boot.
 * Throws on any malformed config, so a broken header can never reach production.
 */
export const buildContentSecurityPolicyHeaders = (cspConfig: TCspConfig): TContentSecurityPolicyHeaders => {
    // @boundary Apps may write their config in plain JavaScript: every field is checked again here.
    const config: unknown = cspConfig;
    if (!isPlainRecord(config)) return fail('csp must be an object.');

    let directives: TDirectiveEntries;
    if (config.policy !== undefined) {
        const legacyFields = [...legacyListNames, 'directives'].filter((name) => config[name] !== undefined);
        if (legacyFields.length > 0)
            fail(`csp.policy replaces the whole policy, so ${legacyFields.join(', ')} must be absent.`);

        directives = readDirectives('csp.policy', config.policy);
        if (directives.length === 0) fail('csp.policy has no directive.');
    } else {
        directives = buildLegacyDirectives(config);
    }

    const headers: TContentSecurityPolicyHeaders = { policy: serializeDirectives(directives) };
    if (config.reportOnly !== undefined) headers.reportOnly = serializeDirectives(buildReportOnlyDirectives(config.reportOnly));

    return headers;
};

/*----------------------------------
- WRITE (request time)
----------------------------------*/

const readContentType = (res: express.Response) => {
    const value = res.getHeader('Content-Type');
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
};

/** Adds the report-only policy when the headers are written, if the answer still carries the app policy. */
const writeReportOnlyWithAppPolicy = (res: express.Response, headers: TContentSecurityPolicyHeaders) => {
    if (headers.reportOnly === undefined) return;
    if (res.getHeader(contentSecurityPolicyHeader) !== headers.policy) return;
    if (res.hasHeader(contentSecurityPolicyReportOnlyHeader)) return;

    res.setHeader(contentSecurityPolicyReportOnlyHeader, headers.reportOnly);
};

/**
 * Outside `/api`: every router answer gets the app policy, whatever its type, as in 2.6
 * (a worker takes its policy from its own script's answer, so a route-served worker must keep it).
 * Set at the start of the request, so a route that writes its own policy replaces it.
 */
export const createAppContentSecurityPolicy =
    (headers: TContentSecurityPolicyHeaders): express.RequestHandler =>
    (_req, res, next) => {
        res.setHeader(contentSecurityPolicyHeader, headers.policy);
        if (headers.reportOnly !== undefined)
            onHeaders(res, function writeReportOnly(this: express.Response) {
                writeReportOnlyWithAppPolicy(this, headers);
            });

        next();
    };

/**
 * Under `/api`: decides the policy when the headers are about to be written, by the final status and Content-Type.
 * Mount it after helmet: the value helmet wrote at the start of the request is the baseline.
 * - a route wrote or removed its own policy: everything is left as it is;
 * - a 304: no policy at all, so the browser keeps the one its stored copy came with;
 * - an HTML document: the app policy, plus the report-only policy when configured;
 * - anything else: helmet's value stays.
 */
export const createApiContentSecurityPolicyWriter =
    (headers: TContentSecurityPolicyHeaders): express.RequestHandler =>
    (_req, res, next) => {
        const baseline = res.getHeader(contentSecurityPolicyHeader);

        onHeaders(res, function writeContentSecurityPolicy(this: express.Response) {
            if (this.getHeader(contentSecurityPolicyHeader) !== baseline) return;

            // A 304 refreshes the stored copy's headers: helmet's default there would replace the page's policy.
            if (this.statusCode === 304) {
                this.removeHeader(contentSecurityPolicyHeader);
                return;
            }

            const contentType = readContentType(this);
            if (contentType === undefined || !documentContentTypePattern.test(contentType)) return;

            this.setHeader(contentSecurityPolicyHeader, headers.policy);
            writeReportOnlyWithAppPolicy(this, headers);
        });

        next();
    };
