import { spawn } from 'child_process';
import fs from 'fs-extra';
import got, { type Method } from 'got';
import path from 'path';
import { UsageError } from 'clipanion';

import cli from '..';
import Compiler from '../compiler';
import Paths from '../paths';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import { buildContractsDoctorResponse } from '@common/dev/contractsDoctor';
import { buildDoctorResponse, type TDoctorResponse } from '@common/dev/diagnostics';
import { buildOrientationResponse, type TDiagnoseChainItem, type TDiagnoseResponse, type TOrientResponse } from '@common/dev/inspection';
import type { TProteumManifest, TProteumManifestDiagnostic } from '@common/dev/proteumManifest';
import type { TDevCommandRunResponse } from '@common/dev/commands';
import type { TDevSessionStartResponse } from '@common/dev/session';

type TVerifySeverity = 'error' | 'warning';
type TVerifyStepStatus = 'failed' | 'info' | 'passed';

type TVerifyFinding = {
    severity: TVerifySeverity;
    blocking: boolean;
    code: string;
    message: string;
    source: 'browser' | 'contracts' | 'doctor' | 'framework-change' | 'request' | 'command';
    filepath?: string;
    sourceLocation?: { line?: number; column?: number };
    relatedFilepaths?: string[];
    details?: string[];
};

type TVerifyStep = {
    label: string;
    status: TVerifyStepStatus;
    details: string[];
};

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
    target?: string;
    orientation?: TOrientResponse;
    introducedFindings: TVerifyFinding[];
    preExistingFindings: TVerifyFinding[];
    verificationSteps: TVerifyStep[];
    result: {
        ok: boolean;
        strictGlobal: boolean;
        introducedBlockingFindings: number;
        preExistingBlockingFindings: number;
        blockingFindings: number;
    };
    apps?: TVerifyAppResult[];
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

type TBrowserVerificationResult = {
    runId: string;
    workspaceRoot: string;
    url: string;
    title: string;
    statusCode?: number;
    consoleMessages: Array<{ type: string; text: string }>;
    pageErrors: string[];
};

const defaultApps = {
    crosspath: '/Users/gaetan/Desktop/Projets/crosspath/platform',
    product: '/Users/gaetan/Desktop/Projets/unique.domains/platform/apps/product',
    website: '/Users/gaetan/Desktop/Projets/unique.domains/platform/apps/website',
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const normalizeFilepath = (value: string) => value.replace(/\\/g, '/');
const dedupe = <TValue>(values: TValue[]) => [...new Set(values)];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const createLocalBaseUrl = (port: number) => `http://localhost:${port}`;
const getBaseUrlCandidates = (port: number) =>
    dedupe([createLocalBaseUrl(port), `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);

const getRouterPortFromManifestFile = (manifestFilepath: string) => {
    if (!fs.existsSync(manifestFilepath)) return undefined;

    const manifest = fs.readJsonSync(manifestFilepath, { throws: false }) as
        | { env?: { resolved?: { routerPort?: number } } }
        | undefined;
    const port = manifest?.env?.resolved?.routerPort;

    if (typeof port !== 'number' || port <= 0) return undefined;

    return port;
};

const fetchJson = async <TResponse>(baseUrl: string, pathname: string, options?: { json?: object; method?: 'GET' | 'POST' }) => {
    const response = await got(`${normalizeBaseUrl(baseUrl)}${pathname}`, {
        method: options?.method || 'GET',
        json: options?.json,
        responseType: 'json',
        retry: { limit: 0 },
        throwHttpErrors: false,
    });

    if (response.statusCode >= 400) {
        const body = response.body as { error?: string } | undefined;
        throw new UsageError(body?.error || `Request ${pathname} failed with status ${response.statusCode}.`);
    }

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

const resolveLocalManifest = async () => {
    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();
    return readProteumManifest(cli.paths.appRoot);
};

const resolveOrientation = async (query: string) => {
    const manifest = await resolveLocalManifest();
    return {
        manifest,
        orientation: buildOrientationResponse(manifest, query),
    };
};

const collectRelevantFilepaths = ({
    manifest,
    orientation,
    chain,
}: {
    manifest: TProteumManifest;
    orientation: TOrientResponse;
    chain?: TDiagnoseChainItem[];
}) => {
    const filepaths = new Set<string>();

    for (const match of orientation.owner.matches) {
        if (match.source.filepath) filepaths.add(normalizeFilepath(path.resolve(match.source.filepath)));
    }

    for (const item of chain || []) {
        if (item.source?.filepath) filepaths.add(normalizeFilepath(path.resolve(item.source.filepath)));
    }

    if (orientation.connected.imports.length > 0 || orientation.connected.producers.length > 0) {
        filepaths.add(normalizeFilepath(path.resolve(manifest.app.setupFilepath)));
        for (const producer of orientation.connected.producers) {
            if (producer.cachedContractFilepath) filepaths.add(normalizeFilepath(path.resolve(producer.cachedContractFilepath)));
        }
    }

    return filepaths;
};

const diagnosticTouchesRelevantFiles = (diagnostic: TProteumManifestDiagnostic, relevantFilepaths: Set<string>) => {
    const diagnosticFilepath = normalizeFilepath(path.resolve(diagnostic.filepath));
    if (relevantFilepaths.has(diagnosticFilepath)) return true;

    return (diagnostic.relatedFilepaths || []).some((filepath) => relevantFilepaths.has(normalizeFilepath(path.resolve(filepath))));
};

const toFindingFromDiagnostic = (
    diagnostic: TProteumManifestDiagnostic,
    source: 'contracts' | 'doctor',
): TVerifyFinding => ({
    severity: diagnostic.level === 'error' ? 'error' : 'warning',
    blocking: diagnostic.level === 'error',
    code: diagnostic.code,
    message: diagnostic.message,
    source,
    filepath: diagnostic.filepath,
    sourceLocation: diagnostic.sourceLocation,
    relatedFilepaths: diagnostic.relatedFilepaths,
    details: diagnostic.fixHint ? [`fix=${diagnostic.fixHint}`] : undefined,
});

const classifyDiagnostics = ({
    contracts,
    doctor,
    manifest,
    orientation,
    chain,
}: {
    contracts: TDoctorResponse;
    doctor: TDoctorResponse;
    manifest: TProteumManifest;
    orientation: TOrientResponse;
    chain?: TDiagnoseChainItem[];
}) => {
    const relevantFilepaths = collectRelevantFilepaths({ manifest, orientation, chain });
    const introducedFindings: TVerifyFinding[] = [];
    const preExistingFindings: TVerifyFinding[] = [];

    const classify = (diagnostics: TProteumManifestDiagnostic[], source: 'contracts' | 'doctor') => {
        for (const diagnostic of diagnostics) {
            const finding = toFindingFromDiagnostic(diagnostic, source);
            if (diagnosticTouchesRelevantFiles(diagnostic, relevantFilepaths)) introducedFindings.push(finding);
            else preExistingFindings.push(finding);
        }
    };

    classify(doctor.diagnostics, 'doctor');
    classify(contracts.diagnostics, 'contracts');

    return { introducedFindings, preExistingFindings };
};

const finalizeResult = ({
    action,
    apps,
    introducedFindings,
    orientation,
    preExistingFindings,
    strictGlobal,
    target,
    verificationSteps,
}: {
    action: string;
    target?: string;
    orientation?: TOrientResponse;
    apps?: TVerifyAppResult[];
    introducedFindings: TVerifyFinding[];
    preExistingFindings: TVerifyFinding[];
    verificationSteps: TVerifyStep[];
    strictGlobal: boolean;
}): TVerifyResult => {
    const introducedBlockingFindings = introducedFindings.filter((finding) => finding.blocking).length;
    const preExistingBlockingFindings = preExistingFindings.filter((finding) => finding.blocking).length;
    const ok = introducedBlockingFindings === 0 && (!strictGlobal || preExistingBlockingFindings === 0);

    return {
        action,
        ...(target ? { target } : {}),
        ...(orientation ? { orientation } : {}),
        ...(apps ? { apps } : {}),
        introducedFindings,
        preExistingFindings,
        verificationSteps,
        result: {
            ok,
            strictGlobal,
            introducedBlockingFindings,
            preExistingBlockingFindings,
            blockingFindings: introducedBlockingFindings + preExistingBlockingFindings,
        },
    };
};

const renderFindings = (title: string, findings: TVerifyFinding[]) =>
    findings.length === 0
        ? [title, '- none'].join('\n')
        : [
              title,
              ...findings.map(
                  (finding) =>
                      `- [${finding.severity}] ${finding.code} ${finding.message}${finding.filepath ? ` source=${finding.filepath}${finding.sourceLocation?.line ? `:${finding.sourceLocation.line}` : ''}${finding.sourceLocation?.column ? `:${finding.sourceLocation.column}` : ''}` : ''}${finding.details && finding.details.length > 0 ? ` details=${finding.details.join(', ')}` : ''}`,
              ),
          ].join('\n');

const renderSteps = (steps: TVerifyStep[]) =>
    [
        'Verification Steps',
        ...(steps.length === 0
            ? ['- none']
            : steps.map((step) => `- [${step.status}] ${step.label}${step.details.length > 0 ? ` | ${step.details.join(', ')}` : ''}`)),
    ].join('\n');

const renderFrameworkApps = (apps: TVerifyAppResult[]) =>
    apps
        .flatMap((app) => [
            '',
            `${app.name}`,
            `- root=${app.appRoot}`,
            `- baseUrl=${app.baseUrl}`,
            `- startup=${app.startup}`,
            `- page=${app.page.statusCode} ${app.page.url}`,
            `- explain routes=${app.explain.routes} controllers=${app.explain.controllers} commands=${app.explain.commands}`,
            `- doctor errors=${app.doctor.errors} warnings=${app.doctor.warnings}`,
            `- contracts errors=${app.contracts.errors} warnings=${app.contracts.warnings}`,
        ])
        .join('\n');

const renderHuman = (result: TVerifyResult) =>
    [
        `Proteum verify ${result.action}${result.target ? ` ${result.target}` : ''}`,
        ...(result.orientation
            ? [
                  `- appRoot=${result.orientation.app.appRoot}`,
                  `- repoRoot=${result.orientation.app.repoRoot}`,
                  `- owner=${result.orientation.owner.matches[0]?.label || 'none'}`,
              ]
            : []),
        ...(result.apps ? [renderFrameworkApps(result.apps)] : []),
        '',
        renderSteps(result.verificationSteps),
        '',
        renderFindings('Introduced Findings', result.introducedFindings),
        '',
        renderFindings('Pre-existing Findings', result.preExistingFindings),
        '',
        `Result\n- ok=${result.result.ok}\n- strictGlobal=${result.result.strictGlobal}\n- introducedBlockingFindings=${result.result.introducedBlockingFindings}\n- preExistingBlockingFindings=${result.result.preExistingBlockingFindings}`,
    ].join('\n');

const requestSession = async ({ baseUrl, email, role }: { baseUrl: string; email: string; role: string }) => {
    const response = await fetchJson<TDevSessionStartResponse>(baseUrl, '/__proteum/session/start', {
        method: 'POST',
        json: role ? { email, role } : { email },
    });

    return {
        cookieHeader: `${response.session.cookieName}=${response.session.token}`,
        playwrightCookies: [
            {
                name: response.session.cookieName,
                value: response.session.token,
                url: baseUrl,
                expires: Math.floor(Date.parse(response.session.expiresAt) / 1000),
                httpOnly: false,
                secure: new URL(baseUrl).protocol === 'https:',
                sameSite: 'Lax' as const,
            },
        ],
    };
};

const hitRequest = async ({
    baseUrl,
    cookieHeader,
    dataJson,
    method,
    requestPath,
}: {
    baseUrl: string;
    cookieHeader?: string;
    dataJson?: unknown;
    method: Method;
    requestPath: string;
}) => {
    const targetUrl = requestPath.startsWith('http://') || requestPath.startsWith('https://') ? requestPath : `${baseUrl}${requestPath}`;
    const headers = {
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(dataJson !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    const response = await got(targetUrl, {
        body: dataJson !== undefined ? JSON.stringify(dataJson) : undefined,
        followRedirect: false,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        method,
        retry: { limit: 0 },
        throwHttpErrors: false,
    });

    return { statusCode: response.statusCode, url: targetUrl };
};

const armTrace = async (baseUrl: string) => {
    await fetchJson(baseUrl, '/__proteum/trace/arm', { method: 'POST', json: { capture: 'deep' } });
};

const requestDiagnose = async (baseUrl: string, target: string) => {
    const params = new URLSearchParams({ query: target });
    if (target.startsWith('/')) params.set('path', target);
    return await fetchJson<TDiagnoseResponse>(baseUrl, `/__proteum/diagnose?${params.toString()}`);
};

const requestCommandRun = async (baseUrl: string, commandPath: string) =>
    await fetchJson<TDevCommandRunResponse>(baseUrl, '/__proteum/commands/run', {
        method: 'POST',
        json: { path: commandPath },
    });

const parseDataJson = () => {
    if (typeof cli.args.dataJson !== 'string' || !cli.args.dataJson.trim()) return undefined;

    try {
        return JSON.parse(cli.args.dataJson);
    } catch (error) {
        throw new UsageError(`Invalid --data-json payload: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const resolveFocusedPort = (manifest: TProteumManifest) => {
    if (typeof cli.args.port === 'string' && cli.args.port.trim()) {
        const parsedPort = Number.parseInt(cli.args.port.trim(), 10);
        if (!Number.isInteger(parsedPort) || parsedPort <= 0) throw new UsageError(`Invalid --port value "${cli.args.port}".`);
        return parsedPort;
    }

    return getRouterPortFromManifestFile(path.join(manifest.app.root, '.proteum', 'manifest.json')) || manifest.env.resolved.routerPort;
};

const ensureFocusedServer = async (manifest: TProteumManifest) => {
    const explicitUrl = typeof cli.args.url === 'string' && cli.args.url.trim();
    if (explicitUrl) {
        await fetchJson(explicitUrl, '/__proteum/explain?section=app');
        return { baseUrl: normalizeBaseUrl(explicitUrl), startup: 'reused' as const };
    }

    return await ensureServer({
        appRoot: manifest.app.root,
        port: resolveFocusedPort(manifest),
    });
};

const cleanupBrowserWorkspace = (workspaceRoot: string) => {
    if (!fs.existsSync(workspaceRoot)) return;

    const walk = (currentPath: string) => {
        for (const dirent of fs.readdirSync(currentPath, { withFileTypes: true })) {
            const entryPath = path.join(currentPath, dirent.name);
            if (dirent.isDirectory()) {
                walk(entryPath);
                continue;
            }

            if (/lock|singleton/i.test(dirent.name)) fs.removeSync(entryPath);
        }
    };

    walk(workspaceRoot);
};

const runBrowserVerification = async ({
    appRoot,
    baseUrl,
    playwrightCookies,
    target,
}: {
    appRoot: string;
    baseUrl: string;
    target: string;
    playwrightCookies?: Array<{
        name: string;
        value: string;
        url: string;
        expires: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Lax';
    }>;
}) => {
    const paths = new Paths(appRoot, cli.paths.core.root);
    let playwrightModulePath: string | undefined;

    try {
        playwrightModulePath = paths.resolveRequest('playwright');
    } catch (_error) {
        try {
            playwrightModulePath = paths.resolveRequest('@playwright/test');
        } catch (_innerError) {}
    }

    if (!playwrightModulePath) {
        throw new UsageError(
            `Playwright is not installed in ${appRoot}. Install \`@playwright/test\` or \`playwright\`, then use \`npx playwright install chromium\`. Fallback: \`proteum verify request ${target}\`.`,
        );
    }

    const playwright = require(playwrightModulePath) as {
        chromium?: {
            launchPersistentContext: (
                userDataDir: string,
                options: { headless: boolean },
            ) => Promise<{
                newPage: () => Promise<{
                    on: (event: string, listener: (...args: any[]) => void) => void;
                    goto: (url: string, options: { waitUntil: 'domcontentloaded' | 'load' }) => Promise<{ status: () => number } | null>;
                    title: () => Promise<string>;
                    screenshot: (options: { fullPage: boolean; path: string }) => Promise<void>;
                    waitForTimeout: (ms: number) => Promise<void>;
                }>;
                addCookies: (cookies: NonNullable<typeof playwrightCookies>) => Promise<void>;
                close: () => Promise<void>;
            }>;
        };
    };

    if (!playwright.chromium?.launchPersistentContext) {
        throw new UsageError(
            `Resolved Playwright package at ${playwrightModulePath}, but Chromium is unavailable. Run \`npx playwright install chromium\` in ${appRoot}.`,
        );
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workspaceRoot = path.join(appRoot, 'var', 'proteum', 'browser');
    cleanupBrowserWorkspace(workspaceRoot);
    const runRoot = path.join(workspaceRoot, runId);
    const userDataDir = path.join(runRoot, 'profile');
    fs.ensureDirSync(userDataDir);

    const targetUrl = target.startsWith('http://') || target.startsWith('https://') ? target : `${baseUrl}${target}`;
    const consoleMessages: Array<{ type: string; text: string }> = [];
    const pageErrors: string[] = [];

    let browserContext:
        | {
              newPage: () => Promise<any>;
              addCookies: (cookies: NonNullable<typeof playwrightCookies>) => Promise<void>;
              close: () => Promise<void>;
          }
        | undefined;

    try {
        browserContext = await playwright.chromium.launchPersistentContext(userDataDir, { headless: true });
        if (playwrightCookies && playwrightCookies.length > 0) await browserContext.addCookies(playwrightCookies);

        const page = await browserContext.newPage();
        page.on('console', (message: { type: () => string; text: () => string }) => {
            consoleMessages.push({ type: message.type(), text: message.text() });
        });
        page.on('pageerror', (error: Error) => pageErrors.push(error.message));

        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        const title = await page.title();
        await page.screenshot({ fullPage: true, path: path.join(runRoot, 'page.png') });

        return {
            runId,
            workspaceRoot: runRoot,
            url: targetUrl,
            title,
            statusCode: response?.status(),
            consoleMessages,
            pageErrors,
        } satisfies TBrowserVerificationResult;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Executable') && message.includes('doesn')) {
            throw new UsageError(
                `Playwright is installed in ${appRoot}, but the Chromium browser is missing. Run \`npx playwright install chromium\` in that app. Fallback: \`proteum verify request ${target}\`.`,
            );
        }

        throw error;
    } finally {
        await browserContext?.close();
    }
};

const runStaticOwnerVerify = async ({
    manifest,
    orientation,
}: {
    manifest: TProteumManifest;
    orientation: TOrientResponse;
}) => {
    const doctor = buildDoctorResponse(manifest, false);
    const contracts = buildContractsDoctorResponse(manifest, false);
    const { introducedFindings, preExistingFindings } = classifyDiagnostics({
        contracts,
        doctor,
        manifest,
        orientation,
    });

    return finalizeResult({
        action: 'owner',
        target: orientation.query,
        orientation,
        introducedFindings,
        preExistingFindings,
        strictGlobal: cli.args.strictGlobal === true,
        verificationSteps: [
            {
                label: 'Orient Owner',
                status: orientation.owner.matches.length > 0 ? 'passed' : 'failed',
                details: [`owner=${orientation.owner.matches[0]?.label || 'none'}`],
            },
            {
                label: 'Run Local Doctor',
                status: 'passed',
                details: [`doctor=${doctor.summary.errors} errors/${doctor.summary.warnings} warnings`],
            },
            {
                label: 'Run Local Contracts',
                status: 'passed',
                details: [`contracts=${contracts.summary.errors} errors/${contracts.summary.warnings} warnings`],
            },
        ],
    });
};

const runOwnerVerify = async (target: string) => {
    const { manifest, orientation } = await resolveOrientation(target);
    const topOwner = orientation.owner.matches[0];
    if (!topOwner) return await runStaticOwnerVerify({ manifest, orientation });

    if (topOwner.kind === 'command') {
        const server = await ensureFocusedServer(manifest);
        try {
            const execution = (await requestCommandRun(server.baseUrl, topOwner.label)).execution;
            const doctor = buildDoctorResponse(manifest, false);
            const contracts = buildContractsDoctorResponse(manifest, false);
            const findings = classifyDiagnostics({ contracts, doctor, manifest, orientation });
            const introducedFindings = [...findings.introducedFindings];
            if (execution.status === 'error') {
                introducedFindings.push({
                    severity: 'error',
                    blocking: true,
                    code: 'command/runtime-error',
                    message: execution.errorMessage || `Command "${execution.command.path}" failed.`,
                    source: 'command',
                    filepath: execution.command.filepath,
                    sourceLocation: execution.command.sourceLocation,
                });
            }

            return finalizeResult({
                action: 'owner',
                target,
                orientation,
                introducedFindings,
                preExistingFindings: findings.preExistingFindings,
                strictGlobal: cli.args.strictGlobal === true,
                verificationSteps: [
                    {
                        label: 'Orient Owner',
                        status: 'passed',
                        details: [`owner=${topOwner.label}`, `kind=${topOwner.kind}`],
                    },
                    {
                        label: 'Ensure Dev Server',
                        status: 'passed',
                        details: [`startup=${server.startup}`, `baseUrl=${server.baseUrl}`],
                    },
                    {
                        label: 'Run Command',
                        status: execution.status === 'error' ? 'failed' : 'passed',
                        details: [`path=${execution.command.path}`, `status=${execution.status}`, `durationMs=${execution.durationMs}`],
                    },
                ],
            });
        } finally {
            if ('close' in server) server.close();
        }
    }

    const requestTarget =
        target.startsWith('/') ? target : topOwner.kind === 'route' || topOwner.kind === 'controller' ? topOwner.label : undefined;
    if (requestTarget) {
        return await runRequestVerify(requestTarget, orientation, manifest);
    }

    return await runStaticOwnerVerify({ manifest, orientation });
};

const runRequestVerify = async (target: string, existingOrientation?: TOrientResponse, existingManifest?: TProteumManifest) => {
    const manifest = existingManifest || (await resolveLocalManifest());
    const orientation = existingOrientation || buildOrientationResponse(manifest, target);
    const server = await ensureFocusedServer(manifest);
    const method = (typeof cli.args.method === 'string' && cli.args.method ? cli.args.method.trim().toUpperCase() : 'GET') as Method;
    const dataJson = parseDataJson();
    const sessionEmail = typeof cli.args.sessionEmail === 'string' ? cli.args.sessionEmail.trim() : '';
    const sessionRole = typeof cli.args.sessionRole === 'string' ? cli.args.sessionRole.trim() : '';

    try {
        await armTrace(server.baseUrl);
        let session:
            | {
                  cookieHeader: string;
                  playwrightCookies: Array<{
                      name: string;
                      value: string;
                      url: string;
                      expires: number;
                      httpOnly: boolean;
                      secure: boolean;
                      sameSite: 'Lax';
                  }>;
              }
            | undefined;
        if (sessionEmail) {
            session = await requestSession({ baseUrl: server.baseUrl, email: sessionEmail, role: sessionRole });
        }

        const hit = await hitRequest({
            baseUrl: server.baseUrl,
            cookieHeader: session?.cookieHeader,
            dataJson,
            method,
            requestPath: target,
        });
        const diagnose = await requestDiagnose(server.baseUrl, target);
        const findings = classifyDiagnostics({
            contracts: diagnose.contracts,
            doctor: diagnose.doctor,
            manifest,
            orientation,
            chain: diagnose.chain,
        });
        const introducedFindings = [...findings.introducedFindings];

        if (hit.statusCode >= 400) {
            introducedFindings.push({
                severity: 'error',
                blocking: true,
                code: 'request/http-status',
                message: `Request returned status ${hit.statusCode} for ${hit.url}.`,
                source: 'request',
            });
        }

        if (diagnose.request?.errorMessage) {
            introducedFindings.push({
                severity: 'error',
                blocking: true,
                code: 'request/trace-error',
                message: diagnose.request.errorMessage,
                source: 'request',
            });
        }

        return finalizeResult({
            action: existingOrientation ? 'owner' : 'request',
            target,
            orientation,
            introducedFindings,
            preExistingFindings: findings.preExistingFindings,
            strictGlobal: cli.args.strictGlobal === true,
            verificationSteps: [
                {
                    label: 'Orient Target',
                    status: 'passed',
                    details: [`owner=${orientation.owner.matches[0]?.label || 'none'}`],
                },
                {
                    label: 'Ensure Dev Server',
                    status: 'passed',
                    details: [`startup=${server.startup}`, `baseUrl=${server.baseUrl}`],
                },
                {
                    label: 'Arm Trace',
                    status: 'passed',
                    details: ['capture=deep'],
                },
                {
                    label: 'Hit Request',
                    status: hit.statusCode >= 400 ? 'failed' : 'passed',
                    details: [`method=${method}`, `status=${hit.statusCode}`, `url=${hit.url}`],
                },
                {
                    label: 'Collect Diagnose',
                    status: 'passed',
                    details: [
                        `doctor=${diagnose.doctor.summary.errors} errors/${diagnose.doctor.summary.warnings} warnings`,
                        `contracts=${diagnose.contracts.summary.errors} errors/${diagnose.contracts.summary.warnings} warnings`,
                    ],
                },
            ],
        });
    } finally {
        if ('close' in server) server.close();
    }
};

const runBrowserVerify = async (target: string) => {
    const manifest = await resolveLocalManifest();
    const orientation = buildOrientationResponse(manifest, target);
    const server = await ensureFocusedServer(manifest);
    const sessionEmail = typeof cli.args.sessionEmail === 'string' ? cli.args.sessionEmail.trim() : '';
    const sessionRole = typeof cli.args.sessionRole === 'string' ? cli.args.sessionRole.trim() : '';

    try {
        await armTrace(server.baseUrl);
        let session:
            | {
                  cookieHeader: string;
                  playwrightCookies: Array<{
                      name: string;
                      value: string;
                      url: string;
                      expires: number;
                      httpOnly: boolean;
                      secure: boolean;
                      sameSite: 'Lax';
                  }>;
              }
            | undefined;
        if (sessionEmail) {
            session = await requestSession({ baseUrl: server.baseUrl, email: sessionEmail, role: sessionRole });
        }

        const browser = await runBrowserVerification({
            appRoot: manifest.app.root,
            baseUrl: server.baseUrl,
            playwrightCookies: session?.playwrightCookies,
            target,
        });
        const diagnose = await requestDiagnose(server.baseUrl, target);
        const findings = classifyDiagnostics({
            contracts: diagnose.contracts,
            doctor: diagnose.doctor,
            manifest,
            orientation,
            chain: diagnose.chain,
        });
        const introducedFindings = [...findings.introducedFindings];

        if ((browser.statusCode || 0) >= 400) {
            introducedFindings.push({
                severity: 'error',
                blocking: true,
                code: 'browser/http-status',
                message: `Browser navigation returned status ${browser.statusCode} for ${browser.url}.`,
                source: 'browser',
                details: [`workspace=${browser.workspaceRoot}`],
            });
        }

        for (const consoleMessage of browser.consoleMessages) {
            const isError = consoleMessage.type === 'error';
            introducedFindings.push({
                severity: isError ? 'error' : 'warning',
                blocking: isError,
                code: `browser/console-${consoleMessage.type}`,
                message: consoleMessage.text,
                source: 'browser',
                details: [`workspace=${browser.workspaceRoot}`],
            });
        }

        for (const pageError of browser.pageErrors) {
            introducedFindings.push({
                severity: 'error',
                blocking: true,
                code: 'browser/page-error',
                message: pageError,
                source: 'browser',
                details: [`workspace=${browser.workspaceRoot}`],
            });
        }

        return finalizeResult({
            action: 'browser',
            target,
            orientation,
            introducedFindings,
            preExistingFindings: findings.preExistingFindings,
            strictGlobal: cli.args.strictGlobal === true,
            verificationSteps: [
                {
                    label: 'Orient Target',
                    status: 'passed',
                    details: [`owner=${orientation.owner.matches[0]?.label || 'none'}`],
                },
                {
                    label: 'Ensure Dev Server',
                    status: 'passed',
                    details: [`startup=${server.startup}`, `baseUrl=${server.baseUrl}`],
                },
                {
                    label: 'Arm Trace',
                    status: 'passed',
                    details: ['capture=deep'],
                },
                {
                    label: 'Run Browser Verification',
                    status:
                        browser.pageErrors.length > 0 || browser.consoleMessages.some((message) => message.type === 'error') ? 'failed' : 'passed',
                    details: [`status=${browser.statusCode ?? 'unknown'}`, `title=${browser.title || 'untitled'}`, `workspace=${browser.workspaceRoot}`],
                },
                {
                    label: 'Collect Diagnose',
                    status: 'passed',
                    details: [
                        `doctor=${diagnose.doctor.summary.errors} errors/${diagnose.doctor.summary.warnings} warnings`,
                        `contracts=${diagnose.contracts.summary.errors} errors/${diagnose.contracts.summary.warnings} warnings`,
                    ],
                },
            ],
        });
    } finally {
        if ('close' in server) server.close();
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

const runFrameworkChangeVerify = async () => {
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
        const productServer = await ensureServer({
            appRoot: apps.product.appRoot,
            port: apps.product.port,
        });
        if ('close' in productServer) startedServers.push(productServer.close);

        const websiteServer = await ensureServer({
            appRoot: apps.website.appRoot,
            envOverrides: {
                PRODUCT_CONNECTED_SOURCE: `file:${apps.product.appRoot}`,
                PRODUCT_URL_INTERNAL: productServer.baseUrl,
            },
            port: apps.website.port,
        });
        if ('close' in websiteServer) startedServers.push(websiteServer.close);

        const crosspathServer = await ensureServer({
            appRoot: apps.crosspath.appRoot,
            port: apps.crosspath.port,
        });
        if ('close' in crosspathServer) startedServers.push(crosspathServer.close);

        const results = await Promise.all([
            collectAppResult({
                ...apps.crosspath,
                baseUrl: crosspathServer.baseUrl,
                startup: crosspathServer.startup,
            }),
            collectAppResult({
                ...apps.product,
                baseUrl: productServer.baseUrl,
                startup: productServer.startup,
            }),
            collectAppResult({
                ...apps.website,
                baseUrl: websiteServer.baseUrl,
                startup: websiteServer.startup,
            }),
        ]);

        const introducedFindings: TVerifyFinding[] = [];
        for (const app of results) {
            if (app.page.statusCode >= 400) {
                introducedFindings.push({
                    severity: 'error',
                    blocking: true,
                    code: 'framework-change/http-status',
                    message: `${app.name} returned status ${app.page.statusCode} for ${app.page.url}.`,
                    source: 'framework-change',
                    filepath: app.appRoot,
                });
            }
            if (app.doctor.errors > 0) {
                introducedFindings.push({
                    severity: 'error',
                    blocking: true,
                    code: 'framework-change/doctor-errors',
                    message: `${app.name} reported ${app.doctor.errors} doctor errors.`,
                    source: 'framework-change',
                    filepath: app.appRoot,
                });
            }
            if (app.contracts.errors > 0) {
                introducedFindings.push({
                    severity: 'error',
                    blocking: true,
                    code: 'framework-change/contracts-errors',
                    message: `${app.name} reported ${app.contracts.errors} contract errors.`,
                    source: 'framework-change',
                    filepath: app.appRoot,
                });
            }
        }

        return finalizeResult({
            action: 'framework-change',
            apps: results,
            introducedFindings,
            preExistingFindings: [],
            strictGlobal: cli.args.strictGlobal === true,
            verificationSteps: results.map((app) => ({
                label: `Check ${app.name}`,
                status: app.page.statusCode >= 400 || app.doctor.errors > 0 || app.contracts.errors > 0 ? 'failed' : 'passed',
                details: [
                    `startup=${app.startup}`,
                    `page=${app.page.statusCode}`,
                    `doctor=${app.doctor.errors} errors/${app.doctor.warnings} warnings`,
                    `contracts=${app.contracts.errors} errors/${app.contracts.warnings} warnings`,
                ],
            })),
        });
    } finally {
        for (const close of startedServers.reverse()) close();
    }
};

export const run = async () => {
    const action = typeof cli.args.action === 'string' && cli.args.action ? cli.args.action : 'framework-change';
    const target = typeof cli.args.target === 'string' ? cli.args.target.trim() : '';
    let result: TVerifyResult;

    if (action === 'framework-change') {
        result = await runFrameworkChangeVerify();
    } else if (action === 'owner') {
        if (!target) throw new UsageError('`proteum verify owner` requires a query.');
        result = await runOwnerVerify(target);
    } else if (action === 'request') {
        if (!target) throw new UsageError('`proteum verify request` requires a path or absolute URL.');
        result = await runRequestVerify(target);
    } else if (action === 'browser') {
        if (!target) throw new UsageError('`proteum verify browser` requires a path or absolute URL.');
        result = await runBrowserVerify(target);
    } else {
        throw new UsageError(`Unsupported verify action "${action}". Expected framework-change, owner, request, or browser.`);
    }

    if (cli.args.json === true) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(renderHuman(result));
    }

    if (!result.result.ok) {
        process.exitCode = 1;
    }
};
