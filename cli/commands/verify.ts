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

type TVerifyAppConfig = {
    appRoot: string;
    envOverrides?: Record<string, string>;
    name: string;
    port: number;
    route: string;
};

const defaultApps = {
    crosspath: '/Users/gaetan/Desktop/Projets/crosspath/platform',
    product: '/Users/gaetan/Desktop/Projets/unique.domains/product',
    website: '/Users/gaetan/Desktop/Projets/unique.domains/website',
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dedupe = <TValue>(values: TValue[]) => [...new Set(values)];
const createLocalBaseUrl = (port: number) => `http://localhost:${port}`;
const getBaseUrlCandidates = (port: number) =>
    dedupe([createLocalBaseUrl(port), `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);

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
    envOverrides,
    port,
}: {
    appRoot: string;
    envOverrides?: Record<string, string>;
    port: number;
}): Promise<TEnsureServerResult> => {
    const baseUrls = getBaseUrlCandidates(port);

    for (const baseUrl of baseUrls) {
        try {
            await fetchJson(baseUrl, '/__proteum/explain?section=app');
            return { baseUrl, startup: 'reused' as const };
        } catch (_error) {}
    }

    const desiredBaseUrl = createLocalBaseUrl(port);
    const cliBin = path.join(cli.paths.core.root, 'cli', 'bin.js');
    const child = spawn(process.execPath, [cliBin, 'dev', '--no-cache', '--port', String(port)], {
        cwd: appRoot,
        env: {
            ...process.env,
            PORT: String(port),
            URL: desiredBaseUrl,
            URL_INTERNAL: desiredBaseUrl,
            ...(envOverrides || {}),
        },
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

const collectAppResult = async ({
    appRoot,
    baseUrl,
    name,
    route,
    startup,
}: {
    appRoot: string;
    baseUrl: string;
    name: string;
    route: string;
    startup: 'reused' | 'spawned';
}): Promise<TVerifyAppResult> => {
    const explain = await fetchJson<{
        controllers?: unknown[];
        routes?: { client?: unknown[]; server?: unknown[] };
        commands?: unknown[];
    }>(baseUrl, '/__proteum/explain');
    const doctor = await fetchJson<{ summary: { errors: number; warnings: number } }>(baseUrl, '/__proteum/doctor');
    const contracts = await fetchJson<{ summary: { errors: number; warnings: number } }>(baseUrl, '/__proteum/doctor/contracts');
    const pageResponse = await got(`${baseUrl}${route}`, {
        followRedirect: false,
        retry: { limit: 0 },
        throwHttpErrors: false,
    });

    return {
        appRoot,
        baseUrl,
        contracts: contracts.summary,
        doctor: doctor.summary,
        explain: {
            commands: Array.isArray(explain.commands) ? explain.commands.length : 0,
            controllers: Array.isArray(explain.controllers) ? explain.controllers.length : 0,
            routes:
                (Array.isArray(explain.routes?.client) ? explain.routes.client.length : 0) +
                (Array.isArray(explain.routes?.server) ? explain.routes.server.length : 0),
        },
        name,
        page: { statusCode: pageResponse.statusCode, url: `${baseUrl}${route}` },
        startup,
    };
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

    const websiteRoute = typeof cli.args.route === 'string' && cli.args.route ? cli.args.route : '/';
    const apps = {
        crosspath: {
            appRoot: (typeof cli.args.crosspath === 'string' && cli.args.crosspath) || defaultApps.crosspath,
            name: 'CrossPath',
            port: Number((typeof cli.args.crosspathPort === 'string' && cli.args.crosspathPort) || 3011),
            route: '/',
        } satisfies TVerifyAppConfig,
        product: {
            appRoot: (typeof cli.args.product === 'string' && cli.args.product) || defaultApps.product,
            name: 'Unique Domains Product',
            port: Number((typeof cli.args.productPort === 'string' && cli.args.productPort) || 3021),
            route: '/',
        } satisfies TVerifyAppConfig,
        website: {
            appRoot: (typeof cli.args.website === 'string' && cli.args.website) || defaultApps.website,
            name: 'Unique Domains Website',
            port: Number((typeof cli.args.websitePort === 'string' && cli.args.websitePort) || 3031),
            route: websiteRoute,
        } satisfies TVerifyAppConfig,
    };

    for (const app of Object.values(apps)) {
        if (!fs.existsSync(app.appRoot)) {
            throw new UsageError(`Reference app "${app.name}" was not found at ${app.appRoot}.`);
        }
    }

    const startedServers: Array<() => void> = [];

    try {
        const results: TVerifyAppResult[] = [];

        const productServer = await ensureServer({
            appRoot: apps.product.appRoot,
            port: apps.product.port,
        });
        if (productServer.startup === 'spawned') startedServers.push(productServer.close);

        const websiteServer = await ensureServer({
            appRoot: apps.website.appRoot,
            envOverrides: {
                PRODUCT_CONNECTED_SOURCE: `file:${apps.product.appRoot}`,
                PRODUCT_URL_INTERNAL: productServer.baseUrl,
            },
            port: apps.website.port,
        });
        if (websiteServer.startup === 'spawned') startedServers.push(websiteServer.close);

        const crosspathServer = await ensureServer({
            appRoot: apps.crosspath.appRoot,
            port: apps.crosspath.port,
        });
        if (crosspathServer.startup === 'spawned') startedServers.push(crosspathServer.close);

        results.push(
            await collectAppResult({
                ...apps.crosspath,
                baseUrl: crosspathServer.baseUrl,
                startup: crosspathServer.startup,
            }),
        );
        results.push(
            await collectAppResult({
                ...apps.product,
                baseUrl: productServer.baseUrl,
                startup: productServer.startup,
            }),
        );
        results.push(
            await collectAppResult({
                ...apps.website,
                baseUrl: websiteServer.baseUrl,
                startup: websiteServer.startup,
            }),
        );

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
