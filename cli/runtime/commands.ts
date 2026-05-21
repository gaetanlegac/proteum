import { Builtins, Cli, Option } from 'clipanion';
import path from 'path';

import cli, { type TArgsObject } from '../context';
import { applyLegacyBooleanArgs, assertNoLegacyArgs } from './argv';
import { buildUsage, ProteumCommand, runCommandModule } from './command';
import { createWorktreeBootstrapBlockResponse, getWorktreeBootstrapStatus } from './worktreeBootstrap';
import { createStartDevCommand, quoteShellPath, resolveProteumAppRootContext } from '../utils/appRoots';
import { printJson } from '../utils/agentOutput';

const createRunInAppCommand = ({
    appRoot,
    baseRoot,
    command,
}: {
    appRoot: string;
    baseRoot: string;
    command: string;
}) => {
    const relativeAppRoot = path.relative(baseRoot, appRoot) || '.';
    if (relativeAppRoot === '.') return command;
    return `cd ${quoteShellPath(relativeAppRoot)} && ${command}`;
};

const printNonAppRootResponse = ({
    commandName,
    cwd,
}: {
    commandName: 'dev' | 'runtime';
    cwd: string;
}) => {
    const context = resolveProteumAppRootContext(cwd);
    const appCandidates = context.appCandidates;
    const commandLabel = commandName === 'dev' ? 'Dev' : 'Runtime Status';

    printJson({
        ok: false,
        format: 'proteum-agent-v1',
        summary:
            appCandidates.length > 0
                ? `${cwd} is a Proteum workspace wrapper or nested directory, not an app root. Found ${appCandidates.length} app candidate${appCandidates.length === 1 ? '' : 's'}.`
                : `${cwd} is not a Proteum app root.`,
        data: {
            cwd: context.cwd,
            appCandidates,
        },
        nextActions: appCandidates.map((candidate) => ({
            label: `${commandLabel}: ${candidate.relativeAppRoot || candidate.appRoot}`,
            command:
                commandName === 'dev'
                    ? createStartDevCommand({
                          appRoot: candidate.appRoot,
                          baseRoot: context.cwd,
                          port: candidate.manifest?.routerPort,
                      })
                    : createRunInAppCommand({
                          appRoot: candidate.appRoot,
                          baseRoot: context.cwd,
                          command: 'npx proteum runtime status',
                      }),
            reason:
                commandName === 'dev'
                    ? 'Start Proteum dev from the app root, not the workspace wrapper.'
                    : 'Inspect tracked runtime sessions from the app root, not the workspace wrapper.',
        })),
    });
    process.exitCode = 1;
};

const isCurrentWorkdirProteumAppRoot = () => resolveProteumAppRootContext(String(cli.args.workdir || process.cwd())).isAppRoot;

const blockIfWorktreeBootstrapRequired = () => {
    const status = getWorktreeBootstrapStatus({
        appRoot: cli.paths.appRoot,
        proteumVersion: String(cli.packageJson.version || ''),
    });

    if (!status.blocking) return false;

    printJson(createWorktreeBootstrapBlockResponse(status));
    process.exitCode = 1;
    return true;
};

class InitCommand extends ProteumCommand {
    public static paths = [['init']];

    public static usage = buildUsage('init');

    public name = Option.String('--name', { description: 'Human-readable app name.' });
    public description = Option.String('--description', { description: 'App description used in identity.config.ts and package.json.' });
    public identifier = Option.String('--identifier', { description: 'Application class and identity identifier.' });
    public port = Option.String('--port', { description: 'Default local router port used in .env.' });
    public url = Option.String('--url', { description: 'Default absolute URL used in .env.' });
    public proteumVersion = Option.String('--proteum-version', {
        description: 'Override the Proteum dependency written to package.json.',
    });
    public install = Option.Boolean('--install', false, { description: 'Run npm install after scaffolding.' });
    public dryRun = Option.Boolean('--dry-run', false, { description: 'Print the scaffold plan without writing files.' });
    public json = Option.Boolean('--json', false, { description: 'Print machine-readable scaffold output.' });
    public force = Option.Boolean('--force', false, { description: 'Allow writing into a non-empty target directory.' });
    public args = Option.Rest();

    public async execute() {
        const [directory = ''] = this.args;

        this.setCliArgs({
            directory,
            name: this.name ?? '',
            description: this.description ?? '',
            identifier: this.identifier ?? '',
            port: this.port ?? '',
            url: this.url ?? '',
            proteumVersion: this.proteumVersion ?? '',
            install: this.install,
            dryRun: this.dryRun,
            json: this.json,
            force: this.force,
        });
        await runCommandModule(() => import('../commands/init'));
    }
}

class CreateCommand extends ProteumCommand {
    public static paths = [['create']];

    public static usage = buildUsage('create');

    public route = Option.String('--route', { description: 'Explicit URL path used for page or route scaffolds.' });
    public method = Option.String('--method', { description: 'Method name used for controller or command scaffolds.' });
    public httpMethod = Option.String('--http-method', { description: 'HTTP verb used for route scaffolds.' });
    public json = Option.Boolean('--json', false, { description: 'Print machine-readable scaffold output.' });
    public dryRun = Option.Boolean('--dry-run', false, { description: 'Print the scaffold plan without writing files.' });
    public force = Option.Boolean('--force', false, { description: 'Allow overwriting generated target files.' });
    public args = Option.Rest();

    public async execute() {
        const [kind = '', target = ''] = this.args;

        this.setCliArgs({
            kind,
            target,
            route: this.route ?? '',
            method: this.method ?? '',
            httpMethod: this.httpMethod ?? '',
            json: this.json,
            dryRun: this.dryRun,
            force: this.force,
        });

        await runCommandModule(() => import('../commands/create'));
    }
}

class ConfigureCommand extends ProteumCommand {
    public static paths = [['configure']];

    public static usage = buildUsage('configure');

    public args = Option.Rest();

    public async execute() {
        const [action = '', ...restArgs] = this.args;

        assertNoLegacyArgs('configure', restArgs);
        this.setCliArgs({
            action,
        });
        await runCommandModule(() => import('../commands/configure'));
    }
}

class WorktreeCommand extends ProteumCommand {
    public static paths = [['worktree']];

    public static usage = buildUsage('worktree');

    public source = Option.String('--source', { description: 'Source Proteum app root used for .env copy and worktree creation.' });
    public branch = Option.String('--branch', { description: 'Branch name created by `worktree create`.' });
    public base = Option.String('--base', { description: 'Base ref used by `worktree create`.' });
    public refresh = Option.Boolean('--refresh', false, { description: 'Refresh an existing stale bootstrap marker.' });
    public skipDeps = Option.Boolean('--skip-deps', false, { description: 'Skip dependency install while recording an explicit reason.' });
    public reason = Option.String('--reason', { description: 'Reason required when --skip-deps is used.' });
    public json = Option.Boolean('--json', false, { description: 'Print machine-readable worktree bootstrap output.' });
    public args = Option.Rest();

    public async execute() {
        const [action = '', target = ''] = this.args;

        this.setCliArgs({
            action,
            base: this.base ?? '',
            branch: this.branch ?? '',
            json: this.json,
            reason: this.reason ?? '',
            refresh: this.refresh,
            skipDeps: this.skipDeps,
            source: this.source ?? '',
            target,
        });
        await runCommandModule(() => import('../commands/worktree'));
    }
}

class DevCommand extends ProteumCommand {
    public static paths = [['dev']];

    public static usage = buildUsage('dev');

    public cwd = Option.String('--cwd', { description: 'Run the dev command against another Proteum app root.' });
    public json = Option.Boolean('--json', false, { description: 'Print machine-readable dev session output.' });
    public port = Option.String('--port', { description: 'Override the router port.' });
    public cache = Option.Boolean('--cache', true, { description: 'Enable filesystem caching.' });
    public sessionFile = Option.String('--session-file', {
        description: 'Override the dev session file path used for list, stop, or the active dev server.',
    });
    public replaceExisting = Option.Boolean('--replace-existing', false, {
        description: 'Stop the existing matching dev session before starting a new one.',
    });
    public all = Option.Boolean('--all', false, {
        description: 'When used with `dev stop`, stop every tracked dev session for the current app root.',
    });
    public stale = Option.Boolean('--stale', false, {
        description: 'Filter `dev list` or `dev stop --all` to stale tracked sessions only.',
    });
    public args = Option.Rest();

    public async execute() {
        const [maybeAction = '', ...restArgs] = this.args;
        const action = maybeAction === 'list' || maybeAction === 'stop' ? maybeAction : '';

        assertNoLegacyArgs('dev', action ? restArgs : this.args);
        this.setCliArgs({
            action: action || 'start',
            port: this.port ?? '',
            cache: this.cache,
            workdir: this.cwd ?? '',
            json: this.json,
            sessionFile: this.sessionFile ?? '',
            replaceExisting: this.replaceExisting,
            all: this.all,
            stale: this.stale,
        });
        if (!isCurrentWorkdirProteumAppRoot()) {
            printNonAppRootResponse({ commandName: 'dev', cwd: String(cli.args.workdir || process.cwd()) });
            return 1;
        }
        if (action !== 'stop' && blockIfWorktreeBootstrapRequired()) return 1;
        await runCommandModule(() => import('../commands/dev'));
    }
}

class RefreshCommand extends ProteumCommand {
    public static paths = [['refresh']];

    public static usage = buildUsage('refresh');

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('refresh', this.legacyArgs);
        this.setCliArgs();
        if (blockIfWorktreeBootstrapRequired()) return 1;
        await runCommandModule(() => import('../commands/refresh'));
    }
}

class BuildCommand extends ProteumCommand {
    public static paths = [['build']];

    public static usage = buildUsage('build');

    public port = Option.String('--port', { description: 'Override the router port.' });
    public prod = Option.Boolean('--prod', false, { description: 'Build in production mode.' });
    public cache = Option.Boolean('--cache', false, { description: 'Enable filesystem caching during the build.' });
    public analyze = Option.Boolean('--analyze', false, { description: 'Emit the client bundle analysis report.' });
    public analyzeServe = Option.Boolean('--analyze-serve', false, {
        description: 'Serve the bundle analysis over HTTP instead of only writing a static report.',
    });
    public analyzeHost = Option.String('--analyze-host', {
        description: 'Host used by the analyzer HTTP server when `--analyze-serve` is enabled.',
    });
    public analyzePort = Option.String('--analyze-port', {
        description: 'Port used by the analyzer HTTP server when `--analyze-serve` is enabled. Use `auto` for an ephemeral port.',
    });
    public strict = Option.Boolean('--strict', false, {
        description: 'Refresh generated typings and fail the build if TypeScript reports any error.',
    });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = {
            port: this.port ?? '',
            dev: false,
            prod: this.prod,
            cache: this.cache,
            analyze: this.analyze,
            analyzeServe: this.analyzeServe,
            analyzeHost: this.analyzeHost ?? '',
            analyzePort: this.analyzePort ?? '',
            strict: this.strict,
        } satisfies TArgsObject;

        applyLegacyBooleanArgs('build', this.legacyArgs, ['prod', 'cache', 'analyze', 'strict'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/build'));
    }
}

class TypecheckCommand extends ProteumCommand {
    public static paths = [['typecheck']];

    public static usage = buildUsage('typecheck');

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('typecheck', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('../commands/typecheck'));
    }
}

class LintCommand extends ProteumCommand {
    public static paths = [['lint']];

    public static usage = buildUsage('lint');

    public fix = Option.Boolean('--fix', false, { description: 'Apply fixable lint changes.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { fix: this.fix } satisfies TArgsObject;

        applyLegacyBooleanArgs('lint', this.legacyArgs, ['fix'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/lint'));
    }
}

class CheckCommand extends ProteumCommand {
    public static paths = [['check']];

    public static usage = buildUsage('check');

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('check', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('../commands/check'));
    }
}

class E2eCommand extends ProteumCommand {
    public static paths = [['e2e']];

    public static usage = buildUsage('e2e');

    public cwd = Option.String('--cwd', { description: 'Run Playwright against another Proteum app root.' });
    public port = Option.String('--port', { description: 'Set E2E_BASE_URL from a local router port.' });
    public url = Option.String('--url', { description: 'Set E2E_BASE_URL from an explicit base URL.' });
    public sessionEmail = Option.String('--session-email', {
        description: 'Mint a dev session before Playwright starts and pass it as E2E_AUTH_TOKEN.',
    });
    public sessionRole = Option.String('--session-role', { description: 'Require the dev session user to have this role.' });
    public env = Option.Array('--env', [], { description: 'Pass an environment value to Playwright as KEY=value.' });
    public envFile = Option.Array('--env-file', [], { description: 'Load environment values from a dotenv file before Playwright starts.' });
    public config = Option.String('--config', { description: 'Playwright config file.' });
    public debug = Option.Boolean('--debug', false, { description: 'Run Playwright in debug mode.' });
    public grep = Option.String('--grep', { description: 'Playwright grep filter.' });
    public headed = Option.Boolean('--headed', false, { description: 'Run browsers in headed mode.' });
    public list = Option.Boolean('--list', false, { description: 'List Playwright tests without running them.' });
    public project = Option.Array('--project', [], { description: 'Playwright project name. Can be repeated.' });
    public reporter = Option.String('--reporter', { description: 'Playwright reporter.' });
    public retries = Option.String('--retries', { description: 'Playwright retry count.' });
    public timeout = Option.String('--timeout', { description: 'Playwright per-test timeout.' });
    public ui = Option.Boolean('--ui', false, { description: 'Run Playwright in UI mode.' });
    public workers = Option.String('--workers', { description: 'Playwright worker count.' });
    public specs = Option.Rest();

    public async execute() {
        const playwrightArgs = [
            ...(this.config ? ['--config', this.config] : []),
            ...(this.debug ? ['--debug'] : []),
            ...(this.grep ? ['--grep', this.grep] : []),
            ...(this.headed ? ['--headed'] : []),
            ...(this.list ? ['--list'] : []),
            ...this.project.flatMap((project) => ['--project', project]),
            ...(this.reporter ? ['--reporter', this.reporter] : []),
            ...(this.retries ? ['--retries', this.retries] : []),
            ...(this.timeout ? ['--timeout', this.timeout] : []),
            ...(this.ui ? ['--ui'] : []),
            ...(this.workers ? ['--workers', this.workers] : []),
            ...this.specs,
        ];

        this.setCliArgs({
            env: this.env,
            envFile: this.envFile,
            playwrightArgs,
            port: this.port ?? '',
            sessionEmail: this.sessionEmail ?? '',
            sessionRole: this.sessionRole ?? '',
            url: this.url ?? '',
            workdir: this.cwd ?? '',
        });
        return await runCommandModule(() => import('../commands/e2e'));
    }
}

class ConnectCommand extends ProteumCommand {
    public static paths = [['connect']];

    public static usage = buildUsage('connect');

    public controllers = Option.Boolean('--controllers', false, {
        description: 'Include imported connected controllers in the output.',
    });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full connect payload.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable report.' });
    public strict = Option.Boolean('--strict', false, { description: 'Exit with failure if any connect diagnostics exist.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { controllers: this.controllers, full: this.full, human: this.human, json: this.json, strict: this.strict } satisfies TArgsObject;

        applyLegacyBooleanArgs('connect', this.legacyArgs, ['controllers', 'full', 'human', 'json', 'strict'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/connect'));
    }
}

class DoctorCommand extends ProteumCommand {
    public static paths = [['doctor']];

    public static usage = buildUsage('doctor');

    public contracts = Option.Boolean('--contracts', false, {
        description: 'Run contract-focused diagnostics for generated artifacts and manifest-owned source files.',
    });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full doctor payload.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable report.' });
    public strict = Option.Boolean('--strict', false, { description: 'Exit with failure if any diagnostics exist.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { contracts: this.contracts, full: this.full, human: this.human, json: this.json, strict: this.strict } satisfies TArgsObject;

        applyLegacyBooleanArgs('doctor', this.legacyArgs, ['contracts', 'full', 'human', 'json', 'strict'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/doctor'));
    }
}

class ExplainCommand extends ProteumCommand {
    public static paths = [['explain']];

    public static usage = buildUsage('explain');

    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full selected machine-readable detail.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable report.' });
    public manifest = Option.Boolean('--manifest', false, { description: 'Print the full generated manifest.' });
    public all = Option.Boolean('--all', false, { description: 'Summarize every explain section; add --full for raw arrays.' });
    public app = Option.Boolean('--app', false, { description: 'Summarize the app section; add --full for raw detail.' });
    public conventions = Option.Boolean('--conventions', false, { description: 'Summarize the conventions section; add --full for raw detail.' });
    public env = Option.Boolean('--env', false, { description: 'Summarize the env section; add --full for raw detail.' });
    public connected = Option.Boolean('--connected', false, { description: 'Summarize the connected-projects section; add --full for raw detail.' });
    public services = Option.Boolean('--services', false, { description: 'Summarize the services section; add --full for raw detail.' });
    public controllers = Option.Boolean('--controllers', false, { description: 'Summarize the controllers section; add --full for raw detail.' });
    public commands = Option.Boolean('--commands', false, { description: 'Summarize the commands section; add --full for raw detail.' });
    public routes = Option.Boolean('--routes', false, { description: 'Summarize the routes section; add --full for raw detail.' });
    public layouts = Option.Boolean('--layouts', false, { description: 'Summarize the layouts section; add --full for raw detail.' });
    public diagnostics = Option.Boolean('--diagnostics', false, {
        description: 'Summarize the diagnostics section; add --full for raw detail.',
    });
    public args = Option.Rest();

    public async execute() {
        const [mode = '', ...restArgs] = this.args;
        if (mode === 'owner') {
            this.setCliArgs({
                json: this.json,
                full: this.full,
                human: this.human,
                manifest: this.manifest,
                ownerQuery: restArgs.join(' ').trim(),
            });
            await runCommandModule(() => import('../commands/explain'));
            return;
        }

        const args = {
            json: this.json,
            full: this.full,
            human: this.human,
            manifest: this.manifest,
            all: this.all,
            app: this.app,
            conventions: this.conventions,
            connected: this.connected,
            env: this.env,
            services: this.services,
            controllers: this.controllers,
            commands: this.commands,
            routes: this.routes,
            layouts: this.layouts,
            diagnostics: this.diagnostics,
        } satisfies TArgsObject;

        applyLegacyBooleanArgs(
            'explain',
            this.args,
            ['json', 'full', 'human', 'manifest', 'all', 'app', 'conventions', 'env', 'connected', 'services', 'controllers', 'commands', 'routes', 'layouts', 'diagnostics'],
            args,
        );
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/explain'));
    }
}

class OrientCommand extends ProteumCommand {
    public static paths = [['orient']];

    public static usage = buildUsage('orient');

    public port = Option.String('--port', { description: 'Target an existing dev server on the given port.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL.' });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full orientation payload.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable report.' });
    public args = Option.Rest();

    public async execute() {
        const query = this.args.join(' ').trim();

        this.setCliArgs({
            json: this.json,
            full: this.full,
            human: this.human,
            port: this.port ?? '',
            query,
            url: this.url ?? '',
        });

        await runCommandModule(() => import('../commands/orient'));
    }
}

class TraceCommand extends ProteumCommand {
    public static paths = [['trace']];

    public static usage = buildUsage('trace');

    public port = Option.String('--port', { description: 'Override the router port used to query the running dev server.' });
    public url = Option.String('--url', { description: 'Override the full base URL used to query the running dev server.' });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full trace response.' });
    public events = Option.Boolean('--events', false, { description: 'Include full event, call, SQL, and payload detail.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable trace report.' });
    public capture = Option.String('--capture', { description: 'Capture mode used by `proteum trace arm`.' });
    public output = Option.String('--output', { description: 'Output filepath used by `proteum trace export`.' });
    public args = Option.Rest();

    public async execute() {
        const [action = 'latest', id = ''] = this.args;

        this.setCliArgs({
            action,
            id,
            port: this.port ?? '',
            url: this.url ?? '',
            json: this.json,
            full: this.full,
            events: this.events,
            human: this.human,
            capture: this.capture ?? '',
            output: this.output ?? '',
        });

        await runCommandModule(() => import('../commands/trace'));
    }
}

class CommandCommand extends ProteumCommand {
    public static paths = [['command']];

    public static usage = buildUsage('command');

    public port = Option.String('--port', { description: 'Target an existing dev server on the given port.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL.' });
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public args = Option.Rest();

    public async execute() {
        const [path = ''] = this.args;

        this.setCliArgs({
            path,
            port: this.port ?? '',
            url: this.url ?? '',
            json: this.json,
        });

        await runCommandModule(() => import('../commands/command'));
    }
}

class SessionCommand extends ProteumCommand {
    public static paths = [['session']];

    public static usage = buildUsage('session');

    public role = Option.String('--role', { description: 'Require the resolved user to have the given role.' });
    public port = Option.String('--port', { description: 'Target an existing dev server on the given port.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL.' });
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public args = Option.Rest();

    public async execute() {
        const [email = ''] = this.args;

        this.setCliArgs({
            email,
            role: this.role ?? '',
            port: this.port ?? '',
            url: this.url ?? '',
            json: this.json,
        });

        await runCommandModule(() => import('../commands/session'));
    }
}

class DiagnoseCommand extends ProteumCommand {
    public static paths = [['diagnose']];

    public static usage = buildUsage('diagnose');

    public port = Option.String('--port', { description: 'Target an existing dev server on the given port.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL.' });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full diagnose payload.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable report.' });
    public hit = Option.String('--hit', { description: 'Issue one HTTP request before diagnosing. Defaults to the target path when it starts with /.' });
    public method = Option.String('--method', { description: 'HTTP method used with `--hit`.' });
    public dataJson = Option.String('--data-json', { description: 'JSON request body used with `--hit`.' });
    public sessionEmail = Option.String('--session-email', {
        description: 'Mint a dev session before `--hit` and attach the returned cookie.',
    });
    public sessionRole = Option.String('--session-role', { description: 'Require the dev session user to have this role.' });
    public capture = Option.String('--capture', { description: 'Trace capture mode armed before `--hit`.' });
    public logsLevel = Option.String('--logs-level', { description: 'Minimum server log level included in the diagnose response.' });
    public logsLimit = Option.String('--logs-limit', { description: 'Maximum number of server log lines included in the diagnose response.' });
    public args = Option.Rest();

    public async execute() {
        const [target = ''] = this.args;

        this.setCliArgs({
            capture: this.capture ?? '',
            dataJson: this.dataJson ?? '',
            hit: this.hit ?? '',
            json: this.json,
            full: this.full,
            human: this.human,
            logsLevel: this.logsLevel ?? '',
            logsLimit: this.logsLimit ?? '',
            method: this.method ?? '',
            port: this.port ?? '',
            sessionEmail: this.sessionEmail ?? '',
            sessionRole: this.sessionRole ?? '',
            target,
            url: this.url ?? '',
        });

        await runCommandModule(() => import('../commands/diagnose'));
    }
}

class PerfCommand extends ProteumCommand {
    public static paths = [['perf']];

    public static usage = buildUsage('perf');

    public port = Option.String('--port', { description: 'Target an existing dev server on the given port.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL.' });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full perf payload.' });
    public human = Option.Boolean('--human', false, { description: 'Print the legacy human-readable report.' });
    public since = Option.String('--since', { description: 'Window used by `top` and `memory`, for example `today`, `yesterday`, or `1h`.' });
    public baseline = Option.String('--baseline', { description: 'Baseline window used by `compare`.' });
    public target = Option.String('--target', { description: 'Target window used by `compare`.' });
    public groupBy = Option.String('--group-by', { description: 'Aggregate by `path`, `route`, or `controller`.' });
    public limit = Option.String('--limit', { description: 'Maximum number of rows to print.' });
    public args = Option.Rest();

    public async execute() {
        const [action = 'top', target = ''] = this.args;

        this.setCliArgs({
            action,
            baseline: this.baseline ?? '',
            groupBy: this.groupBy ?? '',
            json: this.json,
            full: this.full,
            human: this.human,
            limit: this.limit ?? '',
            port: this.port ?? '',
            since: this.since ?? '',
            target,
            targetWindow: this.target ?? '',
            url: this.url ?? '',
        });

        await runCommandModule(() => import('../commands/perf'));
    }
}

class DbCommand extends ProteumCommand {
    public static paths = [['db']];

    public static usage = buildUsage('db');

    public port = Option.String('--port', { description: 'Target an existing dev server on the given port.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL.' });
    public limit = Option.String('--limit', { description: 'Maximum number of result rows to return, up to 500.' });
    public timeout = Option.String('--timeout', { description: 'Database query timeout in milliseconds, up to 30000.' });
    public json = Option.Boolean('--json', false, { description: 'Compatibility flag; compact JSON is the default output.' });
    public full = Option.Boolean('--full', false, { description: 'Print the full database query payload.' });
    public args = Option.Rest();

    public async execute() {
        const [first = '', ...restArgs] = this.args;
        const sql = first === 'query' ? restArgs.join(' ').trim() : [first, ...restArgs].join(' ').trim();

        this.setCliArgs({
            action: 'query',
            full: this.full,
            json: this.json,
            limit: this.limit ?? '',
            port: this.port ?? '',
            sql,
            timeout: this.timeout ?? '',
            url: this.url ?? '',
        });

        await runCommandModule(() => import('../commands/db'));
    }
}

class RuntimeCommand extends ProteumCommand {
    public static paths = [['runtime']];

    public static usage = buildUsage('runtime');

    public full = Option.Boolean('--full', false, { description: 'Print full tracked-session and health detail.' });
    public manifest = Option.Boolean('--manifest', false, {
        description: 'Unsupported compatibility guard. Use `proteum explain --manifest` instead.',
    });
    public sessionFile = Option.String('--session-file', {
        description: 'Inspect one explicit dev session file instead of the app registry.',
    });
    public args = Option.Rest();

    public async execute() {
        const [action = 'status'] = this.args;

        this.setCliArgs({
            action,
            full: this.full,
            manifest: this.manifest,
            sessionFile: this.sessionFile ?? '',
        });

        if (this.manifest) {
            printJson({
                ok: false,
                format: 'proteum-agent-v1',
                summary: '`proteum runtime status --manifest` is not supported. Use `proteum explain --manifest` from the app root.',
                data: {
                    command: 'proteum runtime status --manifest',
                },
                nextActions: [
                    {
                        label: 'Explain Manifest',
                        command: 'npx proteum explain --manifest',
                        reason: 'The generated manifest belongs to the explain command, not runtime status.',
                    },
                ],
            });
            process.exitCode = 1;
            return 1;
        }

        if (!isCurrentWorkdirProteumAppRoot()) {
            printNonAppRootResponse({ commandName: 'runtime', cwd: String(cli.args.workdir || process.cwd()) });
            return 1;
        }

        if (blockIfWorktreeBootstrapRequired()) return 1;
        await runCommandModule(() => import('../commands/runtime'));
    }
}

class McpCommand extends ProteumCommand {
    public static paths = [['mcp']];

    public static usage = buildUsage('mcp');

    public daemon = Option.Boolean('--daemon', false, {
        description: 'Run the managed machine-scope MCP daemon over local HTTP.',
    });
    public stdio = Option.Boolean('--stdio', false, {
        description: 'Force stdio MCP transport for an MCP client.',
    });
    public port = Option.String('--port', {
        description: 'Port for the managed machine MCP daemon.',
    });
    public json = Option.Boolean('--json', false, {
        description: 'Print machine-readable daemon status output.',
    });
    public args = Option.Rest();

    public async execute() {
        const [action = 'start', ...restArgs] = this.args;

        assertNoLegacyArgs('mcp', restArgs);
        this.setCliArgs({
            action,
            daemon: this.daemon,
            stdio: this.stdio,
            port: this.port ?? '',
            json: this.json,
        });

        await runCommandModule(() => import('../commands/mcp'));
    }
}

class VerifyCommand extends ProteumCommand {
    public static paths = [['verify']];

    public static usage = buildUsage('verify');

    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public port = Option.String('--port', { description: 'Target an existing dev server on the given port for focused verify actions.' });
    public url = Option.String('--url', { description: 'Target an existing dev server at the given base URL for focused verify actions.' });
    public sessionEmail = Option.String('--session-email', {
        description: 'Mint a dev session before request or browser verification and attach the returned cookie.',
    });
    public sessionRole = Option.String('--session-role', { description: 'Require the dev session user to have this role.' });
    public method = Option.String('--method', { description: 'HTTP method used by request verification.' });
    public dataJson = Option.String('--data-json', { description: 'JSON request body used by request verification.' });
    public strictGlobal = Option.Boolean('--strict-global', false, {
        description: 'Fail focused verification when unrelated pre-existing blocking findings exist.',
    });
    public crosspath = Option.String('--crosspath', { description: 'Override the CrossPath reference app path.' });
    public product = Option.String('--product', { description: 'Override the Unique Domains Product reference app path.' });
    public website = Option.String('--website', { description: 'Override the Unique Domains Website reference app path.' });
    public crosspathPort = Option.String('--crosspath-port', { description: 'Port used for the CrossPath validation server.' });
    public productPort = Option.String('--product-port', {
        description: 'Port used for the Unique Domains Product validation server.',
    });
    public websitePort = Option.String('--website-port', {
        description: 'Port used for the Unique Domains Website validation server.',
    });
    public route = Option.String('--route', { description: 'Route loaded in both apps during validation.' });
    public args = Option.Rest();

    public async execute() {
        const [action = 'framework-change', ...restArgs] = this.args;
        const target = restArgs.join(' ').trim();

        this.setCliArgs({
            action,
            crosspath: this.crosspath ?? '',
            crosspathPort: this.crosspathPort ?? '',
            dataJson: this.dataJson ?? '',
            json: this.json,
            method: this.method ?? '',
            port: this.port ?? '',
            product: this.product ?? '',
            productPort: this.productPort ?? '',
            route: this.route ?? '',
            sessionEmail: this.sessionEmail ?? '',
            sessionRole: this.sessionRole ?? '',
            strictGlobal: this.strictGlobal,
            target,
            url: this.url ?? '',
            website: this.website ?? '',
            websitePort: this.websitePort ?? '',
        });

        if (blockIfWorktreeBootstrapRequired()) return 1;
        await runCommandModule(() => import('../commands/verify'));
    }
}

export const registeredCommands = {
    init: InitCommand,
    create: CreateCommand,
    configure: ConfigureCommand,
    worktree: WorktreeCommand,
    dev: DevCommand,
    refresh: RefreshCommand,
    build: BuildCommand,
    typecheck: TypecheckCommand,
    lint: LintCommand,
    check: CheckCommand,
    e2e: E2eCommand,
    connect: ConnectCommand,
    doctor: DoctorCommand,
    explain: ExplainCommand,
    orient: OrientCommand,
    diagnose: DiagnoseCommand,
    perf: PerfCommand,
    db: DbCommand,
    runtime: RuntimeCommand,
    mcp: McpCommand,
    trace: TraceCommand,
    command: CommandCommand,
    session: SessionCommand,
    verify: VerifyCommand,
} as const;

export const createCli = (version: string) => {
    const clipanion = new Cli({
        binaryLabel: 'Proteum',
        binaryName: 'proteum',
        binaryVersion: version,
    });

    clipanion.register(Builtins.HelpCommand);
    clipanion.register(Builtins.VersionCommand);
    clipanion.register(Builtins.DefinitionsCommand);
    clipanion.register(InitCommand);
    clipanion.register(CreateCommand);
    clipanion.register(ConfigureCommand);
    clipanion.register(WorktreeCommand);
    clipanion.register(DevCommand);
    clipanion.register(RefreshCommand);
    clipanion.register(BuildCommand);
    clipanion.register(TypecheckCommand);
    clipanion.register(LintCommand);
    clipanion.register(CheckCommand);
    clipanion.register(E2eCommand);
    clipanion.register(ConnectCommand);
    clipanion.register(DoctorCommand);
    clipanion.register(ExplainCommand);
    clipanion.register(OrientCommand);
    clipanion.register(DiagnoseCommand);
    clipanion.register(PerfCommand);
    clipanion.register(DbCommand);
    clipanion.register(RuntimeCommand);
    clipanion.register(McpCommand);
    clipanion.register(TraceCommand);
    clipanion.register(CommandCommand);
    clipanion.register(SessionCommand);
    clipanion.register(VerifyCommand);

    return clipanion;
};
