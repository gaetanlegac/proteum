import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export type TProteumEnvName = 'local' | 'server';
export type TProteumEnvProfile = 'dev' | 'testing' | 'prod';
export type TProteumTraceCapture = 'summary' | 'resolve' | 'deep';
export type TProteumRequiredEnvVariable = {
    key: TProteumRequiredEnvVariableKey;
    possibleValues: string[];
    provided: boolean;
};
export type TProteumEnvInspection = {
    loadedVariableKeys: string[];
    requiredVariables: TProteumRequiredEnvVariable[];
};

export type TProteumEnvConfig = {
    name: TProteumEnvName;
    profile: TProteumEnvProfile;
    router: {
        port: number;
        currentDomain: string;
    };
    trace: {
        enable: boolean;
        requestsLimit: number;
        eventsLimit: number;
        capture: TProteumTraceCapture;
        persistOnError: boolean;
    };
};

export type TProteumLoadedEnvConfig = TProteumEnvConfig & { version: string };

const dotenvFileNames = ['.env'];
const requiredProteumEnvVariableKeys = ['ENV_NAME', 'ENV_PROFILE', 'PORT', 'URL'] as const;
const optionalProteumEnvVariablePrefixes = ['TRACE_'] as const;

export type TProteumRequiredEnvVariableKey = (typeof requiredProteumEnvVariableKeys)[number];

const requiredProteumEnvVariablePossibleValues: Record<TProteumRequiredEnvVariableKey, string[]> = {
    ENV_NAME: ['local', 'server'],
    ENV_PROFILE: ['dev', 'testing', 'prod'],
    PORT: ['integer between 1 and 65535'],
    URL: ['absolute URL'],
};

const envDefinitionHint = (appDir: string) => `Define it in process.env or ${appDir}/.env.`;
const isProvidedEnvValue = (value: string | undefined) => typeof value === 'string' && value.trim() !== '';

const formatRequiredEnvVariableStatus = (variable: TProteumRequiredEnvVariable) =>
    `- ${variable.key} possibleValues=${variable.possibleValues.join(' | ')} provided=${variable.provided ? 'yes' : 'no'}`;

const createProteumEnvError = ({
    appDir,
    message,
}: {
    appDir: string;
    message: string;
}) => {
    const inspection = inspectProteumEnv(appDir);

    return new Error(
        [message, envDefinitionHint(appDir), '', 'Required env variables:', ...inspection.requiredVariables.map(formatRequiredEnvVariableStatus)].join(
            '\n',
        ),
    );
};

const parseBooleanEnvValue = ({
    key,
    value,
    appDir,
}: {
    key: string;
    value: string | undefined;
    appDir: string;
}) => {
    if (value === undefined || value === '') return undefined;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

    throw createProteumEnvError({
        appDir,
        message: `Invalid boolean value for ${key}: "${value}". Expected one of: 1, 0, true, false, yes, no, on, off.`,
    });
};

const parseIntegerEnvValue = ({
    key,
    value,
    appDir,
    min = 1,
}: {
    key: string;
    value: string;
    appDir: string;
    min?: number;
}) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < min) {
        throw createProteumEnvError({
            appDir,
            message: `Invalid integer value for ${key}: "${value}". Expected an integer greater than or equal to ${min}.`,
        });
    }

    return parsed;
};

const getRequiredEnvValue = ({ key, appDir }: { key: TProteumRequiredEnvVariableKey; appDir: string }) => {
    const value = process.env[key]?.trim();
    if (value) return value;

    throw createProteumEnvError({
        appDir,
        message: `Missing required Proteum env variable "${key}".`,
    });
};

const parseEnvName = (value: string, appDir: string): TProteumEnvName => {
    if (value === 'local' || value === 'server') return value;
    throw createProteumEnvError({
        appDir,
        message: `Invalid ENV_NAME "${value}". Expected "local" or "server".`,
    });
};

const parseEnvProfile = (value: string, appDir: string): TProteumEnvProfile => {
    if (value === 'dev' || value === 'testing' || value === 'prod') return value;
    throw createProteumEnvError({
        appDir,
        message: `Invalid ENV_PROFILE "${value}". Expected "dev", "testing", or "prod".`,
    });
};

const parseTraceCapture = ({
    value,
    appDir,
}: {
    value: string | undefined;
    appDir: string;
}): TProteumTraceCapture | undefined => {
    if (value === undefined || value === '') return undefined;
    if (value === 'summary' || value === 'resolve' || value === 'deep') return value;

    throw createProteumEnvError({
        appDir,
        message: `Invalid TRACE_CAPTURE "${value}". Expected "summary", "resolve", or "deep".`,
    });
};

const parseAbsoluteUrl = ({
    key,
    value,
    appDir,
}: {
    key: string;
    value: string;
    appDir: string;
}) => {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw createProteumEnvError({
            appDir,
            message: `Invalid absolute URL for ${key}: "${value}". Expected an absolute http:// or https:// URL.`,
        });
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw createProteumEnvError({
            appDir,
            message: `Invalid absolute URL for ${key}: "${value}". Expected an absolute http:// or https:// URL.`,
        });
    }

    return value;
};

export const loadOptionalProteumDotenv = (appDir: string) => {
    for (const filename of dotenvFileNames) {
        const filepath = path.join(appDir, filename);
        if (!fs.existsSync(filepath)) continue;
        dotenv.config({ path: filepath, quiet: true });
    }
};

export const getLoadedProteumEnvVariableKeys = () =>
    Object.keys(process.env)
        .filter(
            (key) =>
                requiredProteumEnvVariableKeys.includes(key as TProteumRequiredEnvVariableKey) ||
                optionalProteumEnvVariablePrefixes.some((prefix) => key.startsWith(prefix)),
        )
        .sort((a, b) => a.localeCompare(b));

export const inspectProteumEnv = (appDir: string): TProteumEnvInspection => {
    loadOptionalProteumDotenv(appDir);

    return {
        loadedVariableKeys: getLoadedProteumEnvVariableKeys(),
        requiredVariables: requiredProteumEnvVariableKeys.map((key) => ({
            key,
            possibleValues: [...requiredProteumEnvVariablePossibleValues[key]],
            provided: isProvidedEnvValue(process.env[key]),
        })),
    };
};

export const parseProteumEnvConfig = ({
    appDir,
    routerPortOverride,
}: {
    appDir: string;
    routerPortOverride?: number;
}): TProteumEnvConfig => {
    loadOptionalProteumDotenv(appDir);

    const name = parseEnvName(getRequiredEnvValue({ key: 'ENV_NAME', appDir }), appDir);
    const profile = parseEnvProfile(getRequiredEnvValue({ key: 'ENV_PROFILE', appDir }), appDir);
    const configuredRouterPort = parseIntegerEnvValue({
        key: 'PORT',
        value: getRequiredEnvValue({ key: 'PORT', appDir }),
        appDir,
    });
    const currentDomain = parseAbsoluteUrl({
        key: 'URL',
        value: getRequiredEnvValue({ key: 'URL', appDir }),
        appDir,
    });

    const traceEnable = parseBooleanEnvValue({
        key: 'TRACE_ENABLE',
        value: process.env.TRACE_ENABLE,
        appDir,
    });
    const tracePersistOnError = parseBooleanEnvValue({
        key: 'TRACE_PERSIST_ON_ERROR',
        value: process.env.TRACE_PERSIST_ON_ERROR,
        appDir,
    });
    const traceRequestsLimit = process.env.TRACE_REQUESTS_LIMIT?.trim();
    const traceEventsLimit = process.env.TRACE_EVENTS_LIMIT?.trim();
    const traceCapture = parseTraceCapture({
        value: process.env.TRACE_CAPTURE?.trim(),
        appDir,
    });

    return {
        name,
        profile,
        router: {
            port: routerPortOverride === undefined ? configuredRouterPort : routerPortOverride,
            currentDomain,
        },
        trace: {
            enable: traceEnable ?? profile === 'dev',
            requestsLimit:
                traceRequestsLimit === undefined || traceRequestsLimit === ''
                    ? 200
                    : parseIntegerEnvValue({
                          key: 'TRACE_REQUESTS_LIMIT',
                          value: traceRequestsLimit,
                          appDir,
                      }),
            eventsLimit:
                traceEventsLimit === undefined || traceEventsLimit === ''
                    ? 800
                    : parseIntegerEnvValue({
                          key: 'TRACE_EVENTS_LIMIT',
                          value: traceEventsLimit,
                          appDir,
                      }),
            capture: traceCapture ?? 'resolve',
            persistOnError: tracePersistOnError ?? profile === 'dev',
        },
    };
};
