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
export type TCspDirectives = Record<string, string[]>;

export type TCspReportOnly = {
    /** A complete policy, sent as `Content-Security-Policy-Report-Only` on HTML answers only. */
    policy: TCspDirectives;
    /** Appended to the report-only policy as `report-uri`. */
    reportUri?: string;
};

/** The four historical lists. Proteum adds `'unsafe-inline' 'self' 'unsafe-eval'` to the scripts. */
export type TCspLegacyConfig = {
    default?: string[];
    styles?: string[];
    images?: string[];
    scripts: string[];
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
    /** The enforced `Content-Security-Policy` value for HTML answers. */
    policy: string;
    /** The `Content-Security-Policy-Report-Only` value for HTML answers, when configured. */
    reportOnly?: string;
};

/*----------------------------------
- CONSTANTS
----------------------------------*/

export const contentSecurityPolicyHeader = 'Content-Security-Policy';
export const contentSecurityPolicyReportOnlyHeader = 'Content-Security-Policy-Report-Only';

/** Directives the four legacy lists own, whether or not the list is filled. */
const legacyDirectiveNames = ['default-src', 'script-src', 'style-src', 'img-src'] as const;
const legacyListNames = ['default', 'styles', 'images', 'scripts'] as const;
/** Directives that may carry no value at all. */
const valuelessDirectiveNames = new Set(['upgrade-insecure-requests', 'block-all-mixed-content', 'sandbox']);
const directiveNamePattern = /^[a-z]+(-[a-z]+)*$/;
const invalidSourcePattern = /[\s;,]/;
const htmlContentTypePattern = /^\s*text\/html\b/i;

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
const readSources = (label: string, value: unknown): string[] => {
    if (!Array.isArray(value)) return fail(`${label} must be an array of sources.`);

    return value.map((source, index) => {
        if (typeof source !== 'string' || source === '' || invalidSourcePattern.test(source))
            return fail(`${label}[${index}] must be a non-empty source with no whitespace, ";" or ",".`);
        return source;
    });
};

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
/** Validates a directive record and returns it as ordered `[name, sources]` entries. */
const readDirectives = (label: string, value: unknown): Array<[string, string[]]> => {
    if (!isPlainRecord(value)) return fail(`${label} must be an object of directive name to sources.`);

    return Object.entries(value).map(([name, sources]) => {
        if (!directiveNamePattern.test(name))
            return fail(`${label} has an invalid directive name ${JSON.stringify(name)}: use the real lowercase name, e.g. "frame-ancestors".`);

        const values = readSources(`${label}['${name}']`, sources);
        if (values.length === 0 && !valuelessDirectiveNames.has(name))
            return fail(`${label}['${name}'] is empty: a directive needs at least one source.`);

        return [name, values];
    });
};

/** Serializes directives in helmet 4.6's exact format, so legacy headers stay byte for byte. */
const serializeDirectives = (directives: Array<[string, string[]]>) =>
    directives.map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`)).join(';');

const assertNoDuplicates = (label: string, directives: Array<[string, string[]]>) => {
    const seen = new Set<string>();
    for (const [name] of directives) {
        if (seen.has(name)) fail(`${label} names ${JSON.stringify(name)} twice.`);
        seen.add(name);
    }
};

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const buildLegacyDirectives = (config: Record<string, unknown>): Array<[string, string[]]> => {
    const defaults = config.default === undefined ? [] : readSources('csp.default', config.default);
    const scripts = readSources('csp.scripts', config.scripts);
    const styles = config.styles === undefined ? [] : readSources('csp.styles', config.styles);
    const images = config.images === undefined ? [] : readSources('csp.images', config.images);

    const directives: Array<[string, string[]]> = [];
    if (defaults.length > 0) directives.push(['default-src', defaults]);
    directives.push(['script-src', ["'unsafe-inline'", "'self'", "'unsafe-eval'", ...scripts]]);
    if (styles.length > 0) directives.push(['style-src', styles]);
    if (images.length > 0) directives.push(['img-src', images]);

    if (config.directives !== undefined) {
        const extra = readDirectives('csp.directives', config.directives);
        for (const [name] of extra) {
            if ((legacyDirectiveNames as readonly string[]).includes(name))
                fail(`csp.directives names ${JSON.stringify(name)}, which the legacy lists own: use default, scripts, styles or images, or write the whole policy in csp.policy.`);
        }
        directives.push(...extra);
    }

    return directives;
};

// @boundary The csp config may be written in plain JavaScript: these readers check each field before use.
const buildReportOnlyDirectives = (value: unknown): Array<[string, string[]]> => {
    if (!isPlainRecord(value)) return fail('csp.reportOnly must be an object with a policy.');

    const directives = readDirectives('csp.reportOnly.policy', value.policy);
    if (directives.length === 0) fail('csp.reportOnly.policy has no directive.');

    if (value.reportUri !== undefined) {
        if (typeof value.reportUri !== 'string' || value.reportUri === '' || invalidSourcePattern.test(value.reportUri))
            fail('csp.reportOnly.reportUri must be a non-empty address with no whitespace, ";" or ",".');
        if (directives.some(([name]) => name === 'report-uri'))
            fail('csp.reportOnly sets report-uri twice: keep reportUri or the policy entry, not both.');
        directives.push(['report-uri', [value.reportUri as string]]);
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

    let directives: Array<[string, string[]]>;
    if (config.policy !== undefined) {
        const legacyFields = [...legacyListNames, 'directives'].filter((name) => config[name] !== undefined);
        if (legacyFields.length > 0)
            fail(`csp.policy replaces the whole policy, so ${legacyFields.join(', ')} must be absent.`);

        directives = readDirectives('csp.policy', config.policy);
        if (directives.length === 0) fail('csp.policy has no directive.');
    } else {
        directives = buildLegacyDirectives(config);
    }
    assertNoDuplicates('csp', directives);

    const headers: TContentSecurityPolicyHeaders = { policy: serializeDirectives(directives) };

    if (config.reportOnly !== undefined) {
        const reportOnly = buildReportOnlyDirectives(config.reportOnly);
        assertNoDuplicates('csp.reportOnly.policy', reportOnly);
        headers.reportOnly = serializeDirectives(reportOnly);
    }

    return headers;
};

/*----------------------------------
- WRITE (request time)
----------------------------------*/

const policyWriterInstalled = Symbol('proteum.policyWriterInstalled');

type TPolicyWriterResponse = express.Response & { [policyWriterInstalled]?: true };

/**
 * Decides the policy by the final Content-Type, when the headers are about to be written.
 * Mount it after helmet: the value helmet wrote at the start of the request is the baseline.
 * - a route wrote or removed its own policy: everything is left as it is;
 * - the answer is HTML: the app policy, plus the report-only policy when configured;
 * - anything else: helmet's value stays.
 */
export const createContentSecurityPolicyWriter =
    (headers: TContentSecurityPolicyHeaders): express.RequestHandler =>
    (_req, res: TPolicyWriterResponse, next) => {
        if (res[policyWriterInstalled]) return next();
        res[policyWriterInstalled] = true;

        const baseline = res.getHeader(contentSecurityPolicyHeader);

        onHeaders(res, function writeContentSecurityPolicy(this: express.Response) {
            if (this.getHeader(contentSecurityPolicyHeader) !== baseline) return;

            const contentType = this.getHeader('Content-Type');
            if (typeof contentType !== 'string' || !htmlContentTypePattern.test(contentType)) return;

            this.setHeader(contentSecurityPolicyHeader, headers.policy);
            if (headers.reportOnly !== undefined && !this.hasHeader(contentSecurityPolicyReportOnlyHeader))
                this.setHeader(contentSecurityPolicyReportOnlyHeader, headers.reportOnly);
        });

        next();
    };
