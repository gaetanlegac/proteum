import { Builtins, Cli, Option } from 'clipanion';

import type { TArgsObject } from '../context';
import { applyLegacyBooleanArgs, assertNoLegacyArgs } from './argv';
import { buildUsage, ProteumCommand, runCommandModule } from './command';

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

class DevCommand extends ProteumCommand {
    public static paths = [['dev']];

    public static usage = buildUsage('dev');

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
            json: this.json,
            sessionFile: this.sessionFile ?? '',
            replaceExisting: this.replaceExisting,
            all: this.all,
            stale: this.stale,
        });
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

class ConnectCommand extends ProteumCommand {
    public static paths = [['connect']];

    public static usage = buildUsage('connect');

    public controllers = Option.Boolean('--controllers', false, {
        description: 'Include imported connected controllers in the output.',
    });
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public strict = Option.Boolean('--strict', false, { description: 'Exit with failure if any connect diagnostics exist.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { controllers: this.controllers, json: this.json, strict: this.strict } satisfies TArgsObject;

        applyLegacyBooleanArgs('connect', this.legacyArgs, ['controllers', 'json', 'strict'], args);
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
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public strict = Option.Boolean('--strict', false, { description: 'Exit with failure if any diagnostics exist.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { contracts: this.contracts, json: this.json, strict: this.strict } satisfies TArgsObject;

        applyLegacyBooleanArgs('doctor', this.legacyArgs, ['contracts', 'json', 'strict'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/doctor'));
    }
}

class ExplainCommand extends ProteumCommand {
    public static paths = [['explain']];

    public static usage = buildUsage('explain');

    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public all = Option.Boolean('--all', false, { description: 'Include every explain section.' });
    public app = Option.Boolean('--app', false, { description: 'Include the app section.' });
    public conventions = Option.Boolean('--conventions', false, { description: 'Include the conventions section.' });
    public env = Option.Boolean('--env', false, { description: 'Include the env section.' });
    public connected = Option.Boolean('--connected', false, { description: 'Include the connected-projects section.' });
    public services = Option.Boolean('--services', false, { description: 'Include the services section.' });
    public controllers = Option.Boolean('--controllers', false, { description: 'Include the controllers section.' });
    public commands = Option.Boolean('--commands', false, { description: 'Include the commands section.' });
    public routes = Option.Boolean('--routes', false, { description: 'Include the routes section.' });
    public layouts = Option.Boolean('--layouts', false, { description: 'Include the layouts section.' });
    public diagnostics = Option.Boolean('--diagnostics', false, {
        description: 'Include the diagnostics section.',
    });
    public args = Option.Rest();

    public async execute() {
        const [mode = '', ...restArgs] = this.args;
        if (mode === 'owner') {
            this.setCliArgs({
                json: this.json,
                ownerQuery: restArgs.join(' ').trim(),
            });
            await runCommandModule(() => import('../commands/explain'));
            return;
        }

        const args = {
            json: this.json,
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
            ['json', 'all', 'app', 'conventions', 'env', 'connected', 'services', 'controllers', 'commands', 'routes', 'layouts', 'diagnostics'],
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
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public args = Option.Rest();

    public async execute() {
        const query = this.args.join(' ').trim();

        this.setCliArgs({
            json: this.json,
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
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
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
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
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
    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
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

        await runCommandModule(() => import('../commands/verify'));
    }
}

export const registeredCommands = {
    init: InitCommand,
    create: CreateCommand,
    dev: DevCommand,
    refresh: RefreshCommand,
    build: BuildCommand,
    typecheck: TypecheckCommand,
    lint: LintCommand,
    check: CheckCommand,
    connect: ConnectCommand,
    doctor: DoctorCommand,
    explain: ExplainCommand,
    orient: OrientCommand,
    diagnose: DiagnoseCommand,
    perf: PerfCommand,
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
    clipanion.register(DevCommand);
    clipanion.register(RefreshCommand);
    clipanion.register(BuildCommand);
    clipanion.register(TypecheckCommand);
    clipanion.register(LintCommand);
    clipanion.register(CheckCommand);
    clipanion.register(ConnectCommand);
    clipanion.register(DoctorCommand);
    clipanion.register(ExplainCommand);
    clipanion.register(OrientCommand);
    clipanion.register(DiagnoseCommand);
    clipanion.register(PerfCommand);
    clipanion.register(TraceCommand);
    clipanion.register(CommandCommand);
    clipanion.register(SessionCommand);
    clipanion.register(VerifyCommand);

    return clipanion;
};
