import { normalizeConnectedProjectsConfig, type TConnectedProjectsConfig } from './connectedProjects';

type TObjectRecord = Record<string, unknown>;

export type TApplicationIdentityConfig = {
    name: string;
    identifier: string;
    description: string;
    author: {
        name: string;
        url: string;
        email: string;
    };
    social?: TObjectRecord;
    locale?: string;
    language: string;
    maincolor: string;
    iconsPack?: string;
    web: {
        title: string;
        titleSuffix: string;
        fullTitle: string;
        description: string;
        version: string;
        metas?: Record<string, string>;
        jsonld?: Record<string, string>;
    };
};

export type TApplicationSetupConfig = {
    transpile?: string[];
    connect?: TConnectedProjectsConfig;
};

export type TVerificationCheckScope = 'targeted' | 'area' | 'full' | 'static';

export type TVerificationSuiteConfig =
    | string
    | {
          command: string;
          cwd?: string;
          description?: string;
          scope?: TVerificationCheckScope;
      };

export type TVerificationRuleConfig = {
    id: string;
    match: readonly string[];
    reason: string;
    run: readonly string[];
    scope?: TVerificationCheckScope;
};

export type TVerificationDocsOnlyConfig =
    | boolean
    | {
          reason?: string;
      };

export type TVerificationConfig = {
    always?: readonly string[];
    docsOnly?: TVerificationDocsOnlyConfig;
    rules?: readonly TVerificationRuleConfig[];
    suites?: Record<string, TVerificationSuiteConfig>;
};

const isRecord = (value: unknown): value is TObjectRecord =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const readRequiredString = ({
    filepath,
    path,
    value,
}: {
    filepath: string;
    path: string;
    value: unknown;
}) => {
    if (typeof value === 'string' && value.trim()) return value;

    throw new Error(`Invalid ${path} in ${filepath}. Expected a non-empty string.`);
};

const readOptionalString = ({
    filepath,
    path,
    value,
}: {
    filepath: string;
    path: string;
    value: unknown;
}) => {
    if (value === undefined) return undefined;

    return readRequiredString({ filepath, path, value });
};

const readStringRecord = ({
    filepath,
    path,
    value,
}: {
    filepath: string;
    path: string;
    value: unknown;
}) => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new Error(`Invalid ${path} in ${filepath}. Expected an object of string values.`);

    const output: Record<string, string> = {};

    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== 'string')
            throw new Error(`Invalid ${path}.${key} in ${filepath}. Expected a string value.`);

        output[key] = entry;
    }

    return output;
};

const readStringArray = ({
    filepath,
    path,
    value,
}: {
    filepath: string;
    path: string;
    value: unknown;
}) => {
    if (!Array.isArray(value)) throw new Error(`Invalid ${path} in ${filepath}. Expected an array of strings.`);

    const output = value.map((entry, index) => {
        if (typeof entry !== 'string' || entry.trim() === '')
            throw new Error(`Invalid ${path}.${index} in ${filepath}. Expected a non-empty string.`);

        return entry.trim();
    });

    return [...new Set(output)];
};

const verificationScopes = new Set<TVerificationCheckScope>(['targeted', 'area', 'full', 'static']);

const readVerificationScope = ({
    filepath,
    path,
    value,
}: {
    filepath: string;
    path: string;
    value: unknown;
}) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !verificationScopes.has(value as TVerificationCheckScope)) {
        throw new Error(
            `Invalid ${path} in ${filepath}. Expected one of ${Array.from(verificationScopes).join(', ')}.`,
        );
    }

    return value as TVerificationCheckScope;
};

const normalizeVerificationSuiteConfig = ({
    filepath,
    key,
    value,
}: {
    filepath: string;
    key: string;
    value: unknown;
}): TVerificationSuiteConfig => {
    if (typeof value === 'string') return readRequiredString({ filepath, path: `suites.${key}`, value });
    if (!isRecord(value)) throw new Error(`Invalid suites.${key} in ${filepath}. Expected a command string or object.`);

    return {
        command: readRequiredString({ filepath, path: `suites.${key}.command`, value: value.command }),
        cwd: readOptionalString({ filepath, path: `suites.${key}.cwd`, value: value.cwd }),
        description: readOptionalString({ filepath, path: `suites.${key}.description`, value: value.description }),
        scope: readVerificationScope({ filepath, path: `suites.${key}.scope`, value: value.scope }),
    };
};

const normalizeVerificationSuitesConfig = ({
    filepath,
    value,
}: {
    filepath: string;
    value: unknown;
}): Record<string, TVerificationSuiteConfig> => {
    if (value === undefined) return {};
    if (!isRecord(value)) throw new Error(`Invalid suites in ${filepath}. Expected an object.`);

    const output: Record<string, TVerificationSuiteConfig> = {};

    for (const [key, entry] of Object.entries(value)) {
        if (!key.trim()) throw new Error(`Invalid suites key in ${filepath}. Expected a non-empty string.`);
        output[key] = normalizeVerificationSuiteConfig({ filepath, key, value: entry });
    }

    return output;
};

const normalizeVerificationRuleConfig = ({
    filepath,
    index,
    value,
}: {
    filepath: string;
    index: number;
    value: unknown;
}): TVerificationRuleConfig => {
    if (!isRecord(value)) throw new Error(`Invalid rules.${index} in ${filepath}. Expected an object.`);

    return {
        id: readRequiredString({ filepath, path: `rules.${index}.id`, value: value.id }),
        match: readStringArray({ filepath, path: `rules.${index}.match`, value: value.match }),
        reason: readRequiredString({ filepath, path: `rules.${index}.reason`, value: value.reason }),
        run: readStringArray({ filepath, path: `rules.${index}.run`, value: value.run }),
        scope: readVerificationScope({ filepath, path: `rules.${index}.scope`, value: value.scope }),
    };
};

const normalizeVerificationRulesConfig = ({
    filepath,
    value,
}: {
    filepath: string;
    value: unknown;
}): TVerificationRuleConfig[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`Invalid rules in ${filepath}. Expected an array.`);

    return value.map((entry, index) => normalizeVerificationRuleConfig({ filepath, index, value: entry }));
};

const normalizeVerificationDocsOnlyConfig = ({
    filepath,
    value,
}: {
    filepath: string;
    value: unknown;
}): TVerificationDocsOnlyConfig => {
    if (value === undefined) return true;
    if (typeof value === 'boolean') return value;
    if (!isRecord(value)) throw new Error(`Invalid docsOnly in ${filepath}. Expected a boolean or object.`);

    return {
        reason: readOptionalString({ filepath, path: 'docsOnly.reason', value: value.reason }),
    };
};

const readSocialConfig = ({
    filepath,
    value,
}: {
    filepath: string;
    value: unknown;
}) => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new Error(`Invalid social in ${filepath}. Expected an object.`);

    return value;
};

export const normalizeTranspileConfig = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];

    return Array.from(new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)));
};

export const normalizeApplicationIdentityConfig = (
    value: unknown,
    filepath = 'identity.config.ts',
): TApplicationIdentityConfig => {
    if (!isRecord(value)) throw new Error(`Invalid identity config in ${filepath}. Expected an object export.`);

    const author = value.author;
    const web = value.web;

    if (!isRecord(author)) throw new Error(`Invalid author in ${filepath}. Expected an object.`);
    if (!isRecord(web)) throw new Error(`Invalid web in ${filepath}. Expected an object.`);

    return {
        name: readRequiredString({ filepath, path: 'name', value: value.name }),
        identifier: readRequiredString({ filepath, path: 'identifier', value: value.identifier }),
        description: readRequiredString({ filepath, path: 'description', value: value.description }),
        author: {
            name: readRequiredString({ filepath, path: 'author.name', value: author.name }),
            url: readRequiredString({ filepath, path: 'author.url', value: author.url }),
            email: readRequiredString({ filepath, path: 'author.email', value: author.email }),
        },
        social: readSocialConfig({ filepath, value: value.social }),
        locale: readOptionalString({ filepath, path: 'locale', value: value.locale }),
        language: readRequiredString({ filepath, path: 'language', value: value.language }),
        maincolor: readRequiredString({ filepath, path: 'maincolor', value: value.maincolor }),
        iconsPack: readOptionalString({ filepath, path: 'iconsPack', value: value.iconsPack }),
        web: {
            title: readRequiredString({ filepath, path: 'web.title', value: web.title }),
            titleSuffix: readRequiredString({ filepath, path: 'web.titleSuffix', value: web.titleSuffix }),
            fullTitle: readRequiredString({ filepath, path: 'web.fullTitle', value: web.fullTitle }),
            description: readRequiredString({ filepath, path: 'web.description', value: web.description }),
            version: readRequiredString({ filepath, path: 'web.version', value: web.version }),
            metas: readStringRecord({ filepath, path: 'web.metas', value: web.metas }),
            jsonld: readStringRecord({ filepath, path: 'web.jsonld', value: web.jsonld }),
        },
    };
};

export const normalizeApplicationSetupConfig = (
    value: unknown,
    filepath = 'proteum.config.ts',
): TApplicationSetupConfig => {
    if (value === undefined) return {};
    if (!isRecord(value)) throw new Error(`Invalid setup config in ${filepath}. Expected an object export.`);
    if ('transpileModules' in value) {
        throw new Error(`Invalid setup config in ${filepath}. Use "transpile" instead of "transpileModules".`);
    }

    return {
        transpile: normalizeTranspileConfig(value.transpile),
        connect: normalizeConnectedProjectsConfig(value.connect),
    };
};

export const normalizeVerificationConfig = (value: unknown, filepath = 'proteum.verify.config.ts'): TVerificationConfig => {
    if (value === undefined) return { always: [], docsOnly: true, rules: [], suites: {} };
    if (!isRecord(value)) throw new Error(`Invalid verification config in ${filepath}. Expected an object export.`);

    return {
        always: value.always === undefined ? [] : readStringArray({ filepath, path: 'always', value: value.always }),
        docsOnly: normalizeVerificationDocsOnlyConfig({ filepath, value: value.docsOnly }),
        rules: normalizeVerificationRulesConfig({ filepath, value: value.rules }),
        suites: normalizeVerificationSuitesConfig({ filepath, value: value.suites }),
    };
};

class ApplicationConfigHelpers {
    public static identity<const TIdentity extends TApplicationIdentityConfig>(config: TIdentity) {
        return config;
    }

    public static setup<const TSetup extends TApplicationSetupConfig>(config: TSetup) {
        return config;
    }
}

export const defineVerificationConfig = <const TVerification extends TVerificationConfig>(config: TVerification) => config;

export const Application = ApplicationConfigHelpers;
