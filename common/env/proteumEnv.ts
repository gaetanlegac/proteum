import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import {
    normalizeConnectedProjectsConfig,
    type TConnectedProjectsConfig,
} from '../connectedProjects';

export type TProteumEnvName = 'local' | 'server';
export type TProteumEnvProfile = 'dev' | 'testing' | 'prod';
export type TProteumTraceCapture = 'summary' | 'resolve' | 'deep';
export type TProteumRequiredEnvVariable = {
    key: string;
    possibleValues: string[];
    provided: boolean;
};
export type TProteumEnvInspection = {
    loadedVariableKeys: string[];
    requiredVariables: TProteumRequiredEnvVariable[];
};

export type TProteumConnectedProjectEnvConfig = {
    namespace: string;
    urlInternal: string;
};

export type TProteumEnvConfig = {
    name: TProteumEnvName;
    profile: TProteumEnvProfile;
    router: {
        port: number;
        currentDomain: string;
        internalUrl: string;
    };
    connectedProjects: Record<string, TProteumConnectedProjectEnvConfig>;
    trace: {
        enable: boolean;
        profilerEnable: boolean;
        requestsLimit: number;
        eventsLimit: number;
        capture: TProteumTraceCapture;
        persistOnError: boolean;
    };
};

export type TProteumLoadedEnvConfig = TProteumEnvConfig & { version: string };

const dotenvFileNames = ['.env'];
const baseRequiredProteumEnvVariableDefinitions = [
    { key: 'ENV_NAME', possibleValues: ['local', 'server'] },
    { key: 'ENV_PROFILE', possibleValues: ['dev', 'testing', 'prod'] },
    { key: 'PORT', possibleValues: ['integer between 1 and 65535'] },
    { key: 'URL', possibleValues: ['absolute URL'] },
    { key: 'URL_INTERNAL', possibleValues: ['absolute URL'] },
] as const;
const optionalProteumEnvVariablePrefixes = ['TRACE_'] as const;

type TEnvContext = {
    appDir: string;
    connectedProjects: TConnectedProjectsConfig;
};

const envDefinitionHint = (appDir: string) => `Define it in process.env or ${appDir}/.env.`;
const isProvidedEnvValue = (value: string | undefined) => typeof value === 'string' && value.trim() !== '';

const buildRequiredEnvVariableDefinitions = (_connectedProjects: TConnectedProjectsConfig) => [...baseRequiredProteumEnvVariableDefinitions];

const buildOptionalEnvKeys = (_connectedProjects: TConnectedProjectsConfig) => ['ENABLE_PROFILER'] as string[];

const formatRequiredEnvVariableStatus = (variable: TProteumRequiredEnvVariable) =>
    `- ${variable.key} possibleValues=${variable.possibleValues.join(' | ')} provided=${variable.provided ? 'yes' : 'no'}`;

const createProteumEnvError = ({
    appDir,
    connectedProjects,
    message,
}: {
    appDir: string;
    connectedProjects: TConnectedProjectsConfig;
    message: string;
}) => {
    const inspection = inspectProteumEnv(appDir, connectedProjects);

    return new Error(
        [message, envDefinitionHint(appDir), '', 'Required env variables:', ...inspection.requiredVariables.map(formatRequiredEnvVariableStatus)].join(
            '\n',
        ),
    );
};

const parseBooleanEnvValue = ({
    key,
    value,
    context,
}: {
    key: string;
    value: string | undefined;
    context: TEnvContext;
}) => {
    if (value === undefined || value === '') return undefined;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

    throw createProteumEnvError({
        ...context,
        message: `Invalid boolean value for ${key}: "${value}". Expected one of: 1, 0, true, false, yes, no, on, off.`,
    });
};

const parseIntegerEnvValue = ({
    key,
    value,
    context,
    min = 1,
}: {
    key: string;
    value: string;
    context: TEnvContext;
    min?: number;
}) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < min) {
        throw createProteumEnvError({
            ...context,
            message: `Invalid integer value for ${key}: "${value}". Expected an integer greater than or equal to ${min}.`,
        });
    }

    return parsed;
};

const getRequiredEnvValue = ({
    key,
    context,
}: {
    key: string;
    context: TEnvContext;
}) => {
    const value = process.env[key]?.trim();
    if (value) return value;

    throw createProteumEnvError({
        ...context,
        message: `Missing required Proteum env variable "${key}".`,
    });
};

const createConnectedProjectConfigError = ({
    appDir,
    message,
}: {
    appDir: string;
    message: string;
}) => new Error(`${message} Define it explicitly in ${path.join(appDir, 'proteum.config.ts')}.`);

const getRequiredConnectedConfigValue = ({
    appDir,
    namespace,
    field,
    value,
}: {
    appDir: string;
    namespace: string;
    field: 'source' | 'urlInternal';
    value: string | undefined;
}) => {
    const normalized = value?.trim();
    if (normalized) return normalized;

    throw createConnectedProjectConfigError({
        appDir,
        message: `Connected project "${namespace}" requires connect.${namespace}.${field}.`,
    });
};

const parseEnvName = (value: string, context: TEnvContext): TProteumEnvName => {
    if (value === 'local' || value === 'server') return value;
    throw createProteumEnvError({
        ...context,
        message: `Invalid ENV_NAME "${value}". Expected "local" or "server".`,
    });
};

const parseEnvProfile = (value: string, context: TEnvContext): TProteumEnvProfile => {
    if (value === 'dev' || value === 'testing' || value === 'prod') return value;
    throw createProteumEnvError({
        ...context,
        message: `Invalid ENV_PROFILE "${value}". Expected "dev", "testing", or "prod".`,
    });
};

const parseTraceCapture = ({
    value,
    context,
}: {
    value: string | undefined;
    context: TEnvContext;
}): TProteumTraceCapture | undefined => {
    if (value === undefined || value === '') return undefined;
    if (value === 'summary' || value === 'resolve' || value === 'deep') return value;

    throw createProteumEnvError({
        ...context,
        message: `Invalid TRACE_CAPTURE "${value}". Expected "summary", "resolve", or "deep".`,
    });
};

const parseAbsoluteUrl = ({
    key,
    value,
    context,
}: {
    key: string;
    value: string;
    context: TEnvContext;
}) => {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw createProteumEnvError({
            ...context,
            message: `Invalid absolute URL for ${key}: "${value}". Expected an absolute http:// or https:// URL.`,
        });
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw createProteumEnvError({
            ...context,
            message: `Invalid absolute URL for ${key}: "${value}". Expected an absolute http:// or https:// URL.`,
        });
    }

    return value;
};

const parseConnectedProjectAbsoluteUrl = ({
    appDir,
    namespace,
    field,
    value,
}: {
    appDir: string;
    namespace: string;
    field: 'urlInternal';
    value: string;
}) => {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
        return value;
    } catch {
        throw createConnectedProjectConfigError({
            appDir,
            message: `Invalid connect.${namespace}.${field} "${value}". Expected an absolute http:// or https:// URL.`,
        });
    }
};

export const loadOptionalProteumDotenv = (appDir: string) => {
    for (const filename of dotenvFileNames) {
        const filepath = path.join(appDir, filename);
        if (!fs.existsSync(filepath)) continue;
        dotenv.config({ path: filepath, quiet: true });
    }
};

export const getLoadedProteumEnvVariableKeys = (connectedProjects: TConnectedProjectsConfig = {}) => {
    const requiredKeys = new Set<string>(buildRequiredEnvVariableDefinitions(connectedProjects).map((definition) => definition.key));
    const optionalKeys = new Set<string>(buildOptionalEnvKeys(connectedProjects));

    return Object.keys(process.env)
        .filter(
            (key) =>
                requiredKeys.has(key) ||
                optionalKeys.has(key) ||
                optionalProteumEnvVariablePrefixes.some((prefix) => key.startsWith(prefix)),
        )
        .sort((left, right) => left.localeCompare(right));
};

export const inspectProteumEnv = (
    appDir: string,
    rawConnectedProjects: TConnectedProjectsConfig = {},
): TProteumEnvInspection => {
    loadOptionalProteumDotenv(appDir);

    const connectedProjects = normalizeConnectedProjectsConfig(rawConnectedProjects);
    const requiredVariables = buildRequiredEnvVariableDefinitions(connectedProjects);

    return {
        loadedVariableKeys: getLoadedProteumEnvVariableKeys(connectedProjects),
        requiredVariables: requiredVariables.map((definition) => ({
            key: definition.key,
            possibleValues: [...definition.possibleValues],
            provided: isProvidedEnvValue(process.env[definition.key]),
        })),
    };
};

export const parseProteumEnvConfig = ({
    appDir,
    connectedProjects: rawConnectedProjects = {},
    routerPortOverride,
}: {
    appDir: string;
    connectedProjects?: TConnectedProjectsConfig;
    routerPortOverride?: number;
}): TProteumEnvConfig => {
    loadOptionalProteumDotenv(appDir);

    const connectedProjects = normalizeConnectedProjectsConfig(rawConnectedProjects);
    const context = { appDir, connectedProjects } satisfies TEnvContext;

    const name = parseEnvName(getRequiredEnvValue({ key: 'ENV_NAME', context }), context);
    const profile = parseEnvProfile(getRequiredEnvValue({ key: 'ENV_PROFILE', context }), context);
    const configuredRouterPort = parseIntegerEnvValue({
        key: 'PORT',
        value: getRequiredEnvValue({ key: 'PORT', context }),
        context,
    });
    const currentDomain = parseAbsoluteUrl({
        key: 'URL',
        value: getRequiredEnvValue({ key: 'URL', context }),
        context,
    });
    const internalUrl = parseAbsoluteUrl({
        key: 'URL_INTERNAL',
        value: getRequiredEnvValue({ key: 'URL_INTERNAL', context }),
        context,
    });

    const traceEnable = parseBooleanEnvValue({
        key: 'TRACE_ENABLE',
        value: process.env.TRACE_ENABLE,
        context,
    });
    const profilerEnable = parseBooleanEnvValue({
        key: 'ENABLE_PROFILER',
        value: process.env.ENABLE_PROFILER,
        context,
    });
    const tracePersistOnError = parseBooleanEnvValue({
        key: 'TRACE_PERSIST_ON_ERROR',
        value: process.env.TRACE_PERSIST_ON_ERROR,
        context,
    });
    const traceRequestsLimit = process.env.TRACE_REQUESTS_LIMIT?.trim();
    const traceEventsLimit = process.env.TRACE_EVENTS_LIMIT?.trim();
    const traceCapture = parseTraceCapture({
        value: process.env.TRACE_CAPTURE?.trim(),
        context,
    });

    const resolvedConnectedProjects = Object.fromEntries(
        Object.entries(connectedProjects)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([namespace, config]) => {
                const urlInternal = parseConnectedProjectAbsoluteUrl({
                    appDir,
                    namespace,
                    field: 'urlInternal',
                    value: getRequiredConnectedConfigValue({
                        appDir,
                        namespace,
                        field: 'urlInternal',
                        value: config.urlInternal,
                    }),
                });

                return [
                    namespace,
                    {
                        namespace,
                        urlInternal,
                    } satisfies TProteumConnectedProjectEnvConfig,
                ];
            }),
    );

    return {
        name,
        profile,
        router: {
            port: routerPortOverride === undefined ? configuredRouterPort : routerPortOverride,
            currentDomain,
            internalUrl,
        },
        connectedProjects: resolvedConnectedProjects,
        trace: {
            enable: traceEnable ?? profile === 'dev',
            profilerEnable: profilerEnable ?? false,
            requestsLimit:
                traceRequestsLimit === undefined || traceRequestsLimit === ''
                    ? 200
                    : parseIntegerEnvValue({
                          key: 'TRACE_REQUESTS_LIMIT',
                          value: traceRequestsLimit,
                          context,
                      }),
            eventsLimit:
                traceEventsLimit === undefined || traceEventsLimit === ''
                    ? 800
                    : parseIntegerEnvValue({
                          key: 'TRACE_EVENTS_LIMIT',
                          value: traceEventsLimit,
                          context,
                      }),
            capture: traceCapture ?? 'resolve',
            persistOnError: tracePersistOnError ?? profile === 'dev',
        },
    };
};
