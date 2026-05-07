import crypto from 'crypto';
import os from 'os';
import path from 'path';

import fs from 'fs-extra';

export const devSessionRegistryVersion = 1 as const;
export const machineDevSessionRegistryVersion = 1 as const;

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

export type TMachineDevSessionRecord = {
    version: typeof machineDevSessionRegistryVersion;
    projectId: string;
    appRoot: string;
    pid: number;
    routerPort: number;
    publicUrl: string;
    mcpUrl: string;
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

export type TMachineDevSessionInspection = {
    registryFilePath: string;
    record: TMachineDevSessionRecord | null;
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

export type TPrepareDevSessionStartResult = {
    blocking: TDevSessionInspection[];
    cleaned: TStopDevSessionResult[];
    replaced: TStopDevSessionResult | null;
};

const defaultRegistryDirectoryParts = ['var', 'run', 'proteum', 'dev'];
const defaultMachineRegistryDirectoryParts = ['.proteum', 'dev-sessions'];

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

const isMachineRecordShape = (value: unknown): value is TMachineDevSessionRecord => {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<TMachineDevSessionRecord>;

    return (
        candidate.version === machineDevSessionRegistryVersion &&
        typeof candidate.projectId === 'string' &&
        candidate.projectId.startsWith('prj_') &&
        typeof candidate.appRoot === 'string' &&
        candidate.appRoot.length > 0 &&
        typeof candidate.pid === 'number' &&
        Number.isInteger(candidate.pid) &&
        candidate.pid > 0 &&
        typeof candidate.routerPort === 'number' &&
        Number.isInteger(candidate.routerPort) &&
        candidate.routerPort > 0 &&
        typeof candidate.publicUrl === 'string' &&
        typeof candidate.mcpUrl === 'string' &&
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

export const getMachineDevSessionRegistryDirectory = () =>
    process.env.PROTEUM_MACHINE_DEV_SESSION_DIR && process.env.PROTEUM_MACHINE_DEV_SESSION_DIR.trim()
        ? path.resolve(process.env.PROTEUM_MACHINE_DEV_SESSION_DIR)
        : path.join(os.homedir(), ...defaultMachineRegistryDirectoryParts);

const createProjectIdFromCanonicalAppRoot = (canonicalAppRoot: string) =>
    `prj_${crypto.createHash('sha256').update(canonicalAppRoot).digest('hex').slice(0, 12)}`;

export const resolveCanonicalAppRoot = async (appRoot: string) => {
    try {
        return path.normalize(await fs.realpath(appRoot));
    } catch {
        return path.resolve(appRoot);
    }
};

export const resolveCanonicalAppRootSync = (appRoot: string) => {
    try {
        return path.normalize(fs.realpathSync(appRoot));
    } catch {
        return path.resolve(appRoot);
    }
};

export const resolveProteumProjectId = async (appRoot: string) =>
    createProjectIdFromCanonicalAppRoot(await resolveCanonicalAppRoot(appRoot));

export const resolveProteumProjectIdSync = (appRoot: string) =>
    createProjectIdFromCanonicalAppRoot(resolveCanonicalAppRootSync(appRoot));

export const resolveMachineDevSessionFilePath = (projectId: string) =>
    path.join(getMachineDevSessionRegistryDirectory(), `${projectId}.json`);

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

export const createMachineDevSessionRecord = async (record: TDevSessionRecord): Promise<TMachineDevSessionRecord> => {
    const appRoot = await resolveCanonicalAppRoot(record.appRoot);
    const projectId = createProjectIdFromCanonicalAppRoot(appRoot);
    const publicUrl = record.publicUrl || `http://localhost:${record.routerPort}`;

    return {
        version: machineDevSessionRegistryVersion,
        projectId,
        appRoot,
        pid: record.pid,
        routerPort: record.routerPort,
        publicUrl,
        mcpUrl: `${publicUrl.replace(/\/+$/, '')}/__proteum/mcp`,
        startedAt: record.startedAt,
        updatedAt: record.updatedAt,
        sessionFilePath: record.sessionFilePath,
        state: record.state,
    };
};

export const writeDevSessionRecord = async (record: TDevSessionRecord) => {
    await fs.ensureDir(path.dirname(record.sessionFilePath));
    await fs.writeJson(record.sessionFilePath, record, { spaces: 2 });
};

export const writeMachineDevSessionRecord = async (record: TDevSessionRecord) => {
    const machineRecord = await createMachineDevSessionRecord(record);
    const registryFilePath = resolveMachineDevSessionFilePath(machineRecord.projectId);

    await fs.ensureDir(path.dirname(registryFilePath));
    await fs.writeJson(registryFilePath, machineRecord, { spaces: 2 });

    return machineRecord;
};

export const inspectMachineDevSessionFile = async (registryFilePath: string): Promise<TMachineDevSessionInspection | null> => {
    if (!(await fs.pathExists(registryFilePath))) return null;

    try {
        const rawValue = await fs.readJson(registryFilePath);
        if (!isMachineRecordShape(rawValue)) {
            return {
                registryFilePath,
                record: null,
                live: false,
                stale: true,
                invalid: true,
                parseError: 'Machine session file contents do not match the Proteum dev session schema.',
            };
        }

        const record = rawValue;
        const live = isProcessAlive(record.pid);

        return {
            registryFilePath,
            record,
            live,
            stale: !live,
            invalid: false,
            parseError: '',
        };
    } catch (error) {
        return {
            registryFilePath,
            record: null,
            live: false,
            stale: true,
            invalid: true,
            parseError: error instanceof Error ? error.message : String(error),
        };
    }
};

export const listMachineDevSessionFiles = async () => {
    const registryDirectory = getMachineDevSessionRegistryDirectory();
    if (!(await fs.pathExists(registryDirectory))) return [];

    const entries = await fs.readdir(registryDirectory);

    return entries
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => path.join(registryDirectory, entry));
};

export const listMachineDevSessionInspections = async ({
    cleanStale = true,
}: {
    cleanStale?: boolean;
} = {}) => {
    const registryFilePaths = await listMachineDevSessionFiles();
    const inspections = (
        await Promise.all(registryFilePaths.map((registryFilePath) => inspectMachineDevSessionFile(registryFilePath)))
    ).filter((inspection): inspection is TMachineDevSessionInspection => inspection !== null);

    if (cleanStale) {
        await Promise.all(
            inspections
                .filter((inspection) => inspection.invalid || inspection.stale || !inspection.record)
                .map((inspection) => fs.remove(inspection.registryFilePath)),
        );
    }

    return cleanStale ? inspections.filter((inspection) => inspection.record && inspection.live) : inspections;
};

export const resolveMachineDevSessionInspection = async (projectId: string) => {
    const inspection = await inspectMachineDevSessionFile(resolveMachineDevSessionFilePath(projectId));

    if (!inspection) return null;

    if (inspection.invalid || inspection.stale || !inspection.record) {
        await fs.remove(inspection.registryFilePath);
        return null;
    }

    return inspection;
};

const normalizeMaybeRelativePath = (value: string) => path.normalize(path.resolve(value));

export const removeMachineDevSessionRecordForDevSession = async ({
    appRoot,
    pid = process.pid,
    sessionFilePath,
}: {
    appRoot: string;
    pid?: number;
    sessionFilePath: string;
}) => {
    const projectId = await resolveProteumProjectId(appRoot);
    const registryFilePath = resolveMachineDevSessionFilePath(projectId);
    const inspection = await inspectMachineDevSessionFile(registryFilePath);
    if (!inspection?.record) {
        if (inspection?.invalid) await fs.remove(registryFilePath);
        return;
    }

    if (
        inspection.record.pid === pid &&
        normalizeMaybeRelativePath(inspection.record.sessionFilePath) === normalizeMaybeRelativePath(sessionFilePath)
    ) {
        await fs.remove(registryFilePath);
    }
};

export const removeMachineDevSessionRecordForDevSessionSync = ({
    appRoot,
    pid = process.pid,
    sessionFilePath,
}: {
    appRoot: string;
    pid?: number;
    sessionFilePath: string;
}) => {
    try {
        const projectId = resolveProteumProjectIdSync(appRoot);
        const registryFilePath = resolveMachineDevSessionFilePath(projectId);
        if (!fs.pathExistsSync(registryFilePath)) return;

        const record = fs.readJsonSync(registryFilePath);
        if (!isMachineRecordShape(record)) {
            fs.removeSync(registryFilePath);
            return;
        }

        if (
            record.pid === pid &&
            normalizeMaybeRelativePath(record.sessionFilePath) === normalizeMaybeRelativePath(sessionFilePath)
        ) {
            fs.removeSync(registryFilePath);
        }
    } catch {
        // Best-effort cleanup during process exit.
    }
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

    const updatedRecord = {
        ...inspection.record,
        ...patch,
        updatedAt: new Date().toISOString(),
    };

    await writeDevSessionRecord(updatedRecord);
    await writeMachineDevSessionRecord(updatedRecord);
};

export const removeDevSessionRecord = async (sessionFilePath: string) => {
    const inspection = await inspectDevSessionFile(sessionFilePath);
    if (inspection?.record) {
        await removeMachineDevSessionRecordForDevSession({
            appRoot: inspection.record.appRoot,
            pid: inspection.record.pid,
            sessionFilePath,
        });
    }
    await fs.remove(sessionFilePath);
};

export const removeDevSessionRecordSync = (sessionFilePath: string) => {
    try {
        const inspection = fs.pathExistsSync(sessionFilePath) ? fs.readJsonSync(sessionFilePath) : undefined;
        if (isRecordShape(inspection)) {
            removeMachineDevSessionRecordForDevSessionSync({
                appRoot: inspection.appRoot,
                pid: inspection.pid,
                sessionFilePath,
            });
        }
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

const normalizeSessionFilePath = (sessionFilePath: string) => path.normalize(sessionFilePath);

export const prepareDevSessionStart = async ({
    appRoot,
    currentPid = process.pid,
    replaceExisting,
    sessionFilePath,
}: {
    appRoot: string;
    currentPid?: number;
    replaceExisting: boolean;
    sessionFilePath: string;
}): Promise<TPrepareDevSessionStartResult> => {
    const inspections = await listDevSessionInspections({ appRoot });
    const normalizedSessionFilePath = normalizeSessionFilePath(sessionFilePath);
    const blocking: TDevSessionInspection[] = [];
    const cleaned: TStopDevSessionResult[] = [];
    let replaced: TStopDevSessionResult | null = null;

    for (const inspection of inspections) {
        const isCurrentSessionFile = normalizeSessionFilePath(inspection.sessionFilePath) === normalizedSessionFilePath;

        if (!inspection.record || !inspection.live) {
            cleaned.push(await stopDevSessionFile(inspection.sessionFilePath));
            continue;
        }

        if (inspection.record.pid === currentPid) continue;

        if (isCurrentSessionFile && replaceExisting) {
            replaced = await stopDevSessionFile(inspection.sessionFilePath);
            if (!replaced.stopped) blocking.push(inspection);
            continue;
        }

        blocking.push(inspection);
    }

    return { blocking, cleaned, replaced };
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
