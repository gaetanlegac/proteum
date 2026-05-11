import cli from '..';
import { startProteumMachineMcpRouter, startProteumMachineMcpRouterHttp } from '../mcp/router';
import {
    ensureMachineMcpDaemonProcess,
    inspectMachineMcpDaemonRecord,
    resolveMachineMcpDaemonPort,
    stopMachineMcpDaemonProcess,
} from '../runtime/mcpDaemon';
import { renderMcpDaemonBanner } from '../presentation/mcp';

const printJson = (payload: unknown) => {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
};

const printStatus = async () => {
    const inspection = await inspectMachineMcpDaemonRecord({ cleanStale: true });

    if (cli.args.json === true) {
        printJson({
            daemon: inspection
                ? {
                      live: inspection.live,
                      stale: inspection.stale,
                      invalid: inspection.invalid,
                      parseError: inspection.parseError,
                      record: inspection.record,
                  }
                : null,
        });
        return;
    }

    if (!inspection?.record || !inspection.live) {
        console.info('No live Proteum machine MCP daemon found.');
        return;
    }

    console.info(
        [
            `Proteum machine MCP daemon is running.`,
            `pid ${inspection.record.pid}`,
            `mcp ${inspection.record.mcpUrl}`,
            `health ${inspection.record.healthUrl}`,
        ].join('\n'),
    );
};

const runDaemon = async () => {
    const existing = await inspectMachineMcpDaemonRecord({ cleanStale: true });

    if (existing?.record && existing.live && existing.record.pid !== process.pid) {
        if (cli.args.json === true) {
            printJson({ started: false, daemon: existing.record });
            return;
        }

        console.info(
            await renderMcpDaemonBanner({
                mcpUrl: existing.record.mcpUrl,
                pid: existing.record.pid,
                state: 'connected',
            }),
        );
        return;
    }

    const port = resolveMachineMcpDaemonPort(typeof cli.args.port === 'string' ? cli.args.port : undefined);
    const mcpUrl = `http://127.0.0.1:${port}/mcp`;
    const healthUrl = `http://127.0.0.1:${port}/health`;

    await startProteumMachineMcpRouterHttp({
        port,
        version: String(cli.packageJson.version || ''),
    });

    if (cli.args.json === true) {
        printJson({
            started: true,
            daemon: {
                pid: process.pid,
                mcpUrl,
                healthUrl,
            },
        });
    } else {
        console.info(
            await renderMcpDaemonBanner({
                mcpUrl,
                pid: process.pid,
                state: 'started',
            }),
        );
    }
};

const ensureDaemon = async () => {
    const result = await ensureMachineMcpDaemonProcess({
        coreRoot: cli.paths.core.root,
        port: typeof cli.args.port === 'string' ? cli.args.port : undefined,
    });

    if (cli.args.json === true) {
        printJson({ started: result.started, daemon: result.inspection.record });
        return;
    }

    if (result.inspection.record) {
        console.info(
            await renderMcpDaemonBanner({
                mcpUrl: result.inspection.record.mcpUrl,
                pid: result.inspection.record.pid,
                state: result.started ? 'started' : 'connected',
            }),
        );
    }
};

export const run = async () => {
    if (cli.args.action === 'status') {
        await printStatus();
        return;
    }

    if (cli.args.action === 'stop') {
        const result = await stopMachineMcpDaemonProcess();
        if (cli.args.json === true) {
            printJson({ stopped: result.stopped, daemon: result.inspection?.record || null });
        } else if (result.stopped) {
            console.info('Proteum machine MCP daemon stopped.');
        } else if (result.inspection?.record) {
            console.info(`Could not stop Proteum machine MCP daemon pid ${result.inspection.record.pid}.`);
            process.exitCode = 1;
        }
        return;
    }

    if (cli.args.daemon === true) {
        await runDaemon();
        return;
    }

    if (cli.args.stdio !== true && (process.stdout.isTTY || cli.args.json === true)) {
        await ensureDaemon();
        return;
    }

    await startProteumMachineMcpRouter({
        version: String(cli.packageJson.version || ''),
    });
};
