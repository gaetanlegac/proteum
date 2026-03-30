import path from 'path';

import fs from 'fs-extra';

export const devSessionRegistryVersion = 1 as const;

export type TDevSessionState = 'starting' | 'ready';

export type TDevSessionRecord = {
    version: typeof devSessionRegistryVersion;
    pid: number;
    appRoot: string;
    routerPort: number;
    publicUrl: string;
    startedAt: string;
    updatedAt: string;
    sessionFilePath: string;
    state: TDevSessionState;
};

export type TDevSessionInspection = {
    sessionFilePath: string;
    record: TDevSessionRecord | null;
    live: boolean;
    stale: boolean;
    invalid: boolean;
    parseError: string;
};

export type TStopDevSessionResult = {
    sessionFilePath: string;
    pid: number | null;
    routerPort: number | null;
    publicUrl: string;
    state: TDevSessionState | '';
    matched: boolean;
    stopped: boolean;
    removed: boolean;
    stale: boolean;
    live: boolean;
    invalid: boolean;
    parseError: string;
};

const defaultRegistryDirectoryParts = ['var', 'run', 'proteum', 'dev'];

const sleep = async (durationMs: number) => await new Promise((resolve) => setTimeout(resolve, durationMs));

const isRecordShape = (value: unknown): value is TDevSessionRecord => {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<TDevSessionRecord>;

    return (
        candidate.version === devSessionRegistryVersion &&
        typeof candidate.pid === 'number' &&
        Number.isInteger(candidate.pid) &&
        candidate.pid > 0 &&
        typeof candidate.appRoot === 'string' &&
        candidate.appRoot.length > 0 &&
        typeof candidate.routerPort === 'number' &&
        Number.isInteger(candidate.routerPort) &&
        candidate.routerPort > 0 &&
        typeof candidate.publicUrl === 'string' &&
        typeof candidate.startedAt === 'string' &&
        typeof candidate.updatedAt === 'string' &&
        typeof candidate.sessionFilePath === 'string' &&
        candidate.sessionFilePath.length > 0 &&
        (candidate.state === 'starting' || candidate.state === 'ready')
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

export const isProcessAlive = (pid: number) => canSignalProcess(pid, 0);

const waitForProcessExit = async (pid: number, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) return true;
        await sleep(100);
    }

    return !isProcessAlive(pid);
};

export const getDevSessionRegistryDirectory = (appRoot: string) => path.join(appRoot, ...defaultRegistryDirectoryParts);

export const resolveDevSessionFilePath = ({
    appRoot,
    port,
    sessionFilePath,
}: {
    appRoot: string;
    port: number;
    sessionFilePath?: string;
}) => {
    if (sessionFilePath && sessionFilePath.trim()) {
        return path.isAbsolute(sessionFilePath)
            ? path.normalize(sessionFilePath)
            : path.resolve(appRoot, sessionFilePath);
    }

    return path.join(getDevSessionRegistryDirectory(appRoot), `${port}.json`);
};

export const createDevSessionRecord = ({
    appRoot,
    port,
    sessionFilePath,
}: {
    appRoot: string;
    port: number;
    sessionFilePath: string;
}): TDevSessionRecord => {
    const timestamp = new Date().toISOString();

    return {
        version: devSessionRegistryVersion,
        pid: process.pid,
        appRoot,
        routerPort: port,
        publicUrl: '',
        startedAt: timestamp,
        updatedAt: timestamp,
        sessionFilePath,
        state: 'starting',
    };
};

export const writeDevSessionRecord = async (record: TDevSessionRecord) => {
    await fs.ensureDir(path.dirname(record.sessionFilePath));
    await fs.writeJson(record.sessionFilePath, record, { spaces: 2 });
};

export const updateDevSessionRecord = async ({
    sessionFilePath,
    patch,
}: {
    sessionFilePath: string;
    patch: Partial<Omit<TDevSessionRecord, 'version' | 'pid' | 'appRoot' | 'routerPort' | 'startedAt' | 'sessionFilePath'>>;
}) => {
    const inspection = await inspectDevSessionFile(sessionFilePath);
    if (!inspection || !inspection.record) return;

    await writeDevSessionRecord({
        ...inspection.record,
        ...patch,
        updatedAt: new Date().toISOString(),
    });
};

export const removeDevSessionRecord = async (sessionFilePath: string) => {
    await fs.remove(sessionFilePath);
};

export const removeDevSessionRecordSync = (sessionFilePath: string) => {
    try {
        fs.removeSync(sessionFilePath);
    } catch {
        // Best-effort cleanup during process exit.
    }
};

export const inspectDevSessionFile = async (sessionFilePath: string): Promise<TDevSessionInspection | null> => {
    if (!(await fs.pathExists(sessionFilePath))) return null;

    try {
        const rawValue = await fs.readJson(sessionFilePath);
        if (!isRecordShape(rawValue)) {
            return {
                sessionFilePath,
                record: null,
                live: false,
                stale: true,
                invalid: true,
                parseError: 'Session file contents do not match the Proteum dev session schema.',
            };
        }

        const record = rawValue;
        const live = isProcessAlive(record.pid);

        return {
            sessionFilePath,
            record,
            live,
            stale: !live,
            invalid: false,
            parseError: '',
        };
    } catch (error) {
        return {
            sessionFilePath,
            record: null,
            live: false,
            stale: true,
            invalid: true,
            parseError: error instanceof Error ? error.message : String(error),
        };
    }
};

export const listDevSessionFiles = async ({
    appRoot,
    sessionFilePath,
}: {
    appRoot: string;
    sessionFilePath?: string;
}) => {
    if (sessionFilePath && sessionFilePath.trim())
        return [resolveDevSessionFilePath({ appRoot, port: 1, sessionFilePath })];

    const registryDirectory = getDevSessionRegistryDirectory(appRoot);
    if (!(await fs.pathExists(registryDirectory))) return [];

    const entries = await fs.readdir(registryDirectory);

    return entries
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => path.join(registryDirectory, entry));
};

export const listDevSessionInspections = async ({
    appRoot,
    sessionFilePath,
}: {
    appRoot: string;
    sessionFilePath?: string;
}) => {
    const sessionFilePaths = await listDevSessionFiles({ appRoot, sessionFilePath });
    const inspections = await Promise.all(sessionFilePaths.map((entryPath) => inspectDevSessionFile(entryPath)));

    return inspections.filter((inspection): inspection is TDevSessionInspection => inspection !== null);
};

export const stopDevSessionFile = async (sessionFilePath: string): Promise<TStopDevSessionResult> => {
    const inspection = await inspectDevSessionFile(sessionFilePath);

    if (!inspection) {
        return {
            sessionFilePath,
            pid: null,
            routerPort: null,
            publicUrl: '',
            state: '',
            matched: false,
            stopped: false,
            removed: false,
            stale: false,
            live: false,
            invalid: false,
            parseError: '',
        };
    }

    if (!inspection.record) {
        await removeDevSessionRecord(sessionFilePath);

        return {
            sessionFilePath,
            pid: null,
            routerPort: null,
            publicUrl: '',
            state: '',
            matched: true,
            stopped: true,
            removed: true,
            stale: true,
            live: false,
            invalid: true,
            parseError: inspection.parseError,
        };
    }

    const { record } = inspection;

    if (!inspection.live) {
        await removeDevSessionRecord(sessionFilePath);

        return {
            sessionFilePath,
            pid: record.pid,
            routerPort: record.routerPort,
            publicUrl: record.publicUrl,
            state: record.state,
            matched: true,
            stopped: true,
            removed: true,
            stale: true,
            live: false,
            invalid: false,
            parseError: '',
        };
    }

    if (canSignalProcess(record.pid, 'SIGTERM')) {
        const exitedAfterTerm = await waitForProcessExit(record.pid, 5000);
        if (!exitedAfterTerm && canSignalProcess(record.pid, 'SIGKILL')) {
            await waitForProcessExit(record.pid, 2000);
        }
    }

    const live = isProcessAlive(record.pid);
    if (!live) {
        await removeDevSessionRecord(sessionFilePath);
    }

    return {
        sessionFilePath,
        pid: record.pid,
        routerPort: record.routerPort,
        publicUrl: record.publicUrl,
        state: record.state,
        matched: true,
        stopped: !live,
        removed: !live,
        stale: !live,
        live,
        invalid: false,
        parseError: '',
    };
};
