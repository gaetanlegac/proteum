import fs from 'fs-extra';
import net from 'net';
import path from 'path';
import dotenv from 'dotenv';

import type { TProteumMcpNextAction } from '../../common/dev/mcpPayloads';
import type { TProteumManifest } from '../../common/dev/proteumManifest';
import { quoteShellPath, readProteumAppRootSummary } from '../utils/appRoots';
import { inspectDevPort } from './ports';

type TPreflightState = 'blocked' | 'ready' | 'warning';
type TCheckStatus = 'blocked' | 'ok' | 'skipped' | 'warning';

export type TFreshCopyPreflight = {
    state: TPreflightState;
    blockers: string[];
    warnings: string[];
    roots: {
        appRoot: string;
        installRoot: string;
        packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
    };
    env: {
        app: {
            filepath: string;
            present: boolean;
            exampleFilepath?: string;
            keys: string[];
        };
        root?: {
            filepath: string;
            present: boolean;
            required: boolean;
            exampleFilepath?: string;
            keys: string[];
        };
        requiredKeys: {
            missing: string[];
            provided: string[];
            total: number;
        };
    };
    dependencies: {
        installCommand: string;
        lockfile?: string;
        nodeModulesPresent: boolean;
        packageJsonPresent: boolean;
        status: TCheckStatus;
    };
    generated: {
        manifestPresent: boolean;
        manifestReadable: boolean;
        status: TCheckStatus;
    };
    database: {
        configFilepath?: string;
        datasourceProvider?: string;
        detected: boolean;
        generatedClientPresent?: boolean;
        localTcp?: {
            checked: boolean;
            host?: string;
            port?: number;
            reachable?: boolean;
            reason?: string;
        };
        requiredEnvKey?: string;
        schemaFilepath?: string;
        status: TCheckStatus;
        url?: {
            database?: string;
            host?: string;
            port?: string;
            protocol?: string;
            redacted: string;
            usernamePresent: boolean;
        };
    };
    connectedProjects: Array<{
        namespace: string;
        sourceKind?: string;
        sourceValue?: string;
        status: TCheckStatus;
        urlInternal?: string;
    }>;
};

export type TFreshCopyPreflightResult = {
    nextActions: TProteumMcpNextAction[];
    readiness: TFreshCopyPreflight;
};

type TBuildFreshCopyPreflightArgs = {
    appRoot: string;
    baseRoot?: string;
    manifest?: TProteumManifest;
};

type TPackageManager = TFreshCopyPreflight['roots']['packageManager'];

const envFileName = '.env';
const envExampleFilenames = ['.env.example', '.env.local.example', '.env.development.example'];
const baseRequiredEnvKeys = ['ENV_NAME', 'ENV_PROFILE', 'PORT', 'URL', 'URL_INTERNAL'];
const databaseUrlEnvKey = 'DATABASE_URL';

const statusBlocked = 'blocked' as const;
const statusOk = 'ok' as const;
const statusSkipped = 'skipped' as const;
const statusWarning = 'warning' as const;

const normalizePath = (value: string) => path.normalize(path.resolve(value));

const pathEntryExists = (filepath: string) => {
    try {
        fs.lstatSync(filepath);
        return true;
    } catch {
        return false;
    }
};

const isDirectory = (filepath: string) => {
    try {
        return fs.statSync(filepath).isDirectory();
    } catch {
        return false;
    }
};

const readJsonFile = (filepath: string) => {
    try {
        return fs.readJSONSync(filepath) as Record<string, unknown>;
    } catch {
        return {};
    }
};

const findNearestFile = (startPath: string, filenames: string[]) => {
    let currentPath = normalizePath(startPath);

    while (true) {
        for (const filename of filenames) {
            const candidate = path.join(currentPath, filename);
            if (pathEntryExists(candidate)) return candidate;
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const findVisibleDirectory = (startPath: string, directoryName: string) => {
    let currentPath = normalizePath(startPath);

    while (true) {
        const candidate = path.join(currentPath, directoryName);
        if (isDirectory(candidate)) return candidate;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const findPackageJsonRoot = (startPath: string) => {
    let currentPath = normalizePath(startPath);

    while (true) {
        if (pathEntryExists(path.join(currentPath, 'package.json'))) return currentPath;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return normalizePath(startPath);
        currentPath = parentPath;
    }
};

const resolvePackageManager = (lockfile?: string, packageRoot?: string): TPackageManager => {
    if (lockfile?.endsWith('package-lock.json')) return 'npm';
    if (lockfile?.endsWith('pnpm-lock.yaml')) return 'pnpm';
    if (lockfile?.endsWith('yarn.lock')) return 'yarn';

    const packageJson = packageRoot ? readJsonFile(path.join(packageRoot, 'package.json')) : {};
    const packageManager = typeof packageJson.packageManager === 'string' ? packageJson.packageManager : '';
    if (packageManager.startsWith('pnpm@')) return 'pnpm';
    if (packageManager.startsWith('yarn@')) return 'yarn';
    if (packageManager.startsWith('npm@')) return 'npm';

    return 'unknown';
};

const resolveInstallRoot = (appRoot: string) => {
    const lockfile = findNearestFile(appRoot, ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
    const packageRoot = lockfile ? path.dirname(lockfile) : findPackageJsonRoot(appRoot);
    const packageManager = resolvePackageManager(lockfile, packageRoot);

    return {
        installRoot: packageRoot,
        lockfile,
        packageManager,
    };
};

const createScopedCommand = ({
    baseRoot,
    command,
    cwd,
}: {
    baseRoot?: string;
    command: string;
    cwd: string;
}) => {
    const normalizedCwd = normalizePath(cwd);
    const normalizedBaseRoot = baseRoot ? normalizePath(baseRoot) : normalizedCwd;
    if (normalizedCwd === normalizedBaseRoot) return command;

    const relative = path.relative(normalizedBaseRoot, normalizedCwd);
    const cdTarget = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : normalizedCwd;
    return `cd ${quoteShellPath(cdTarget)} && ${command}`;
};

const createInstallCommand = (packageManager: TPackageManager) => {
    if (packageManager === 'pnpm') return 'pnpm install';
    if (packageManager === 'yarn') return 'yarn install';
    return 'npm install';
};

const createRefreshCommand = (cwd: string, baseRoot?: string) =>
    createScopedCommand({ baseRoot, command: 'npx proteum refresh', cwd });

const createRuntimeStatusCommand = (cwd: string, baseRoot?: string) =>
    createScopedCommand({ baseRoot, command: 'npx proteum runtime status', cwd });

const createStartDevCommand = (cwd: string, port: number | undefined, baseRoot?: string) =>
    createScopedCommand({
        baseRoot,
        command: `npx proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port ${port || '<free-port>'}`,
        cwd,
    });

const createCopyEnvCommand = (cwd: string, exampleFilepath: string, targetFilepath: string, baseRoot?: string) =>
    createScopedCommand({
        baseRoot,
        command: `cp ${quoteShellPath(path.relative(cwd, exampleFilepath) || path.basename(exampleFilepath))} ${quoteShellPath(
            path.relative(cwd, targetFilepath) || path.basename(targetFilepath),
        )}`,
        cwd,
    });

const findEnvExample = (root: string) =>
    envExampleFilenames.map((filename) => path.join(root, filename)).find((filepath) => pathEntryExists(filepath));

const readEnvFile = (filepath: string) => {
    if (!pathEntryExists(filepath)) return {};

    try {
        return dotenv.parse(fs.readFileSync(filepath));
    } catch {
        return {};
    }
};

const hasWorkspaceRootTooling = (workspaceRoot: string) => {
    if (pathEntryExists(path.join(workspaceRoot, 'prisma.config.ts'))) return true;

    const packageJson = readJsonFile(path.join(workspaceRoot, 'package.json'));
    return Array.isArray(packageJson.workspaces);
};

const resolveWorkspaceRootEnv = (appRoot: string, installRoot: string) => {
    const normalizedAppRoot = normalizePath(appRoot);
    const normalizedInstallRoot = normalizePath(installRoot);
    if (normalizedAppRoot === normalizedInstallRoot) return undefined;
    if (!hasWorkspaceRootTooling(normalizedInstallRoot)) return undefined;

    return path.join(normalizedInstallRoot, envFileName);
};

const mergeEnvValues = (...sources: Array<Record<string, string> | undefined>) => {
    const output: Record<string, string> = {};
    for (const source of sources) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) output[key] = value;
    }
    return output;
};

const unique = <TValue>(values: TValue[]) => [...new Set(values)];

const resolveRequiredEnvKeys = ({ databaseDetected, manifest }: { databaseDetected: boolean; manifest?: TProteumManifest }) =>
    unique([
        ...(manifest ? manifest.env.requiredVariables.map((variable) => variable.key) : baseRequiredEnvKeys),
        ...(databaseDetected ? [databaseUrlEnvKey] : []),
    ]);

const findSchemaFromPrismaConfig = (configFilepath: string) => {
    try {
        const content = fs.readFileSync(configFilepath, 'utf8');
        const match = content.match(/\bschema\s*:\s*['"`]([^'"`]+)['"`]/);
        const configuredSchema = match?.[1]?.trim();
        if (!configuredSchema) return undefined;

        const resolved = path.resolve(path.dirname(configFilepath), configuredSchema);
        if (pathEntryExists(resolved) && isDirectory(resolved)) return path.join(resolved, 'schema.prisma');
        return resolved;
    } catch {
        return undefined;
    }
};

const findPrismaSchema = (appRoot: string, installRoot: string) => {
    const configFilepath = findNearestFile(appRoot, ['prisma.config.ts']);
    const configSchema = configFilepath ? findSchemaFromPrismaConfig(configFilepath) : undefined;
    if (configSchema && pathEntryExists(configSchema)) return { configFilepath, schemaFilepath: configSchema };

    const candidates = unique([
        path.join(appRoot, 'prisma', 'schema.prisma'),
        path.join(appRoot, 'schema.prisma'),
        path.join(installRoot, 'prisma', 'schema.prisma'),
        path.join(installRoot, 'packages', 'db', 'prisma', 'schema.prisma'),
    ]);
    const schemaFilepath = candidates.find((candidate) => pathEntryExists(candidate));

    return { configFilepath, schemaFilepath };
};

const readPrismaSchemaInfo = (schemaFilepath: string | undefined) => {
    if (!schemaFilepath || !pathEntryExists(schemaFilepath)) return {};

    try {
        const content = fs.readFileSync(schemaFilepath, 'utf8');
        const provider = content.match(/\bprovider\s*=\s*["']([^"']+)["']/)?.[1];
        const output = content.match(/\boutput\s*=\s*["']([^"']+)["']/)?.[1];
        return { output, provider };
    } catch {
        return {};
    }
};

const resolveGeneratedClientPath = ({
    appRoot,
    installRoot,
    output,
    schemaFilepath,
}: {
    appRoot: string;
    installRoot: string;
    output?: string;
    schemaFilepath?: string;
}) => {
    if (output && schemaFilepath) return path.resolve(path.dirname(schemaFilepath), output);

    const candidates = [
        path.join(appRoot, 'var', 'prisma'),
        path.join(installRoot, 'node_modules', '.prisma', 'client'),
        path.join(appRoot, 'node_modules', '.prisma', 'client'),
    ];

    return candidates.find((candidate) => pathEntryExists(candidate));
};

const resolvePrismaCommand = ({
    appRoot,
    command,
    configFilepath,
    schemaFilepath,
}: {
    appRoot: string;
    command: 'generate' | 'migrate status';
    configFilepath?: string;
    schemaFilepath?: string;
}) => {
    const cwd = configFilepath ? path.dirname(configFilepath) : appRoot;
    if (configFilepath) return { command: `npx prisma ${command} --config ./prisma.config.ts`, cwd };
    if (!schemaFilepath) return { command: `npx prisma ${command}`, cwd };

    return {
        command: `npx prisma ${command} --schema ${quoteShellPath(path.relative(cwd, schemaFilepath))}`,
        cwd,
    };
};

const redactDatabaseUrl = (databaseUrl: string) => {
    const parsed = new URL(databaseUrl);
    const database = parsed.pathname.replace(/^\/+/, '') || undefined;
    const host = parsed.hostname || undefined;
    const port = parsed.port || undefined;
    const auth = parsed.username ? '<user>@' : '';
    const hostPort = `${host || '<host>'}${port ? `:${port}` : ''}`;

    return {
        database,
        host,
        port,
        protocol: parsed.protocol.replace(/:$/, ''),
        redacted: `${parsed.protocol}//${auth}${hostPort}${database ? `/${database}` : ''}`,
        usernamePresent: Boolean(parsed.username),
    };
};

const resolveDatabasePort = (url: URL) => {
    if (url.port) return Number(url.port);
    if (url.protocol === 'postgres:' || url.protocol === 'postgresql:') return 5432;
    if (url.protocol === 'mysql:' || url.protocol === 'mariadb:') return 3306;
    return undefined;
};

const isSupportedDatabaseProtocol = (protocol: string) =>
    protocol === 'mysql:' || protocol === 'mariadb:' || protocol === 'postgres:' || protocol === 'postgresql:';

const isLocalDatabaseHost = (host: string) => ['localhost', '127.0.0.1', '::1'].includes(host);

const probeLocalTcp = async (host: string, port: number, timeoutMs = 350) =>
    await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host, port });
        let settled = false;
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });

const resolveDatabaseReadiness = async ({
    appRoot,
    baseRoot,
    envValues,
    installRoot,
}: {
    appRoot: string;
    baseRoot?: string;
    envValues: Record<string, string>;
    installRoot: string;
}) => {
    const { configFilepath, schemaFilepath } = findPrismaSchema(appRoot, installRoot);
    const schemaPresent = Boolean(schemaFilepath);
    const schemaInfo = readPrismaSchemaInfo(schemaFilepath);
    const generatedClientPath = resolveGeneratedClientPath({
        appRoot,
        installRoot,
        output: schemaInfo.output,
        schemaFilepath,
    });
    const generatedClientPresent = schemaPresent ? Boolean(generatedClientPath && pathEntryExists(generatedClientPath)) : undefined;
    const databaseUrl = envValues[databaseUrlEnvKey]?.trim();
    const blockers: string[] = [];
    const warnings: string[] = [];
    const nextActions: TProteumMcpNextAction[] = [];
    let url: TFreshCopyPreflight['database']['url'];
    let localTcp: TFreshCopyPreflight['database']['localTcp'];

    if (!schemaPresent) {
        return {
            blockers,
            database: {
                configFilepath,
                detected: false,
                status: statusSkipped,
            } satisfies TFreshCopyPreflight['database'],
            nextActions,
            warnings,
        };
    }

    if (!databaseUrl) {
        blockers.push('DATABASE_URL is required for the detected Prisma schema.');
    } else {
        try {
            const parsed = new URL(databaseUrl);
            url = redactDatabaseUrl(databaseUrl);

            if (!isSupportedDatabaseProtocol(parsed.protocol)) {
                blockers.push(`DATABASE_URL uses unsupported protocol ${parsed.protocol}`);
            } else if (!parsed.pathname.replace(/^\/+/, '')) {
                blockers.push('DATABASE_URL must include a database name.');
            } else if (parsed.hostname && isLocalDatabaseHost(parsed.hostname)) {
                const port = resolveDatabasePort(parsed);
                if (port) {
                    const reachable = await probeLocalTcp(parsed.hostname, port);
                    localTcp = { checked: true, host: parsed.hostname, port, reachable };
                    if (!reachable) blockers.push(`Local database ${parsed.hostname}:${port} is not reachable.`);
                }
            } else {
                localTcp = {
                    checked: false,
                    host: parsed.hostname || undefined,
                    port: resolveDatabasePort(parsed),
                    reason: 'Remote database hosts are not probed by workflow_start.',
                };
            }
        } catch (error) {
            blockers.push(error instanceof Error ? `DATABASE_URL is invalid: ${error.message}` : 'DATABASE_URL is invalid.');
        }
    }

    if (!generatedClientPresent) {
        blockers.push('Prisma generated client artifacts are missing.');
        const generate = resolvePrismaCommand({ appRoot, command: 'generate', configFilepath, schemaFilepath });
        nextActions.push({
            label: 'Generate Prisma Client',
            command: createScopedCommand({ baseRoot, command: generate.command, cwd: generate.cwd }),
            reason: 'Prisma schema is present but generated client artifacts were not found.',
        });
    }

    if (databaseUrl && blockers.length === 0) {
        const migrateStatus = resolvePrismaCommand({ appRoot, command: 'migrate status', configFilepath, schemaFilepath });
        nextActions.push({
            label: 'Check Prisma Migrations',
            command: createScopedCommand({ baseRoot, command: migrateStatus.command, cwd: migrateStatus.cwd }),
            reason: 'Verify database migration state with a read-only Prisma status command before starting dev.',
        });
    }

    return {
        blockers,
        database: {
            configFilepath,
            datasourceProvider: schemaInfo.provider,
            detected: true,
            generatedClientPresent,
            localTcp,
            requiredEnvKey: databaseUrlEnvKey,
            schemaFilepath,
            status: blockers.length > 0 ? statusBlocked : warnings.length > 0 ? statusWarning : statusOk,
            url,
        } satisfies TFreshCopyPreflight['database'],
        nextActions,
        warnings,
    };
};

const resolveConnectedProjectActions = async ({
    appRoot,
    baseRoot,
    manifest,
}: {
    appRoot: string;
    baseRoot?: string;
    manifest?: TProteumManifest;
}) => {
    const blockers: string[] = [];
    const connectedProjects: TFreshCopyPreflight['connectedProjects'] = [];
    const nextActions: TProteumMcpNextAction[] = [];

    for (const project of manifest?.connectedProjects || []) {
        const status = project.sourceKind === 'file' && project.sourceValue && !pathEntryExists(project.sourceValue) ? statusBlocked : statusOk;
        connectedProjects.push({
            namespace: project.namespace,
            sourceKind: project.sourceKind,
            sourceValue: project.sourceValue,
            status,
            urlInternal: project.urlInternal,
        });

        if (status === statusBlocked) {
            blockers.push(`Connected project ${project.namespace} source is missing.`);
            continue;
        }

        if (project.sourceKind !== 'file' || !project.sourceValue) continue;

        const producerRoot = normalizePath(project.sourceValue);
        const producerSummary = readProteumAppRootSummary(producerRoot, baseRoot);
        const producerPort = producerSummary.manifest
            ? await inspectDevPort({ appRoot: producerRoot, port: producerSummary.manifest.routerPort })
            : undefined;
        const startPort =
            producerPort && !producerPort.canStartOnConfiguredPort ? producerPort.recommendedPort : producerSummary.manifest?.routerPort;

        nextActions.push({
            label: `Workflow Start ${project.namespace}`,
            tool: 'workflow_start',
            toolArgs: { cwd: producerRoot, task: `prepare connected producer ${project.namespace}` },
            reason: 'Run the same fresh-copy preflight against the connected producer app before the consumer starts.',
        });

        if (producerSummary.hasManifest) {
            nextActions.push({
                label: `Start ${project.namespace}`,
                command: createStartDevCommand(producerRoot, startPort, baseRoot),
                reason: 'Start the local connected producer before validating the consumer app.',
            });
        } else {
            nextActions.push({
                label: `Refresh ${project.namespace}`,
                command: createRefreshCommand(producerRoot, baseRoot),
                reason: 'Generate the connected producer manifest before starting it.',
            });
        }
    }

    return { blockers, connectedProjects, nextActions };
};

const dedupeNextActions = (actions: TProteumMcpNextAction[]) => {
    const seen = new Set<string>();
    const output: TProteumMcpNextAction[] = [];

    for (const action of actions) {
        const key = JSON.stringify({
            command: action.command,
            label: action.label,
            tool: action.tool,
            toolArgs: action.toolArgs,
        });
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(action);
    }

    return output;
};

export const buildFreshCopyPreflight = async ({
    appRoot,
    baseRoot,
    manifest,
}: TBuildFreshCopyPreflightArgs): Promise<TFreshCopyPreflightResult> => {
    const normalizedAppRoot = normalizePath(appRoot);
    const { installRoot, lockfile, packageManager } = resolveInstallRoot(normalizedAppRoot);
    const appEnvFilepath = path.join(normalizedAppRoot, envFileName);
    const rootEnvFilepath = resolveWorkspaceRootEnv(normalizedAppRoot, installRoot);
    const appEnv = readEnvFile(appEnvFilepath);
    const rootEnv = rootEnvFilepath ? readEnvFile(rootEnvFilepath) : undefined;
    const envValues = mergeEnvValues(rootEnv, appEnv);
    const databaseReadiness = await resolveDatabaseReadiness({
        appRoot: normalizedAppRoot,
        baseRoot,
        envValues,
        installRoot,
    });
    const requiredEnvKeys = resolveRequiredEnvKeys({ databaseDetected: databaseReadiness.database.detected, manifest });
    const missingRequiredEnvKeys = requiredEnvKeys.filter((key) => !envValues[key]?.trim());
    const providedRequiredEnvKeys = requiredEnvKeys.filter((key) => envValues[key]?.trim());
    const blockers: string[] = [];
    const warnings: string[] = [];
    const nextActions: TProteumMcpNextAction[] = [];
    const appEnvExample = findEnvExample(normalizedAppRoot);
    const rootEnvExample = rootEnvFilepath ? findEnvExample(path.dirname(rootEnvFilepath)) : undefined;
    const appEnvPresent = pathEntryExists(appEnvFilepath);
    const rootEnvPresent = rootEnvFilepath ? pathEntryExists(rootEnvFilepath) : false;
    const packageJsonPresent = pathEntryExists(path.join(normalizedAppRoot, 'package.json'));
    const nodeModulesPresent = findVisibleDirectory(normalizedAppRoot, 'node_modules') !== undefined;
    const manifestFilepath = path.join(normalizedAppRoot, '.proteum', 'manifest.json');
    const manifestPresent = pathEntryExists(manifestFilepath);
    const manifestReadable = Boolean(manifest);
    const connected = await resolveConnectedProjectActions({ appRoot: normalizedAppRoot, baseRoot, manifest });

    if (!appEnvPresent) {
        blockers.push('App .env is missing.');
        nextActions.push({
            label: appEnvExample ? 'Copy App Env Example' : 'Create App Env',
            ...(appEnvExample ? { command: createCopyEnvCommand(normalizedAppRoot, appEnvExample, appEnvFilepath, baseRoot) } : {}),
            reason: appEnvExample
                ? 'Create the app .env from the tracked example, then fill any secret values.'
                : `Create ${appEnvFilepath} with the required app runtime variables.`,
        });
    }

    if (rootEnvFilepath && !rootEnvPresent) {
        blockers.push('Workspace root .env is missing.');
        nextActions.push({
            label: rootEnvExample ? 'Copy Root Env Example' : 'Create Root Env',
            ...(rootEnvExample
                ? { command: createCopyEnvCommand(path.dirname(rootEnvFilepath), rootEnvExample, rootEnvFilepath, baseRoot) }
                : {}),
            reason: rootEnvExample
                ? 'Create the workspace root .env from the tracked example, then fill any secret values.'
                : `Create ${rootEnvFilepath} for workspace-root tooling such as Prisma or package scripts.`,
        });
    }

    if (missingRequiredEnvKeys.length > 0) {
        blockers.push(`Missing required env keys: ${missingRequiredEnvKeys.join(', ')}.`);
        nextActions.push({
            label: 'Fill Env Values',
            reason: `Add values for ${missingRequiredEnvKeys.join(', ')} without committing secrets.`,
        });
    }

    if (!packageJsonPresent) {
        blockers.push('package.json is missing.');
    }

    if (!nodeModulesPresent) {
        blockers.push('node_modules is missing.');
        nextActions.push({
            label: 'Install Dependencies',
            command: createScopedCommand({ baseRoot, command: createInstallCommand(packageManager), cwd: installRoot }),
            reason: 'Install dependencies at the detected package root before refresh, Prisma, or dev commands.',
        });
    }

    if (!manifestPresent || !manifestReadable) {
        blockers.push(!manifestPresent ? '.proteum/manifest.json is missing.' : '.proteum/manifest.json is not readable.');
        nextActions.push({
            label: 'Refresh Manifest',
            command: createRefreshCommand(normalizedAppRoot, baseRoot),
            reason: 'Generate Proteum manifest and generated runtime artifacts before owner, route, or dev reads.',
        });
    }

    blockers.push(...databaseReadiness.blockers, ...connected.blockers);
    warnings.push(...databaseReadiness.warnings);
    nextActions.push(...databaseReadiness.nextActions, ...connected.nextActions);

    const state: TPreflightState = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready';

    return {
        nextActions: dedupeNextActions(nextActions),
        readiness: {
            state,
            blockers,
            warnings,
            roots: {
                appRoot: normalizedAppRoot,
                installRoot,
                packageManager,
            },
            env: {
                app: {
                    filepath: appEnvFilepath,
                    present: appEnvPresent,
                    exampleFilepath: appEnvExample,
                    keys: Object.keys(appEnv).sort(),
                },
                ...(rootEnvFilepath
                    ? {
                          root: {
                              filepath: rootEnvFilepath,
                              present: rootEnvPresent,
                              required: true,
                              exampleFilepath: rootEnvExample,
                              keys: Object.keys(rootEnv || {}).sort(),
                          },
                      }
                    : {}),
                requiredKeys: {
                    missing: missingRequiredEnvKeys,
                    provided: providedRequiredEnvKeys,
                    total: requiredEnvKeys.length,
                },
            },
            dependencies: {
                installCommand: createInstallCommand(packageManager),
                lockfile,
                nodeModulesPresent,
                packageJsonPresent,
                status: !packageJsonPresent || !nodeModulesPresent ? statusBlocked : statusOk,
            },
            generated: {
                manifestPresent,
                manifestReadable,
                status: manifestPresent && manifestReadable ? statusOk : statusBlocked,
            },
            database: databaseReadiness.database,
            connectedProjects: connected.connectedProjects,
        },
    };
};
