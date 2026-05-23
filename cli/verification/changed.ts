import cp from 'child_process';
import fs from 'fs';
import path from 'path';

import { type TVerificationCheckScope, type TVerificationConfig, type TVerificationSuiteConfig } from '../../common/applicationConfig';
import { loadVerificationConfig } from '../../common/applicationConfigLoader';

type TChangedFileMode = 'all' | 'base' | 'staged';

export type TChangedVerificationCheck = {
    command: string;
    cwd: string;
    id: string;
    matchedFiles: string[];
    reasons: string[];
    scope: TVerificationCheckScope;
    source: 'builtin' | 'config';
};

export type TChangedVerificationSkippedCheck = {
    id: string;
    matchedFiles: string[];
    reason: string;
};

export type TChangedVerificationExecution = {
    checkId: string;
    command: string;
    cwd: string;
    durationMs: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    status: 'failed' | 'passed';
};

export type TChangedVerificationPlan = {
    changedFiles: string[];
    configFilepath?: string;
    configRoot: string;
    docsOnly: boolean;
    gitRoot: string;
    selectedChecks: TChangedVerificationCheck[];
    skippedChecks: TChangedVerificationSkippedCheck[];
};

export type TChangedVerificationResult = TChangedVerificationPlan & {
    dryRun: boolean;
    executions: TChangedVerificationExecution[];
    result: {
        failedChecks: number;
        ok: boolean;
        selectedChecks: number;
    };
};

type TBuildChangedVerificationPlanOptions = {
    changedFiles?: string[];
    configSearchDir?: string;
    cwd: string;
};

type TRunChangedVerificationOptions = TBuildChangedVerificationPlanOptions & {
    base?: string;
    dryRun?: boolean;
    onPlan?: (plan: TChangedVerificationPlan) => void;
    staged?: boolean;
};

const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const docsOnlyExtensions = new Set(['.feature', '.md', '.mdx', '.rst', '.txt']);
const defaultDocsOnlyReason = 'docs-only changes do not require targeted tests unless a project rule matched.';

const dedupe = <TValue>(values: TValue[]) => [...new Set(values)];
const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');
const quoteShellValue = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const quoteFileList = (files: string[]) => files.map(quoteShellValue).join(' ');

const runGit = (cwd: string, args: string[]) => {
    const result = cp.spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
    });

    if (result.status !== 0) return [];

    return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
};

export const resolveGitRoot = (cwd: string) => {
    const [root] = runGit(cwd, ['rev-parse', '--show-toplevel']);
    return root ? path.resolve(root) : path.resolve(cwd);
};

const fileExistsInRoot = (root: string, relativeFilepath: string) => fs.existsSync(path.join(root, relativeFilepath));

export const discoverChangedFiles = ({
    base,
    cwd,
    staged,
}: {
    base?: string;
    cwd: string;
    staged?: boolean;
}) => {
    const gitRoot = resolveGitRoot(cwd);
    const mode: TChangedFileMode = base ? 'base' : staged ? 'staged' : 'all';
    const changedFiles =
        mode === 'base'
            ? runGit(gitRoot, ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])
            : mode === 'staged'
              ? runGit(gitRoot, ['diff', '--name-only', '--cached', '--diff-filter=ACMR'])
              : [
                    ...runGit(gitRoot, ['diff', '--name-only', '--diff-filter=ACMR']),
                    ...runGit(gitRoot, ['diff', '--name-only', '--cached', '--diff-filter=ACMR']),
                    ...runGit(gitRoot, ['ls-files', '--others', '--exclude-standard']),
                ];

    return dedupe(changedFiles.map(normalizePath)).filter((filepath) => fileExistsInRoot(gitRoot, filepath));
};

const isTestFile = (filepath: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(filepath);
const isRelatedSourceFile = (filepath: string) => {
    if (isTestFile(filepath)) return false;
    if (!sourceExtensions.has(path.extname(filepath))) return false;

    return (
        filepath.startsWith('apps/') ||
        filepath.startsWith('client/') ||
        filepath.startsWith('cli/') ||
        filepath.startsWith('common/') ||
        filepath.startsWith('packages/') ||
        filepath.startsWith('server/') ||
        filepath.includes('/src/')
    );
};

const isDocsOnlyFile = (filepath: string) =>
    filepath === 'AGENTS.md' ||
    filepath === 'README.md' ||
    filepath.startsWith('docs/') ||
    filepath.startsWith('agents/') ||
    docsOnlyExtensions.has(path.extname(filepath));

const normalizeGlob = (glob: string) => normalizePath(glob.trim());

const escapeRegExp = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

const globToRegExp = (glob: string) => {
    const normalized = normalizeGlob(glob);
    let pattern = '';

    for (let index = 0; index < normalized.length; ) {
        if (normalized.slice(index, index + 3) === '**/') {
            pattern += '(?:[^/]+/)*';
            index += 3;
            continue;
        }

        if (normalized.slice(index, index + 2) === '**') {
            pattern += '.*';
            index += 2;
            continue;
        }

        const char = normalized[index];
        pattern += char === '*' ? '[^/]*' : escapeRegExp(char);
        index += 1;
    }

    return new RegExp(`^${pattern}$`);
};

const matchesGlob = (filepath: string, glob: string) => globToRegExp(glob).test(normalizePath(filepath));
const matchFiles = (files: string[], globs: readonly string[]) =>
    files.filter((filepath) => globs.some((glob) => matchesGlob(filepath, glob)));

const getSuiteCommand = (suite: TVerificationSuiteConfig) => (typeof suite === 'string' ? suite : suite.command);
const getSuiteCwd = (suite: TVerificationSuiteConfig, configRoot: string) => {
    if (typeof suite === 'string' || !suite.cwd) return configRoot;
    return path.isAbsolute(suite.cwd) ? suite.cwd : path.resolve(configRoot, suite.cwd);
};
const getSuiteScope = (suite: TVerificationSuiteConfig, fallback: TVerificationCheckScope = 'targeted') =>
    typeof suite === 'string' || !suite.scope ? fallback : suite.scope;

const expandCommand = (command: string, files: string[]) => command.replace(/\{files\}/g, quoteFileList(files));

const hasFilesPlaceholder = (command: string) => command.includes('{files}');

const addCheck = ({
    check,
    selectedChecks,
}: {
    check: TChangedVerificationCheck;
    selectedChecks: TChangedVerificationCheck[];
}) => {
    const existing = selectedChecks.find((entry) => entry.command === check.command && entry.cwd === check.cwd);
    if (!existing) {
        selectedChecks.push(check);
        return;
    }

    existing.matchedFiles = dedupe([...existing.matchedFiles, ...check.matchedFiles]);
    existing.reasons = dedupe([...existing.reasons, ...check.reasons]);
};

const createSuiteCheck = ({
    configRoot,
    files,
    id,
    reason,
    scope,
    source,
    suite,
}: {
    configRoot: string;
    files: string[];
    id: string;
    reason: string;
    scope?: TVerificationCheckScope;
    source: 'builtin' | 'config';
    suite: TVerificationSuiteConfig;
}): TChangedVerificationCheck | undefined => {
    const command = getSuiteCommand(suite);
    if (hasFilesPlaceholder(command) && files.length === 0) return undefined;

    return {
        command: expandCommand(command, files),
        cwd: getSuiteCwd(suite, configRoot),
        id,
        matchedFiles: files,
        reasons: [reason],
        scope: scope || getSuiteScope(suite),
        source,
    };
};

const addConfigSuiteCheck = ({
    config,
    configRoot,
    files,
    id,
    reason,
    run,
    scope,
    selectedChecks,
    skippedChecks,
}: {
    config: TVerificationConfig;
    configRoot: string;
    files: string[];
    id: string;
    reason: string;
    run: string;
    scope?: TVerificationCheckScope;
    selectedChecks: TChangedVerificationCheck[];
    skippedChecks: TChangedVerificationSkippedCheck[];
}) => {
    const suite = config.suites?.[run];
    if (!suite) {
        skippedChecks.push({ id: `${id}:${run}`, matchedFiles: files, reason: `Unknown verification suite "${run}".` });
        return;
    }

    const check = createSuiteCheck({
        configRoot,
        files,
        id: `${id}:${run}`,
        reason,
        scope,
        source: 'config',
        suite,
    });

    if (!check) {
        skippedChecks.push({ id: `${id}:${run}`, matchedFiles: files, reason: `Suite "${run}" requires matched files.` });
        return;
    }

    addCheck({ check, selectedChecks });
};

const getDocsOnlyReason = (config: TVerificationConfig) => {
    if (config.docsOnly === false) return undefined;
    if (typeof config.docsOnly === 'object' && config.docsOnly.reason) return config.docsOnly.reason;
    return defaultDocsOnlyReason;
};

export const buildChangedVerificationPlan = ({
    changedFiles,
    configSearchDir,
    cwd,
}: TBuildChangedVerificationPlanOptions): TChangedVerificationPlan => {
    const gitRoot = resolveGitRoot(cwd);
    const files = dedupe((changedFiles || discoverChangedFiles({ cwd })).map(normalizePath)).filter((filepath) =>
        fileExistsInRoot(gitRoot, filepath),
    );
    const { config, filepath: configFilepath, root: configRoot } = loadVerificationConfig(configSearchDir || cwd);
    const selectedChecks: TChangedVerificationCheck[] = [];
    const skippedChecks: TChangedVerificationSkippedCheck[] = [];
    const docsOnly = files.length > 0 && files.every(isDocsOnlyFile);

    for (const entry of config.always || []) {
        const suite = config.suites?.[entry] || entry;
        const check = createSuiteCheck({
            configRoot,
            files,
            id: `always:${entry}`,
            reason: 'Configured always-run verification.',
            scope: 'static',
            source: 'config',
            suite,
        });

        if (check) addCheck({ check, selectedChecks });
    }

    if (docsOnly) {
        const reason = getDocsOnlyReason(config);
        if (reason) skippedChecks.push({ id: 'builtin:docs-only', matchedFiles: files, reason });
    }

    const changedTestFiles = files.filter(isTestFile);
    if (changedTestFiles.length > 0) {
        const check = createSuiteCheck({
            configRoot: gitRoot,
            files: changedTestFiles,
            id: 'builtin:changed-tests',
            reason: 'Changed test files should run directly.',
            scope: 'targeted',
            source: 'builtin',
            suite: 'npx vitest run {files}',
        });
        if (check) addCheck({ check, selectedChecks });
    }

    const changedSourceFiles = docsOnly ? [] : files.filter(isRelatedSourceFile);
    if (changedSourceFiles.length > 0) {
        const check = createSuiteCheck({
            configRoot: gitRoot,
            files: changedSourceFiles,
            id: 'builtin:related-tests',
            reason: 'Changed source files should run related tests.',
            scope: 'targeted',
            source: 'builtin',
            suite: 'npx vitest related {files}',
        });
        if (check) addCheck({ check, selectedChecks });
    }

    for (const rule of config.rules || []) {
        const matchedFiles = matchFiles(files, rule.match);
        if (matchedFiles.length === 0) continue;

        for (const run of rule.run) {
            addConfigSuiteCheck({
                config,
                configRoot,
                files: matchedFiles,
                id: rule.id,
                reason: rule.reason,
                run,
                scope: rule.scope,
                selectedChecks,
                skippedChecks,
            });
        }
    }

    return {
        changedFiles: files,
        ...(configFilepath ? { configFilepath } : {}),
        configRoot,
        docsOnly,
        gitRoot,
        selectedChecks,
        skippedChecks,
    };
};

const runShellCommand = (check: TChangedVerificationCheck) =>
    new Promise<TChangedVerificationExecution>((resolve) => {
        const startedAt = Date.now();
        const child = cp.spawn(check.command, [], {
            cwd: check.cwd,
            shell: true,
            stdio: 'inherit',
        });

        child.on('error', () => {
            resolve({
                checkId: check.id,
                command: check.command,
                cwd: check.cwd,
                durationMs: Date.now() - startedAt,
                exitCode: 1,
                signal: null,
                status: 'failed',
            });
        });
        child.on('exit', (exitCode, signal) => {
            resolve({
                checkId: check.id,
                command: check.command,
                cwd: check.cwd,
                durationMs: Date.now() - startedAt,
                exitCode,
                signal,
                status: exitCode === 0 && signal === null ? 'passed' : 'failed',
            });
        });
    });

export const runChangedVerification = async ({
    base,
    changedFiles,
    configSearchDir,
    cwd,
    dryRun = false,
    onPlan,
    staged = false,
}: TRunChangedVerificationOptions): Promise<TChangedVerificationResult> => {
    const files = changedFiles || discoverChangedFiles({ base, cwd, staged });
    const plan = buildChangedVerificationPlan({ changedFiles: files, configSearchDir, cwd });
    const executions: TChangedVerificationExecution[] = [];

    if (!dryRun) {
        onPlan?.(plan);
        for (const check of plan.selectedChecks) executions.push(await runShellCommand(check));
    }

    const failedChecks = executions.filter((execution) => execution.status === 'failed').length;

    return {
        ...plan,
        dryRun,
        executions,
        result: {
            failedChecks,
            ok: failedChecks === 0,
            selectedChecks: plan.selectedChecks.length,
        },
    };
};

export const renderChangedVerificationPlan = (plan: TChangedVerificationPlan) =>
    [
        'Changed Verification Plan',
        `- config=${plan.configFilepath || 'none'}`,
        `- changedFiles=${plan.changedFiles.length}`,
        `- selectedChecks=${plan.selectedChecks.length}`,
        `- skippedChecks=${plan.skippedChecks.length}`,
        ...plan.selectedChecks.map(
            (check) =>
                `- [${check.scope}] ${check.id} cwd=${path.relative(plan.gitRoot, check.cwd) || '.'} command=${check.command} reason=${check.reasons.join('; ')}`,
        ),
        ...plan.skippedChecks.map((check) => `- [skipped] ${check.id} reason=${check.reason}`),
    ].join('\n');
