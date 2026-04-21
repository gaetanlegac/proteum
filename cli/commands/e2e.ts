import { spawn } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import type { TDevSessionErrorResponse, TDevSessionStartResponse } from '../../common/dev/session';

type TPlaywrightInvocation = {
    command: string;
    args: string[];
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const getRouterPortFromManifest = () => {
    const manifestFilepath = path.join(cli.args.workdir as string, '.proteum', 'manifest.json');
    if (!fs.existsSync(manifestFilepath)) return undefined;

    const manifest = fs.readJsonSync(manifestFilepath, { throws: false }) as
        | { env?: { resolved?: { routerPort?: number } } }
        | undefined;
    const port = manifest?.env?.resolved?.routerPort;

    if (typeof port !== 'number' || port <= 0) return undefined;

    return String(port);
};

const getRouterPort = () => {
    const overridePort = typeof cli.args.port === 'string' && cli.args.port ? cli.args.port : '';
    if (overridePort) return overridePort;

    const manifestPort = getRouterPortFromManifest();
    if (manifestPort) return manifestPort;

    return '';
};

const getBaseUrlCandidates = () => {
    const explicitUrl = typeof cli.args.url === 'string' && cli.args.url ? cli.args.url.trim() : '';
    if (explicitUrl) return [normalizeBaseUrl(explicitUrl)];

    const port = getRouterPort();
    if (!port) return [];

    return [...new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`])];
};

const getSessionErrorMessage = (body: TDevSessionErrorResponse | object | string | undefined, statusCode: number) => {
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
    }

    return `Session request failed with status ${statusCode}.`;
};

const hasStructuredSessionError = (body: TDevSessionErrorResponse | object | string | undefined): body is TDevSessionErrorResponse =>
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string';

const requestSession = async ({ email, role }: { email: string; role: string }) => {
    const attempts: string[] = [];

    for (const baseUrl of getBaseUrlCandidates()) {
        try {
            const response = await got(`${baseUrl}/__proteum/session/start`, {
                method: 'POST',
                json: role ? { email, role } : { email },
                responseType: 'json',
                throwHttpErrors: false,
                retry: { limit: 0 },
            });

            if (response.statusCode >= 400) {
                if (response.statusCode === 404 && !hasStructuredSessionError(response.body as TDevSessionErrorResponse | object | string | undefined)) {
                    attempts.push(`${baseUrl}/__proteum/session/start: returned 404`);
                    continue;
                }

                throw new UsageError(
                    getSessionErrorMessage(response.body as TDevSessionErrorResponse | object | string | undefined, response.statusCode),
                );
            }

            return {
                baseUrl,
                token: (response.body as TDevSessionStartResponse).session.token,
            };
        } catch (error) {
            if (error instanceof UsageError) throw error;

            const message = error instanceof Error ? error.message : String(error);
            attempts.push(`${baseUrl}/__proteum/session/start: ${message}`);
        }
    }

    throw new UsageError(
        [
            'Could not reach the Proteum session server.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Start the app with `proteum dev`, then pass --port or --url to `proteum e2e`.',
        ].join('\n'),
    );
};

const resolveBaseUrl = (sessionBaseUrl?: string) => {
    if (sessionBaseUrl) return sessionBaseUrl;

    const [baseUrl] = getBaseUrlCandidates();
    if (baseUrl) return baseUrl;

    throw new UsageError('Could not determine E2E_BASE_URL. Pass --port or --url to `proteum e2e`.');
};

const parseEnvPair = (value: string) => {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex <= 0) {
        throw new UsageError(`Invalid --env value "${value}". Expected KEY=value.`);
    }

    const key = value.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new UsageError(`Invalid --env key "${key}".`);
    }

    return { key, value: value.slice(separatorIndex + 1) };
};

const readEnvFiles = (filepaths: string[]) => {
    const env: Record<string, string> = {};

    for (const filepath of filepaths) {
        const absoluteFilepath = path.resolve(cli.args.workdir as string, filepath);

        if (!fs.existsSync(absoluteFilepath)) {
            throw new UsageError(`Env file does not exist: ${absoluteFilepath}`);
        }

        Object.assign(env, dotenv.parse(fs.readFileSync(absoluteFilepath)));
    }

    return env;
};

const resolvePlaywrightInvocation = (appRoot: string): TPlaywrightInvocation => {
    const binaryName = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
    const localBinary = path.join(appRoot, 'node_modules', '.bin', binaryName);

    if (fs.existsSync(localBinary)) {
        return { command: localBinary, args: ['test'] };
    }

    return { command: 'npx', args: ['playwright', 'test'] };
};

const runPlaywright = async ({ env, playwrightArgs }: { env: Record<string, string>; playwrightArgs: string[] }) => {
    const appRoot = cli.args.workdir as string;
    const invocation = resolvePlaywrightInvocation(appRoot);

    return await new Promise<number | null>((resolve, reject) => {
        const child = spawn(invocation.command, [...invocation.args, ...playwrightArgs], {
            cwd: appRoot,
            env: {
                ...process.env,
                ...env,
            },
            stdio: 'inherit',
        });

        child.once('error', reject);
        child.once('close', (exitCode) => resolve(exitCode));
    });
};

export const run = async () => {
    const sessionEmail = typeof cli.args.sessionEmail === 'string' ? cli.args.sessionEmail.trim() : '';
    const sessionRole = typeof cli.args.sessionRole === 'string' ? cli.args.sessionRole.trim() : '';
    const envFilepaths = Array.isArray(cli.args.envFile) ? cli.args.envFile : [];
    const envPairs = Array.isArray(cli.args.env) ? cli.args.env : [];
    const playwrightArgs = Array.isArray(cli.args.playwrightArgs) ? cli.args.playwrightArgs : [];
    const explicitPort = getRouterPort();

    const explicitEnv = readEnvFiles(envFilepaths);
    for (const pair of envPairs) {
        const parsed = parseEnvPair(pair);
        explicitEnv[parsed.key] = parsed.value;
    }

    const session = sessionEmail ? await requestSession({ email: sessionEmail, role: sessionRole }) : undefined;
    const baseUrl = resolveBaseUrl(session?.baseUrl);
    const exitCode = await runPlaywright({
        env: {
            ...explicitEnv,
            E2E_BASE_URL: baseUrl,
            ...(explicitPort ? { E2E_PORT: explicitPort } : {}),
            ...(session?.token ? { E2E_AUTH_TOKEN: session.token } : {}),
        },
        playwrightArgs,
    });

    return exitCode ?? 1;
};
