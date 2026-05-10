import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import {
    defaultDatabaseReadTimeoutMs,
    maxDatabaseReadLimit,
    maxDatabaseReadTimeoutMs,
    type TDatabaseReadQueryResponse,
} from '../../common/dev/database';
import { printAgentResponse, printJson, quoteCommandArgument } from '../utils/agentOutput';

type TDbAction = 'query';

const allowedActions = new Set<TDbAction>(['query']);
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

const parsePositiveInteger = (value: unknown, label: string, max: number) => {
    if (typeof value !== 'string' || !value.trim()) return undefined;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new UsageError(`${label} must be a positive integer.`);
    if (parsed > max) throw new UsageError(`${label} must be ${max} or lower.`);

    return parsed;
};

const requestJson = async <TResponse>(pathname: string, json: object) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
        try {
            const response = await got(`${baseUrl}${pathname}`, {
                method: 'POST',
                json,
                responseType: 'json',
                retry: { limit: 0 },
                throwHttpErrors: false,
            });

            if (response.statusCode >= 400) {
                const body = response.body as { error?: string } | undefined;
                throw new UsageError(body?.error || `Database query failed with status ${response.statusCode}.`);
            }

            return response.body as TResponse;
        } catch (error) {
            if (error instanceof UsageError) throw error;

            const message = error instanceof Error ? error.message : String(error);
            attempts.push(`${baseUrl}${pathname}: ${message}`);
        }
    }

    throw new UsageError(
        [
            'Could not reach the Proteum database diagnostics server.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Make sure the app is running with `proteum dev`, or pass `--url http://host:port` if it is bound elsewhere.',
        ].join('\n'),
    );
};

const buildFullCommand = (sql: string) =>
    [
        'proteum db query',
        quoteCommandArgument(sql),
        typeof cli.args.limit === 'string' && cli.args.limit ? `--limit ${cli.args.limit}` : '',
        typeof cli.args.timeout === 'string' && cli.args.timeout ? `--timeout ${cli.args.timeout}` : '',
        typeof cli.args.port === 'string' && cli.args.port ? `--port ${cli.args.port}` : '',
        typeof cli.args.url === 'string' && cli.args.url ? `--url ${quoteCommandArgument(cli.args.url)}` : '',
        '--full',
    ]
        .filter(Boolean)
        .join(' ');

export const run = async () => {
    const action = typeof cli.args.action === 'string' && cli.args.action ? cli.args.action : 'query';
    if (!allowedActions.has(action as TDbAction)) {
        throw new UsageError(`Unsupported db action "${action}". Expected: query.`);
    }

    const sql = typeof cli.args.sql === 'string' ? cli.args.sql.trim() : '';
    if (!sql) throw new UsageError('A SELECT, SHOW, or EXPLAIN SQL statement is required.');

    const limit = parsePositiveInteger(cli.args.limit, '--limit', maxDatabaseReadLimit);
    const timeoutMs = parsePositiveInteger(cli.args.timeout, '--timeout', maxDatabaseReadTimeoutMs);
    const response = await requestJson<TDatabaseReadQueryResponse>('/__proteum/db/query', {
        sql,
        ...(limit !== undefined ? { limit } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });

    if (cli.args.full === true) {
        printJson(response);
        return;
    }

    printAgentResponse({
        summary: `${response.kind.toUpperCase()} returned ${response.rows.length}/${response.rowCount} rows in ${response.elapsedMs} ms${response.limited ? ` (limited to ${response.limit})` : ''}.`,
        data: {
            kind: response.kind,
            elapsedMs: response.elapsedMs,
            rowCount: response.rowCount,
            returnedRowCount: response.rows.length,
            limit: response.limit,
            limited: response.limited,
            columns: response.columns,
            rows: response.rows,
        },
        fullDetailCommand: buildFullCommand(sql),
        omitted: response.limited
            ? [
                  {
                      reason: `Rows are capped at ${response.limit}. Raise --limit up to ${maxDatabaseReadLimit} or narrow the query for more detail.`,
                      command: `proteum db query ${quoteCommandArgument(sql)} --limit ${Math.min(response.limit * 2, maxDatabaseReadLimit)} --timeout ${timeoutMs || defaultDatabaseReadTimeoutMs}`,
                  },
              ]
            : undefined,
    });
};
