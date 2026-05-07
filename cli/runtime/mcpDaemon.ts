import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

import fs from 'fs-extra';

export const machineMcpDaemonRegistryVersion = 1 as const;

export type TMachineMcpDaemonRecord = {
    version: typeof machineMcpDaemonRegistryVersion;
    pid: number;
    port: number;
    host: string;
    mcpUrl: string;
    healthUrl: string;
    startedAt: string;
    updatedAt: string;
    command: string[];
};

export type TMachineMcpDaemonInspection = {
    registryFilePath: string;
    record: TMachineMcpDaemonRecord | null;
    live: boolean;
    stale: boolean;
    invalid: boolean;
    parseError: string;
};

export type TEnsureMachineMcpDaemonResult = {
    inspection: TMachineMcpDaemonInspection;
    started: boolean;
};

const defaultMachineMcpDaemonDirectoryParts = ['.proteum', 'mcp'];
const defaultMachineMcpDaemonPort = 3769;
const machineMcpDaemonHost = '127.0.0.1';

const sleep = async (durationMs: number) => await new Promise((resolve) => setTimeout(resolve, durationMs));

const isRecordShape = (value: unknown): value is TMachineMcpDaemonRecord => {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<TMachineMcpDaemonRecord>;

    return (
        candidate.version === machineMcpDaemonRegistryVersion &&
        typeof candidate.pid === 'number' &&
        Number.isInteger(candidate.pid) &&
        candidate.pid > 0 &&
        typeof candidate.port === 'number' &&
        Number.isInteger(candidate.port) &&
        candidate.port > 0 &&
        typeof candidate.host === 'string' &&
        candidate.host.length > 0 &&
        typeof candidate.mcpUrl === 'string' &&
        candidate.mcpUrl.length > 0 &&
        typeof candidate.healthUrl === 'string' &&
        candidate.healthUrl.length > 0 &&
        typeof candidate.startedAt === 'string' &&
        typeof candidate.updatedAt === 'string' &&
        Array.isArray(candidate.command) &&
        candidate.command.every((entry) => typeof entry === 'string')
    );
};

const canSignalProcess = (pid: number, signal: NodeJS.Signals | 0) => {
    try {
        process.kill(pid, signal);
        return true;
    } catch (error) {
        const errno = error as NodeJS.ErrnoException;

        if (errno.code === 'ESRCH') return false;
        if (errno.code === 'EPERM') return true;

        throw error;
    }
};

const isProcessAlive = (pid: number) => canSignalProcess(pid, 0);

const waitForProcessExit = async (pid: number, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) return true;
        await sleep(100);
    }

    return !isProcessAlive(pid);
};

export const getMachineMcpDaemonRegistryDirectory = () =>
    process.env.PROTEUM_MACHINE_MCP_DIR && process.env.PROTEUM_MACHINE_MCP_DIR.trim()
        ? path.resolve(process.env.PROTEUM_MACHINE_MCP_DIR)
        : path.join(os.homedir(), ...defaultMachineMcpDaemonDirectoryParts);

export const resolveMachineMcpDaemonRecordFilePath = () =>
    path.join(getMachineMcpDaemonRegistryDirectory(), 'router.json');

export const resolveMachineMcpDaemonPort = (port?: string | number) => {
    const rawPort =
        port !== undefined && String(port).trim()
            ? String(port).trim()
            : process.env.PROTEUM_MCP_PORT && process.env.PROTEUM_MCP_PORT.trim()
              ? process.env.PROTEUM_MCP_PORT.trim()
              : String(defaultMachineMcpDaemonPort);
    const parsedPort = Number(rawPort);

    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        throw new Error(`Invalid Proteum MCP daemon port: ${rawPort}.`);
    }

    return parsedPort;
};

export const createMachineMcpDaemonRecord = ({
    command,
    host = machineMcpDaemonHost,
    pid = process.pid,
    port,
}: {
    command: string[];
    host?: string;
    pid?: number;
    port: number;
}): TMachineMcpDaemonRecord => {
    const timestamp = new Date().toISOString();
    const baseUrl = `http://${host}:${port}`;

    return {
        version: machineMcpDaemonRegistryVersion,
        pid,
        port,
        host,
        mcpUrl: `${baseUrl}/mcp`,
        healthUrl: `${baseUrl}/health`,
        startedAt: timestamp,
        updatedAt: timestamp,
        command,
    };
};

export const writeMachineMcpDaemonRecord = async (record: TMachineMcpDaemonRecord) => {
    const registryFilePath = resolveMachineMcpDaemonRecordFilePath();

    await fs.ensureDir(path.dirname(registryFilePath));
    await fs.writeJson(registryFilePath, record, { spaces: 2 });

    return record;
};

export const removeMachineMcpDaemonRecord = async (pid = process.pid) => {
    const inspection = await inspectMachineMcpDaemonRecord({ cleanStale: false });

    if (!inspection?.record || inspection.record.pid === pid) {
        await fs.remove(resolveMachineMcpDaemonRecordFilePath());
    }
};

export const removeMachineMcpDaemonRecordSync = (pid = process.pid) => {
    try {
        const registryFilePath = resolveMachineMcpDaemonRecordFilePath();
        if (!fs.pathExistsSync(registryFilePath)) return;

        const record = fs.readJsonSync(registryFilePath);
        if (!isRecordShape(record) || record.pid === pid) fs.removeSync(registryFilePath);
    } catch {
        // Best-effort cleanup during process exit.
    }
};

export const inspectMachineMcpDaemonRecord = async ({
    cleanStale = true,
}: {
    cleanStale?: boolean;
} = {}): Promise<TMachineMcpDaemonInspection | null> => {
    const registryFilePath = resolveMachineMcpDaemonRecordFilePath();
    if (!(await fs.pathExists(registryFilePath))) return null;

    try {
        const rawValue = await fs.readJson(registryFilePath);
        if (!isRecordShape(rawValue)) {
            const inspection = {
                registryFilePath,
                record: null,
                live: false,
                stale: true,
                invalid: true,
                parseError: 'Machine MCP daemon file contents do not match the Proteum MCP daemon schema.',
            };

            if (cleanStale) await fs.remove(registryFilePath);
            return inspection;
        }

        const record = rawValue;
        const live = isProcessAlive(record.pid);
        const inspection = {
            registryFilePath,
            record,
            live,
            stale: !live,
            invalid: false,
            parseError: '',
        };

        if (cleanStale && !live) await fs.remove(registryFilePath);

        return inspection;
    } catch (error) {
        const inspection = {
            registryFilePath,
            record: null,
            live: false,
            stale: true,
            invalid: true,
            parseError: error instanceof Error ? error.message : String(error),
        };

        if (cleanStale) await fs.remove(registryFilePath);

        return inspection;
    }
};

export const ensureMachineMcpDaemonProcess = async ({
    coreRoot,
    port,
}: {
    coreRoot: string;
    port?: string | number;
}): Promise<TEnsureMachineMcpDaemonResult> => {
    const existing = await inspectMachineMcpDaemonRecord();
    if (existing?.record && existing.live) return { inspection: existing, started: false };

    const resolvedPort = resolveMachineMcpDaemonPort(port);
    const cliBin = path.join(coreRoot, 'cli', 'bin.js');
    const args = [cliBin, 'mcp', '--daemon', '--port', String(resolvedPort)];
    const child = spawn(process.execPath, args, {
        cwd: coreRoot,
        detached: true,
        stdio: 'ignore',
    });

    child.unref();

    for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(100);
        const inspection = await inspectMachineMcpDaemonRecord({ cleanStale: false });
        if (inspection?.record && inspection.live && inspection.record.pid === child.pid) {
            return { inspection, started: true };
        }
        if (child.exitCode !== null || child.signalCode !== null) break;
    }

    const latest = await inspectMachineMcpDaemonRecord({ cleanStale: false });
    if (latest?.record && latest.live) return { inspection: latest, started: false };

    throw new Error('Proteum could not start the machine MCP daemon.');
};

export const stopMachineMcpDaemonProcess = async () => {
    const inspection = await inspectMachineMcpDaemonRecord({ cleanStale: false });

    if (!inspection?.record) {
        if (inspection?.invalid) await fs.remove(inspection.registryFilePath);
        return { inspection, stopped: true };
    }

    if (!inspection.live) {
        await fs.remove(inspection.registryFilePath);
        return { inspection, stopped: true };
    }

    if (canSignalProcess(inspection.record.pid, 'SIGTERM')) {
        const exitedAfterTerm = await waitForProcessExit(inspection.record.pid, 5000);
        if (!exitedAfterTerm && canSignalProcess(inspection.record.pid, 'SIGKILL')) {
            await waitForProcessExit(inspection.record.pid, 2000);
        }
    }

    const live = isProcessAlive(inspection.record.pid);
    if (!live) await fs.remove(inspection.registryFilePath);

    return { inspection, stopped: !live };
};
