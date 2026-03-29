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

class ApplicationConfigHelpers {
    public static identity<const TIdentity extends TApplicationIdentityConfig>(config: TIdentity) {
        return config;
    }

    public static setup<const TSetup extends TApplicationSetupConfig>(config: TSetup) {
        return config;
    }
}

export const Application = ApplicationConfigHelpers;
