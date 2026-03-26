import got from 'got';
import path from 'path';
import { spawn } from 'child_process';
import { UsageError } from 'clipanion';

import cli from '..';
import type { TDevSessionErrorResponse, TDevSessionStartResponse } from '../../common/dev/session';

const localSessionResultMarker = '__PROTEUM_SESSION_RESULT__';

type TResolvedSessionOutput = {
    baseUrl: string;
    user: TDevSessionStartResponse['user'];
    session: TDevSessionStartResponse['session'];
    browserCookie: string;
    curlCookieHeader: string;
    playwright: {
        cookies: Array<{
            name: string;
            value: string;
            url: string;
            expires: number;
            httpOnly: boolean;
            secure: boolean;
            sameSite: 'Lax';
        }>;
    };
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const getRouterPortFromManifest = () => {
    const manifestFilepath = path.join(cli.args.workdir as string, '.proteum', 'manifest.json');
    if (!require('fs-extra').existsSync(manifestFilepath)) return undefined;

    const manifest = require('fs-extra').readJsonSync(manifestFilepath, { throws: false }) as
        | { env?: { resolved?: { routerPort?: number } } }
        | undefined;
    const port = manifest?.env?.resolved?.routerPort;

    if (typeof port !== 'number' || port <= 0) return undefined;

    return String(port);
};

const getRouterPort = () => {
    const overridePort = typeof cli.args.port === 'string' && cli.args.port ? cli.args.port : '';
    if (overridePort) return overridePort;

    const envPort = process.env.PORT?.trim();
    if (envPort) return envPort;

    const manifestPort = getRouterPortFromManifest();
    if (manifestPort) return manifestPort;

    throw new UsageError(
        `Could not determine the router port from PORT or .proteum/manifest.json in ${cli.args.workdir as string}. Pass --port or --url explicitly.`,
    );
};

const getRouterBaseUrls = () => {
    const explicitUrl = typeof cli.args.url === 'string' && cli.args.url ? cli.args.url.trim() : '';
    if (explicitUrl) return [normalizeBaseUrl(explicitUrl)];

    const port = getRouterPort();
    return [...new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`])];
};

const getSessionErrorMessage = (body: TDevSessionErrorResponse | object | string | undefined, statusCode: number) => {
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
    }

    return `Session request failed with status ${statusCode}.`;
};

const hasStructuredSessionError = (body: TDevSessionErrorResponse | object | string | undefined): body is TDevSessionErrorResponse =>
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string';

const requestSession = async (email: string, role: string) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
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
                response: response.body as TDevSessionStartResponse,
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
            'Make sure the app is running with `proteum dev`, or omit --port/--url to run the session request locally.',
        ].join('\n'),
    );
};

const buildSessionOutput = ({
    baseUrl,
    response,
}: {
    baseUrl: string;
    response: TDevSessionStartResponse;
}): TResolvedSessionOutput => {
    const expires = Math.floor(Date.parse(response.session.expiresAt) / 1000);
    const secure = new URL(baseUrl).protocol === 'https:';

    return {
        baseUrl,
        user: response.user,
        session: response.session,
        browserCookie: `${response.session.cookieName}=${response.session.token}; Path=/`,
        curlCookieHeader: `Cookie: ${response.session.cookieName}=${response.session.token}`,
        playwright: {
            cookies: [
                {
                    name: response.session.cookieName,
                    value: response.session.token,
                    url: baseUrl,
                    expires,
                    httpOnly: false,
                    secure,
                    sameSite: 'Lax',
                },
            ],
        },
    };
};

const printJson = (value: object) => {
    console.log(JSON.stringify(value, null, 2));
};

const renderSession = (value: TResolvedSessionOutput) =>
    [
        `Session ${value.user.email}`,
        `- baseUrl=${value.baseUrl}`,
        `- roles=${value.user.roles.join(',')}`,
        `- expiresAt=${value.session.expiresAt}`,
        'Token',
        value.session.token,
        'Playwright',
        JSON.stringify(value.playwright, null, 2),
        'Browser Cookie',
        value.browserCookie,
    ].join('\n');

const runLocalSession = async (email: string, role: string) => {
    const runnerFilepath = path.join(cli.paths.core.root, 'cli', 'commands', 'sessionLocalRunner.js');

    return await new Promise<{ baseUrl: string; response: TDevSessionStartResponse }>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const child = spawn(process.execPath, [runnerFilepath, cli.args.workdir as string, email, role], {
            cwd: cli.args.workdir as string,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (chunk: Buffer | string) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        child.on('error', (error) => reject(error));
        child.on('close', () => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            const markerLine = stdout
                .split(/\r?\n/)
                .find((line) => line.startsWith(localSessionResultMarker));

            if (stderr.trim()) {
                process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
            }

            if (!markerLine) {
                reject(
                    new Error(
                        ['Local session runner exited without returning a structured result.', stdout.trim() ? `stdout:\n${stdout.trim()}` : undefined]
                            .filter(Boolean)
                            .join('\n\n'),
                    ),
                );
                return;
            }

            const payload = JSON.parse(markerLine.slice(localSessionResultMarker.length)) as
                | { session: { baseUrl: string; response: TDevSessionStartResponse } }
                | { error: string };

            if ('session' in payload) {
                resolve(payload.session);
                return;
            }

            reject(new Error(payload.error || 'Session runner failed.'));
        });
    });
};

export const run = async () => {
    const email = typeof cli.args.email === 'string' ? cli.args.email.trim() : '';
    const role = typeof cli.args.role === 'string' ? cli.args.role.trim() : '';
    const shouldPrintJson = cli.args.json === true;
    const shouldUseRemoteServer =
        (typeof cli.args.port === 'string' && cli.args.port.length > 0) ||
        (typeof cli.args.url === 'string' && cli.args.url.length > 0);

    if (!email) {
        throw new UsageError('An email is required. Example: proteum session admin@example.com --role ADMIN');
    }

    const resolved = buildSessionOutput(
        shouldUseRemoteServer ? await requestSession(email, role) : await runLocalSession(email, role),
    );

    if (shouldPrintJson) {
        printJson(resolved);
        return;
    }

    console.log(renderSession(resolved));
};
