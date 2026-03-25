import { Builtins, Cli, Option } from 'clipanion';

import type { TArgsObject } from '../context';
import { applyLegacyBooleanArgs, assertNoLegacyArgs } from './argv';
import { buildUsage, ProteumCommand, runCommandModule } from './command';

class InitCommand extends ProteumCommand {
    public static paths = [['init']];

    public static usage = buildUsage('init');

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('init', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('../commands/init'));
    }
}

class DevCommand extends ProteumCommand {
    public static paths = [['dev']];

    public static usage = buildUsage('dev');

    public port = Option.String('--port', { description: 'Override the router port.' });
    public cache = Option.Boolean('--cache', true, { description: 'Enable filesystem caching.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('dev', this.legacyArgs);
        this.setCliArgs({ port: this.port ?? '', cache: this.cache });
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

class DoctorCommand extends ProteumCommand {
    public static paths = [['doctor']];

    public static usage = buildUsage('doctor');

    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public strict = Option.Boolean('--strict', false, { description: 'Exit with failure if any diagnostics exist.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { json: this.json, strict: this.strict } satisfies TArgsObject;

        applyLegacyBooleanArgs('doctor', this.legacyArgs, ['json', 'strict'], args);
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
    public services = Option.Boolean('--services', false, { description: 'Include the services section.' });
    public controllers = Option.Boolean('--controllers', false, { description: 'Include the controllers section.' });
    public commands = Option.Boolean('--commands', false, { description: 'Include the commands section.' });
    public routes = Option.Boolean('--routes', false, { description: 'Include the routes section.' });
    public layouts = Option.Boolean('--layouts', false, { description: 'Include the layouts section.' });
    public diagnostics = Option.Boolean('--diagnostics', false, {
        description: 'Include the diagnostics section.',
    });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = {
            json: this.json,
            all: this.all,
            app: this.app,
            conventions: this.conventions,
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
            this.legacyArgs,
            ['json', 'all', 'app', 'conventions', 'env', 'services', 'controllers', 'commands', 'routes', 'layouts', 'diagnostics'],
            args,
        );
        this.setCliArgs(args);
        await runCommandModule(() => import('../commands/explain'));
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

export const registeredCommands = {
    init: InitCommand,
    dev: DevCommand,
    refresh: RefreshCommand,
    build: BuildCommand,
    typecheck: TypecheckCommand,
    lint: LintCommand,
    check: CheckCommand,
    doctor: DoctorCommand,
    explain: ExplainCommand,
    trace: TraceCommand,
    command: CommandCommand,
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
    clipanion.register(DevCommand);
    clipanion.register(RefreshCommand);
    clipanion.register(BuildCommand);
    clipanion.register(TypecheckCommand);
    clipanion.register(LintCommand);
    clipanion.register(CheckCommand);
    clipanion.register(DoctorCommand);
    clipanion.register(ExplainCommand);
    clipanion.register(TraceCommand);
    clipanion.register(CommandCommand);

    return clipanion;
};
