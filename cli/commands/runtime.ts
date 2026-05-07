import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { listDevSessionInspections, writeMachineDevSessionRecord, type TDevSessionInspection } from '../runtime/devSessions';
import { printAgentResponse, printJson, quoteCommandArgument } from '../utils/agentOutput';
import type { TDoctorResponse } from '@common/dev/diagnostics';
import type { TProteumManifest } from '@common/dev/proteumManifest';

type TRuntimeAction = 'status';

const allowedActions = new Set<TRuntimeAction>(['status']);

const getAction = () => {
    const action = typeof cli.args.action === 'string' && cli.args.action ? cli.args.action : 'status';
    if (!allowedActions.has(action as TRuntimeAction)) {
        throw new UsageError(`Unsupported runtime action "${action}". Expected one of: ${[...allowedActions].join(', ')}.`);
    }

    return action as TRuntimeAction;
};

const readManifestIfAvailable = (): TProteumManifest | undefined => {
    const manifestFilepath = path.join(cli.paths.appRoot, '.proteum', 'manifest.json');
    if (!fs.existsSync(manifestFilepath)) return undefined;

    try {
        return readProteumManifest(cli.paths.appRoot);
    } catch {
        return undefined;
    }
};

const getSessionUrl = (inspection: TDevSessionInspection) => {
    if (!inspection.record) return '';
    if (inspection.record.publicUrl) return inspection.record.publicUrl.replace(/\/+$/, '');
    return `http://localhost:${inspection.record.routerPort}`;
};

const getSessionMcpUrl = (inspection: TDevSessionInspection) => {
    const sessionUrl = getSessionUrl(inspection);
    return sessionUrl ? `${sessionUrl}/__proteum/mcp` : '';
};

const probeDoctor = async (baseUrl: string) => {
    if (!baseUrl) return { reachable: false, error: 'No dev URL is registered.' };

    try {
        const response = await got(`${baseUrl}/__proteum/doctor`, {
            responseType: 'json',
            retry: { limit: 0 },
            throwHttpErrors: false,
            timeout: { request: 1200 },
        });

        if (response.statusCode >= 400) {
            return { reachable: false, statusCode: response.statusCode, error: `Doctor returned HTTP ${response.statusCode}.` };
        }

        const doctor = response.body as TDoctorResponse;
        return {
            reachable: true,
            statusCode: response.statusCode,
            doctor: doctor.summary,
        };
    } catch (error) {
        return {
            reachable: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
};

const compactSession = (inspection: TDevSessionInspection) => ({
    sessionFilePath: inspection.sessionFilePath,
    live: inspection.live,
    stale: inspection.stale,
    invalid: inspection.invalid,
    parseError: inspection.parseError,
    pid: inspection.record?.pid,
    routerPort: inspection.record?.routerPort,
    publicUrl: inspection.record?.publicUrl,
    mcpUrl: inspection.record ? getSessionMcpUrl(inspection) : undefined,
    state: inspection.record?.state,
    startedAt: inspection.record?.startedAt,
    updatedAt: inspection.record?.updatedAt,
});

const getNextActions = ({
    health,
    selectedSession,
}: {
    health: { reachable: boolean };
    selectedSession: TDevSessionInspection | undefined;
}) => {
    if (!selectedSession?.record || !selectedSession.live) {
        return [
            {
                label: 'Start Dev',
                command: 'proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>',
                reason: 'Create a tracked dev session before request-time diagnostics.',
            },
        ];
    }

    if (!health.reachable) {
        return [
            {
                label: 'Stop Unreachable Dev',
                command: `proteum dev stop --session-file ${quoteCommandArgument(selectedSession.sessionFilePath)}`,
                reason: 'A tracked session exists but the runtime and MCP endpoint are unreachable.',
            },
            {
                label: 'Start Dev',
                command: 'proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>',
                reason: 'Start a fresh tracked session after stopping the unreachable one.',
            },
        ];
    }

    return [
        {
            label: 'Diagnose Root',
            command: `proteum diagnose ${quoteCommandArgument('/')} --port ${selectedSession.record.routerPort}`,
            reason: 'Use the selected runtime for the smallest request-level diagnostic pass.',
        },
    ];
};

export const run = async () => {
    const action = getAction();
    if (action !== 'status') return;

    const manifest = readManifestIfAvailable();
    const sessions = await listDevSessionInspections({
        appRoot: cli.paths.appRoot,
        sessionFilePath: typeof cli.args.sessionFile === 'string' && cli.args.sessionFile ? cli.args.sessionFile : undefined,
    });
    const liveSessions = sessions.filter((inspection) => inspection.live && inspection.record);
    await Promise.allSettled(
        liveSessions.map((inspection) =>
            inspection.record ? writeMachineDevSessionRecord(inspection.record) : Promise.resolve(undefined),
        ),
    );
    const selectedSession =
        liveSessions.find((inspection) => inspection.record?.state === 'ready') || liveSessions[0] || sessions.find((inspection) => inspection.record);
    const selectedBaseUrl = selectedSession ? getSessionUrl(selectedSession) : '';
    const health = selectedSession && selectedSession.live ? await probeDoctor(selectedBaseUrl) : { reachable: false, error: 'No live tracked dev session.' };

    const payload = {
        appRoot: cli.paths.appRoot,
        manifest: manifest
            ? {
                  identifier: manifest.app.identity.identifier,
                  name: manifest.app.identity.name,
                  routerPort: manifest.env.resolved.routerPort,
                  diagnostics: {
                      errors: manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error').length,
                      warnings: manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length,
                  },
                  counts: {
                      connectedProjects: manifest.connectedProjects.length,
                      controllers: manifest.controllers.length,
                      routes: manifest.routes.client.length + manifest.routes.server.length,
                  },
              }
            : undefined,
        selected: selectedSession ? compactSession(selectedSession) : undefined,
        sessions: sessions.map(compactSession),
        health,
    };

    if (cli.args.full === true) {
        printJson(payload);
        return;
    }

    printAgentResponse({
        summary: selectedSession
            ? `${selectedSession.live ? 'live' : 'stale'} dev session on ${selectedSession.record?.routerPort || 'unknown port'}; health=${health.reachable ? 'reachable' : 'unreachable'}`
            : 'No tracked Proteum dev session found.',
        data: payload,
        nextActions: getNextActions({ health, selectedSession }),
        fullDetailCommand: 'proteum runtime status --full',
    });
};
