import got from 'got';
import path from 'path';
import { spawn } from 'child_process';
import { UsageError } from 'clipanion';

import cli from '..';
import app from '../app';
import {
    normalizeDevCommandPath,
    type TDevCommandErrorResponse,
    type TDevCommandExecution,
    type TDevCommandRunResponse,
} from '../../common/dev/commands';

const localCommandResultMarker = '__PROTEUM_COMMAND_RESULT__';

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

const getCommandErrorMessage = (body: TDevCommandErrorResponse | object | string | undefined, statusCode: number) => {
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
    }

    return `Command request failed with status ${statusCode}.`;
};

const hasStructuredCommandError = (body: TDevCommandErrorResponse | object | string | undefined): body is TDevCommandErrorResponse =>
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string';

const requestJson = async <TResponse>(pathname: string, options?: { method?: 'GET' | 'POST'; json?: object }) => {
    const attempts: string[] = [];

    for (const baseUrl of getRouterBaseUrls()) {
        try {
            const response = await got(`${baseUrl}${pathname}`, {
                method: options?.method || 'GET',
                json: options?.json,
                responseType: 'json',
                throwHttpErrors: false,
                retry: { limit: 0 },
            });

            if (response.statusCode >= 400) {
                if (response.statusCode === 404 && !hasStructuredCommandError(response.body as TDevCommandErrorResponse | object | string | undefined)) {
                    attempts.push(`${baseUrl}${pathname}: returned 404`);
                    continue;
                }

                throw new UsageError(
                    getCommandErrorMessage(response.body as TDevCommandErrorResponse | object | string | undefined, response.statusCode),
                );
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
            'Could not reach the Proteum command server.',
            ...attempts.map((attempt) => `- ${attempt}`),
            'Make sure the app is running with `proteum dev`, or omit --port/--url to run the command locally.',
        ].join('\n'),
    );
};

const printJson = (value: object) => {
    console.log(JSON.stringify(value, null, 2));
};

const renderExecution = (execution: TDevCommandExecution) => {
    const lines = [
        `Command ${execution.command.path}`,
        `- status=${execution.status} durationMs=${execution.durationMs}`,
        `- source=${execution.command.filepath}:${execution.command.sourceLocation.line}:${execution.command.sourceLocation.column}`,
    ];

    if (execution.errorMessage) {
        lines.push(`- error=${execution.errorMessage}`);
    } else if (execution.result?.json !== undefined) {
        lines.push('Result');
        lines.push(JSON.stringify(execution.result.json, null, 2));
    } else if (execution.result?.summary !== undefined) {
        lines.push('Result');
        lines.push(JSON.stringify(execution.result.summary, null, 2));
    } else {
        lines.push('- result=undefined');
    }

    return lines.join('\n');
};

const runLocalCommand = async (commandPath: string) => {
    if (app.env.profile !== 'dev') {
        throw new UsageError(`Proteum commands are only available when ENV_PROFILE=dev. Current profile: ${app.env.profile}.`);
    }

    const runnerFilepath = path.join(cli.paths.core.root, 'cli', 'commands', 'commandLocalRunner.js');

    return await new Promise<TDevCommandExecution>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const child = spawn(process.execPath, [runnerFilepath, app.paths.root, commandPath], {
            cwd: app.paths.root,
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
        child.on('close', (exitCode) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            const markerLine = stdout
                .split(/\r?\n/)
                .find((line) => line.startsWith(localCommandResultMarker));

            if (stderr.trim()) {
                process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
            }

            if (!markerLine) {
                reject(
                    new Error(
                        [
                            `Local command runner exited without returning a structured result (exit code ${exitCode ?? 'unknown'}).`,
                            stdout.trim() ? `stdout:\n${stdout.trim()}` : undefined,
                        ]
                            .filter(Boolean)
                            .join('\n\n'),
                    ),
                );
                return;
            }

            const payload = JSON.parse(markerLine.slice(localCommandResultMarker.length)) as
                | { execution: TDevCommandExecution }
                | { error: string };

            if ('execution' in payload) {
                if (exitCode && exitCode !== 0) {
                    const error = new Error(payload.execution.errorMessage || `Command "${commandPath}" failed.`) as Error & {
                        execution?: TDevCommandExecution;
                    };

                    error.execution = payload.execution;
                    reject(error);
                    return;
                }

                resolve(payload.execution);
                return;
            }

            reject(new Error(payload.error || `Command "${commandPath}" failed.`));
        });
    });
};

export const run = async () => {
    const rawPath = typeof cli.args.path === 'string' ? cli.args.path : '';
    const commandPath = normalizeDevCommandPath(rawPath);
    const shouldPrintJson = cli.args.json === true;
    const shouldUseRemoteServer =
        (typeof cli.args.port === 'string' && cli.args.port.length > 0) ||
        (typeof cli.args.url === 'string' && cli.args.url.length > 0);

    if (!commandPath) {
        throw new UsageError('A command path is required. Example: proteum command diagnostics/ping');
    }

    try {
        const execution = shouldUseRemoteServer
            ? (await requestJson<TDevCommandRunResponse>('/__proteum/commands/run', {
                  method: 'POST',
                  json: { path: commandPath },
              })).execution
            : await runLocalCommand(commandPath);

        if (shouldPrintJson) {
            printJson({ execution });
            return;
        }

        console.log(renderExecution(execution));
    } catch (error) {
        if (error instanceof Error && 'execution' in error && typeof error.execution === 'object' && error.execution) {
            const execution = error.execution as TDevCommandExecution;

            if (shouldPrintJson) {
                printJson({ execution });
            } else {
                console.log(renderExecution(execution));
            }

            process.exitCode = 1;
            return;
        }

        throw error;
    }
};
