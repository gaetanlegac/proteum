process.traceDeprecation = true;

import { Builtins, Cli, Command, Option, UsageError } from 'clipanion';

import cli, { type TArgsObject } from './context';

type TRunModule = { run: () => Promise<void> };

const normalizeLegacyArgv = (argv: string[]) =>
    argv.map((arg) => {
        if (!/^-[-A-Za-z0-9]+$/.test(arg)) return arg;
        if (arg.startsWith('--')) return arg;
        if (arg.length <= 2) return arg;

        return `--${arg.substring(1)}`;
    });

const commandNames = new Set([
    'init',
    'dev',
    'refresh',
    'build',
    'typecheck',
    'lint',
    'check',
    'doctor',
    'explain',
]);

const normalizeHelpArgv = (argv: string[]) => {
    if (argv.length === 0) return argv;
    if (!commandNames.has(argv[0])) return argv;
    if (!argv.includes('--help') && !argv.includes('-h')) return argv;

    return [argv[0], '--help'];
};

const createArgs = (args: TArgsObject = {}) => ({ workdir: process.cwd(), ...args });

const applyLegacyBooleanArgs = (
    commandName: string,
    legacyArgs: readonly string[],
    allowedArgs: readonly string[],
    args: TArgsObject,
) => {
    const allowedArgsSet = new Set(allowedArgs);

    for (const legacyArg of legacyArgs) {
        if (!allowedArgsSet.has(legacyArg)) {
            throw new UsageError(
                `Unknown ${commandName} argument: ${legacyArg}. Allowed values: ${allowedArgs.join(', ') || 'none'}.`,
            );
        }

        args[legacyArg] = true;
    }
};

const assertNoLegacyArgs = (commandName: string, legacyArgs: readonly string[]) => {
    if (legacyArgs.length === 0) return;

    throw new UsageError(
        `${commandName} does not accept positional arguments. Received: ${legacyArgs.join(', ')}.`,
    );
};

const runCommandModule = async (loader: () => Promise<TRunModule>) => {
    const module = await loader();
    await module.run();
};

abstract class ProteumCommand extends Command {
    protected setCliArgs(args: TArgsObject = {}) {
        cli.setArgs(createArgs(args));
    }
}

class InitCommand extends ProteumCommand {
    public static paths = [['init']];

    public static usage = Command.Usage({
        description: 'Create a new Proteum project',
    });

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('init', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('./commands/init'));
    }
}

class DevCommand extends ProteumCommand {
    public static paths = [['dev']];

    public static usage = Command.Usage({
        description: 'Start the Proteum development compiler and server',
        details: 'Legacy single-dash long options remain supported, for example `proteum dev -port 3001`.',
    });

    public port = Option.String('--port', { description: 'Override the router port.' });
    public cache = Option.Boolean('--cache', true, { description: 'Enable filesystem caching.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('dev', this.legacyArgs);
        this.setCliArgs({ port: this.port ?? '', cache: this.cache });
        await runCommandModule(() => import('./commands/dev'));
    }
}

class RefreshCommand extends ProteumCommand {
    public static paths = [['refresh']];

    public static usage = Command.Usage({
        description: 'Refresh generated Proteum typings and artifacts',
    });

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('refresh', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('./commands/refresh'));
    }
}

class BuildCommand extends ProteumCommand {
    public static paths = [['build']];

    public static usage = Command.Usage({
        description: 'Build the application',
        details:
            'Both modern flags and legacy positional booleans are supported, for example `proteum build --analyze` and `proteum build prod analyze`.',
    });

    public port = Option.String('--port', { description: 'Override the router port.' });
    public prod = Option.Boolean('--prod', false, { description: 'Build in production mode.' });
    public cache = Option.Boolean('--cache', false, { description: 'Enable filesystem caching during the build.' });
    public analyze = Option.Boolean('--analyze', false, { description: 'Emit the client bundle analysis report.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = {
            port: this.port ?? '',
            dev: false,
            prod: this.prod,
            cache: this.cache,
            analyze: this.analyze,
        } satisfies TArgsObject;

        applyLegacyBooleanArgs('build', this.legacyArgs, ['prod', 'cache', 'analyze'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('./commands/build'));
    }
}

class TypecheckCommand extends ProteumCommand {
    public static paths = [['typecheck']];

    public static usage = Command.Usage({
        description: 'Run TypeScript typechecking for the application',
    });

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('typecheck', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('./commands/typecheck'));
    }
}

class LintCommand extends ProteumCommand {
    public static paths = [['lint']];

    public static usage = Command.Usage({
        description: 'Run ESLint for the application',
        details: 'Legacy positional usage such as `proteum lint fix` remains supported.',
    });

    public fix = Option.Boolean('--fix', false, { description: 'Apply fixable lint changes.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { fix: this.fix } satisfies TArgsObject;

        applyLegacyBooleanArgs('lint', this.legacyArgs, ['fix'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('./commands/lint'));
    }
}

class CheckCommand extends ProteumCommand {
    public static paths = [['check']];

    public static usage = Command.Usage({
        description: 'Refresh typings, typecheck, then lint the application',
    });

    public legacyArgs = Option.Rest();

    public async execute() {
        assertNoLegacyArgs('check', this.legacyArgs);
        this.setCliArgs();
        await runCommandModule(() => import('./commands/check'));
    }
}

class DoctorCommand extends ProteumCommand {
    public static paths = [['doctor']];

    public static usage = Command.Usage({
        description: 'Inspect the generated Proteum manifest diagnostics',
        details: 'Legacy positional usage such as `proteum doctor json strict` remains supported.',
    });

    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public strict = Option.Boolean('--strict', false, { description: 'Exit with failure if any diagnostics exist.' });
    public legacyArgs = Option.Rest();

    public async execute() {
        const args = { json: this.json, strict: this.strict } satisfies TArgsObject;

        applyLegacyBooleanArgs('doctor', this.legacyArgs, ['json', 'strict'], args);
        this.setCliArgs(args);
        await runCommandModule(() => import('./commands/doctor'));
    }
}

class ExplainCommand extends ProteumCommand {
    public static paths = [['explain']];

    public static usage = Command.Usage({
        description: 'Explain the generated Proteum manifest',
        details:
            'Legacy positional section selection remains supported, for example `proteum explain routes services`.',
    });

    public json = Option.Boolean('--json', false, { description: 'Print JSON output.' });
    public all = Option.Boolean('--all', false, { description: 'Include every explain section.' });
    public app = Option.Boolean('--app', false, { description: 'Include the app section.' });
    public conventions = Option.Boolean('--conventions', false, { description: 'Include the conventions section.' });
    public env = Option.Boolean('--env', false, { description: 'Include the env section.' });
    public services = Option.Boolean('--services', false, { description: 'Include the services section.' });
    public controllers = Option.Boolean('--controllers', false, { description: 'Include the controllers section.' });
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
            routes: this.routes,
            layouts: this.layouts,
            diagnostics: this.diagnostics,
        } satisfies TArgsObject;

        applyLegacyBooleanArgs(
            'explain',
            this.legacyArgs,
            ['json', 'all', 'app', 'conventions', 'env', 'services', 'controllers', 'routes', 'layouts', 'diagnostics'],
            args,
        );
        this.setCliArgs(args);
        await runCommandModule(() => import('./commands/explain'));
    }
}

const createCli = () => {
    const clipanion = new Cli({
        binaryLabel: 'Proteum',
        binaryName: 'proteum',
        binaryVersion: String(cli.packageJson.version || ''),
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

    return clipanion;
};

export const runCli = async (argv: string[] = process.argv.slice(2)) => {
    await createCli().runExit(normalizeHelpArgv(normalizeLegacyArgv(argv)), Cli.defaultContext);
};

export default cli;
