import got from 'got';
import path from 'path';
import fs from 'fs-extra';
import { UsageError } from 'clipanion';

import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildOrientationResponse, type TOrientResponse } from '@common/dev/inspection';
import type { TProteumManifest } from '@common/dev/proteumManifest';

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const dedupe = <TValue>(values: TValue[]) => [...new Set(values)];

const buildBaseUrlCandidates = (value: string) => {
    const normalized = normalizeBaseUrl(value);

    try {
        const parsed = new URL(normalized);
        const port = parsed.port;
        const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
        const search = parsed.search;
        const hash = parsed.hash;
        const buildUrl = (hostname: string) => `${parsed.protocol}//${hostname}${port ? `:${port}` : ''}${pathname}${search}${hash}`;

        if (parsed.hostname === '127.0.0.1') return dedupe([normalized, buildUrl('localhost'), buildUrl('[::1]')]);
        if (parsed.hostname === 'localhost') return dedupe([normalized, buildUrl('127.0.0.1'), buildUrl('[::1]')]);
        if (parsed.hostname === '[::1]' || parsed.hostname === '::1') return dedupe([normalized, buildUrl('localhost'), buildUrl('127.0.0.1')]);
    } catch (_error) {}

    return [normalized];
};

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
    if (explicitUrl) return buildBaseUrlCandidates(explicitUrl);

    const port = getRouterPort();
    return dedupe([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
};

const requestJson = async <TResponse>(pathname: string) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
        try {
            const response = await got(`${baseUrl}${pathname}`, {
                responseType: 'json',
                retry: { limit: 0 },
                throwHttpErrors: false,
            });

            if (response.statusCode >= 400) {
                const body = response.body as { error?: string } | undefined;
                throw new UsageError(body?.error || `Orient request failed with status ${response.statusCode}.`);
            }

            return response.body as TResponse;
        } catch (error) {
            if (error instanceof UsageError) throw error;
            attempts.push(`${baseUrl}${pathname}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw new UsageError(
        [
            'Could not reach the Proteum dev diagnostics server for orient.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Make sure the app is running with `proteum dev`, or omit --port/--url to read the local manifest from disk.',
        ].join('\n'),
    );
};

const resolveManifest = async (): Promise<TProteumManifest> => {
    const shouldUseRemoteServer =
        (typeof cli.args.port === 'string' && cli.args.port.length > 0) ||
        (typeof cli.args.url === 'string' && cli.args.url.length > 0);

    if (shouldUseRemoteServer) {
        return await requestJson<TProteumManifest>('/__proteum/explain');
    }

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();
    return readProteumManifest(cli.paths.appRoot);
};

const renderHuman = (response: TOrientResponse) =>
    [
        'Proteum orient',
        `- query=${response.query}`,
        `- appRoot=${response.app.appRoot}`,
        `- repoRoot=${response.app.repoRoot}`,
        `- identifier=${response.app.identifier}`,
        ...(response.app.routerPort ? [`- routerPort=${response.app.routerPort}`] : []),
        'Guidance',
        `- agents=${response.guidance.agents}`,
        `- diagnostics=${response.guidance.diagnostics}`,
        `- optimizations=${response.guidance.optimizations}`,
        `- codingStyle=${response.guidance.codingStyle}`,
        `- areaAgents=${response.guidance.areaAgents.join(', ') || 'none'}`,
        'Owner',
        ...(response.owner.matches.length === 0
            ? ['- none']
            : response.owner.matches.slice(0, 6).map(
                  (match) =>
                      `- [${match.kind}] ${match.label} score=${match.score} scope=${match.scopeLabel} origin=${match.originHint} source=${match.source.filepath}${match.source.line ? `:${match.source.line}` : ''}${match.source.column ? `:${match.source.column}` : ''}`,
              )),
        'Connected',
        ...(response.connected.imports.length === 0
            ? ['- imports=none']
            : response.connected.imports.map(
                  (entry) => `- import ${entry.namespace}.${entry.clientAccessor} -> ${entry.httpPath} source=${entry.filepath}`,
              )),
        ...(response.connected.producers.length === 0
            ? ['- producers=none']
            : response.connected.producers.map(
                  (project) =>
                      `- producer ${project.namespace} identifier=${project.identityIdentifier || project.identityName || 'unknown'} source=${project.sourceKind || 'missing'} internal=${project.urlInternal || 'missing'}`,
              )),
        'Next',
        ...response.nextSteps.map((step) => `- ${step.command} (${step.reason})`),
        'Warnings',
        ...(response.warnings.length === 0 ? ['- none'] : response.warnings.map((warning) => `- ${warning}`)),
    ].join('\n');

export const run = async () => {
    const query = typeof cli.args.query === 'string' ? cli.args.query.trim() : '';
    if (!query) throw new UsageError('A query is required. Example: proteum orient /api/Auth/CurrentUser');

    const manifest = await resolveManifest();
    const response = buildOrientationResponse(manifest, query);

    if (cli.args.json === true) {
        console.log(JSON.stringify(response, null, 2));
        return;
    }

    console.log(renderHuman(response));
};
