import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import got from 'got';
import { UsageError } from 'clipanion';

import cli from '..';

type TVerifyAppResult = {
    appRoot: string;
    baseUrl: string;
    contracts: { errors: number; warnings: number };
    doctor: { errors: number; warnings: number };
    explain: { commands: number; controllers: number; routes: number };
    name: string;
    page: { statusCode: number; url: string };
    startup: 'reused' | 'spawned';
};

type TVerifyResult = {
    action: string;
    apps: TVerifyAppResult[];
};

type TEnsureServerResult =
    | { baseUrl: string; startup: 'reused' }
    | { baseUrl: string; close: () => void; startup: 'spawned' };

const defaultApps = {
    crosspath: '/Users/gaetan/Desktop/Projets/crosspath/platform',
    uniqueDomains: '/Users/gaetan/Desktop/Projets/unique.domains/website',
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dedupe = <TValue>(values: TValue[]) => [...new Set(values)];
const getBaseUrlCandidates = (port: number) => dedupe([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);

const fetchJson = async <TResponse>(baseUrl: string, pathname: string) => {
    const response = await got(`${normalizeBaseUrl(baseUrl)}${pathname}`, {
        responseType: 'json',
        retry: { limit: 0 },
        throwHttpErrors: false,
    });

    if (response.statusCode >= 400) throw new UsageError(`Request ${pathname} failed with status ${response.statusCode}.`);
    return response.body as TResponse;
};

const waitForServer = async (baseUrls: string[], timeoutMs = 120000) => {
    const startedAt = Date.now();
    let lastError: string | undefined;

    while (Date.now() - startedAt < timeoutMs) {
        for (const baseUrl of baseUrls) {
            try {
                await fetchJson(baseUrl, '/__proteum/explain?section=app');
                return baseUrl;
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
        }

        await sleep(1000);
    }

    throw new UsageError(
        `Timed out while waiting for ${baseUrls.join(', ')} to expose Proteum dev diagnostics.${lastError ? ` Last error: ${lastError}` : ''}`,
    );
};

const ensureServer = async ({
    appRoot,
    port,
}: {
    appRoot: string;
    port: number;
}): Promise<TEnsureServerResult> => {
    const baseUrls = getBaseUrlCandidates(port);

    for (const baseUrl of baseUrls) {
        try {
            await fetchJson(baseUrl, '/__proteum/explain?section=app');
            return { baseUrl, startup: 'reused' as const };
        } catch (_error) {}
    }

    const cliBin = path.join(cli.paths.core.root, 'cli', 'bin.js');
    const child = spawn(process.execPath, [cliBin, 'dev', '--no-cache', '--port', String(port)], {
        cwd: appRoot,
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'ignore'],
    });

    const close = () => {
        if (!child.killed) child.kill('SIGTERM');
    };

    try {
        const baseUrl = await waitForServer(baseUrls);
        return { baseUrl, close, startup: 'spawned' as const };
    } catch (error) {
        close();
        throw error;
    }
};

const renderHuman = (result: TVerifyResult) =>
    [
        `Proteum verify ${result.action}`,
        ...result.apps.flatMap((app) => [
            '',
            `${app.name}`,
            `- root=${app.appRoot}`,
            `- baseUrl=${app.baseUrl}`,
            `- startup=${app.startup}`,
            `- page=${app.page.statusCode} ${app.page.url}`,
            `- explain routes=${app.explain.routes} controllers=${app.explain.controllers} commands=${app.explain.commands}`,
            `- doctor errors=${app.doctor.errors} warnings=${app.doctor.warnings}`,
            `- contracts errors=${app.contracts.errors} warnings=${app.contracts.warnings}`,
        ]),
    ].join('\n');

export const run = async () => {
    const action = typeof cli.args.action === 'string' && cli.args.action ? cli.args.action : 'framework-change';
    if (action !== 'framework-change') throw new UsageError(`Unsupported verify action "${action}".`);

    const route = typeof cli.args.route === 'string' && cli.args.route ? cli.args.route : '/';
    const apps = [
        {
            appRoot: (typeof cli.args.crosspath === 'string' && cli.args.crosspath) || defaultApps.crosspath,
            name: 'CrossPath',
            port: Number((typeof cli.args.crosspathPort === 'string' && cli.args.crosspathPort) || 3011),
        },
        {
            appRoot: (typeof cli.args.uniqueDomains === 'string' && cli.args.uniqueDomains) || defaultApps.uniqueDomains,
            name: 'Unique Domains',
            port: Number((typeof cli.args.uniqueDomainsPort === 'string' && cli.args.uniqueDomainsPort) || 3021),
        },
    ];

    const startedServers: Array<() => void> = [];

    try {
        const results: TVerifyAppResult[] = [];

        for (const app of apps) {
            if (!fs.existsSync(app.appRoot)) {
                throw new UsageError(`Reference app "${app.name}" was not found at ${app.appRoot}.`);
            }

            const server = await ensureServer({ appRoot: app.appRoot, port: app.port });
            if (server.startup === 'spawned') startedServers.push(server.close);

            const explain = await fetchJson<{
                controllers?: unknown[];
                routes?: { client?: unknown[]; server?: unknown[] };
                commands?: unknown[];
            }>(server.baseUrl, '/__proteum/explain');
            const doctor = await fetchJson<{ summary: { errors: number; warnings: number } }>(server.baseUrl, '/__proteum/doctor');
            const contracts = await fetchJson<{ summary: { errors: number; warnings: number } }>(
                server.baseUrl,
                '/__proteum/doctor/contracts',
            );
            const pageResponse = await got(`${server.baseUrl}${route}`, {
                followRedirect: false,
                retry: { limit: 0 },
                throwHttpErrors: false,
            });

            results.push({
                appRoot: app.appRoot,
                baseUrl: server.baseUrl,
                contracts: contracts.summary,
                doctor: doctor.summary,
                explain: {
                    commands: Array.isArray(explain.commands) ? explain.commands.length : 0,
                    controllers: Array.isArray(explain.controllers) ? explain.controllers.length : 0,
                    routes:
                        (Array.isArray(explain.routes?.client) ? explain.routes.client.length : 0) +
                        (Array.isArray(explain.routes?.server) ? explain.routes.server.length : 0),
                },
                name: app.name,
                page: { statusCode: pageResponse.statusCode, url: `${server.baseUrl}${route}` },
                startup: server.startup,
            });
        }

        const result = { action, apps: results } satisfies TVerifyResult;

        if (cli.args.json === true) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        console.log(renderHuman(result));
    } finally {
        for (const close of startedServers.reverse()) close();
    }
};
