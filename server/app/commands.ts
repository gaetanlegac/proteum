/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import { Cli, Command as ClipanionCommand, Option, UsageError } from 'clipanion';

// Core
import type { Application } from './index';
import Service from '@server/app/service';
import { InputError, NotFound } from '@common/errors';

/*----------------------------------
- TYPES
----------------------------------*/

type CommandCallback<TArgs extends any[]> = (...args: TArgs) => Promise<any>;

export type CommandsList = { [commandName: string]: RuntimeCommand };

export type RuntimeCommand<TArgs extends any[] = any[]> = {
    name: string;
    description: string;
    run?: CommandCallback<TArgs>;
    childrens: CommandsList;
};

/*----------------------------------
- SERVICE TYPES
----------------------------------*/

const LogPrefix = `[commands]`;

export type Config = { debug: boolean };

export type Hooks = {};

export type Services = {};

type TCommandArgumentValue = string | number | boolean;
type TParsedCommandArgs = { [key: string]: TCommandArgumentValue | TCommandArgumentValue[] };

const commandValuePattern = /^-?(?:\d+|\d*\.\d+)$/;

const tokenizeCommandString = (commandString: string) => {
    const tokens: string[] = [];
    let currentToken = '';
    let quote: '"' | "'" | undefined;
    let escaping = false;

    for (const character of commandString) {
        if (escaping) {
            currentToken += character;
            escaping = false;
            continue;
        }

        if (character === '\\') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (character === quote) {
                quote = undefined;
                continue;
            }

            currentToken += character;
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }

        if (/\s/.test(character)) {
            if (!currentToken) continue;

            tokens.push(currentToken);
            currentToken = '';
            continue;
        }

        currentToken += character;
    }

    if (escaping) currentToken += '\\';
    if (currentToken) tokens.push(currentToken);

    return tokens;
};

const isOptionToken = (token: string) => /^-(?!\d+(\.\d+)?$).+/.test(token);

const normalizeCommandValue = (value: string): TCommandArgumentValue => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (commandValuePattern.test(value)) return Number(value);

    return value;
};

const addParsedArgValue = (args: TParsedCommandArgs, key: string, value: TCommandArgumentValue) => {
    const existingValue = args[key];

    if (existingValue === undefined) {
        args[key] = value;
        return;
    }

    args[key] = Array.isArray(existingValue) ? [...existingValue, value] : [existingValue, value];
};

const parseCommandOptionTokens = (tokens: string[]) => {
    const namedArguments: TParsedCommandArgs = {};
    const positionalArguments: string[] = [];

    let usePositionalOnly = false;

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];

        if (usePositionalOnly) {
            positionalArguments.push(token);
            continue;
        }

        if (token === '--') {
            usePositionalOnly = true;
            continue;
        }

        if (token === '--help' || token === '-h') return { help: true as const, args: namedArguments, positionalArguments };

        if (token.startsWith('--') && token.length > 2) {
            const body = token.slice(2);

            if (body.startsWith('no-') && body.length > 3) {
                addParsedArgValue(namedArguments, body.slice(3), false);
                continue;
            }

            const equalsIndex = body.indexOf('=');

            if (equalsIndex >= 0) {
                addParsedArgValue(
                    namedArguments,
                    body.slice(0, equalsIndex),
                    normalizeCommandValue(body.slice(equalsIndex + 1)),
                );
                continue;
            }

            const nextToken = tokens[index + 1];

            if (nextToken !== undefined && !isOptionToken(nextToken)) {
                addParsedArgValue(namedArguments, body, normalizeCommandValue(nextToken));
                index++;
                continue;
            }

            addParsedArgValue(namedArguments, body, true);
            continue;
        }

        if (token.startsWith('-') && token.length > 1 && !commandValuePattern.test(token)) {
            const body = token.slice(1);
            const equalsIndex = body.indexOf('=');

            if (equalsIndex >= 0) {
                addParsedArgValue(
                    namedArguments,
                    body.slice(0, equalsIndex),
                    normalizeCommandValue(body.slice(equalsIndex + 1)),
                );
                continue;
            }

            const nextToken = tokens[index + 1];

            if (body.length === 1 && nextToken !== undefined && !isOptionToken(nextToken)) {
                addParsedArgValue(namedArguments, body, normalizeCommandValue(nextToken));
                index++;
                continue;
            }

            for (const shortFlag of body) addParsedArgValue(namedArguments, shortFlag, true);

            continue;
        }

        positionalArguments.push(token);
    }

    return { help: false as const, args: namedArguments, positionalArguments };
};

/*----------------------------------
- SERVICE
----------------------------------*/
export default class CommandsManager extends Service<Config, Hooks, Application> {
    public priority = 2 as 2;

    public commandsIndex: CommandsList = {};

    private runtimeCli?: Cli;

    public command<TArgs extends any[]>(
        ...args:
            | [name: string, description: string, childrens: RuntimeCommand[]]
            | [name: string, description: string, run: CommandCallback<TArgs>, childrens?: RuntimeCommand[]]
    ): RuntimeCommand {
        let name: string, description: string;
        let childrens: RuntimeCommand[] | undefined;
        let run: CommandCallback<TArgs> | undefined;

        if (typeof args[2] === 'object') [name, description, childrens] = args;
        else [name, description, run, childrens] = args;

        const command: RuntimeCommand = { name, description, run, childrens: childrens ? this.indexFromList(childrens) : {} };

        return command;
    }

    private indexFromList(list: RuntimeCommand[]): CommandsList {
        const index: CommandsList = {};
        for (const command of list) index[command.name] = command;

        return index;
    }

    private invalidateRuntimeCli() {
        this.runtimeCli = undefined;
    }

    private createRuntimeCommandClass(command: RuntimeCommand, path: string[]) {
        const manager = this;
        const usage = ClipanionCommand.Usage({ description: command.description });

        if (command.run === undefined) {
            class RuntimeNamespaceCommand extends ClipanionCommand {
                public static override paths = [path];
                public static override usage = usage;

                public async execute() {
                    throw new NotFound(`This command isn't runnable.`);
                }
            }

            Object.defineProperty(RuntimeNamespaceCommand, 'name', {
                value: `${path.map((segment) => segment.replace(/[^A-Za-z0-9]/g, '_')).join('_') || 'Root'}NamespaceCommand`,
            });

            return RuntimeNamespaceCommand;
        }

        class RuntimeRunnableCommand extends ClipanionCommand {
            public static override paths = [path];
            public static override usage = usage;

            public proxy = Option.Proxy({ name: 'args' });

            public async execute() {
                return manager.executeRegisteredCommand(command, path, this.proxy);
            }
        }

        Object.defineProperty(RuntimeRunnableCommand, 'name', {
            value: `${path.map((segment) => segment.replace(/[^A-Za-z0-9]/g, '_')).join('_') || 'Root'}RunnableCommand`,
        });

        return RuntimeRunnableCommand;
    }

    private createRuntimeCli() {
        const cli = new Cli({
            binaryName: this.app.identity.identifier || 'app',
            enableCapture: false,
        });

        const registerCommands = (commands: CommandsList, parentPath: string[] = []) => {
            for (const command of Object.values(commands)) {
                const path = [...parentPath, command.name];

                cli.register(this.createRuntimeCommandClass(command, path));

                if (Object.keys(command.childrens).length > 0) registerCommands(command.childrens, path);
            }
        };

        registerCommands(this.commandsIndex);

        return cli;
    }

    private getRuntimeCli() {
        this.runtimeCli ??= this.createRuntimeCli();

        return this.runtimeCli;
    }

    private async executeRegisteredCommand(command: RuntimeCommand, path: string[], proxyTokens: string[]) {
        if (command.run === undefined) throw new NotFound(`This command isn't runnable.`);

        const { help, args, positionalArguments } = parseCommandOptionTokens(proxyTokens);

        this.config.debug &&
            console.log(LogPrefix, `Run command path: ${path.join(' ')} | Parsed proxy tokens:`, {
                proxyTokens,
                args,
                positionalArguments,
            });

        if (help) {
            const cli = this.getRuntimeCli();
            const runtimeCommand = cli.process(path, Cli.defaultContext);

            return cli.usage(runtimeCommand, { detailed: true });
        }

        if (positionalArguments.length > 0) {
            throw new UsageError(
                `Unexpected positional arguments for "${path.join(' ')}": ${positionalArguments.join(', ')}.`,
            );
        }

        const argsList = Object.values(args);

        return command.run(...(argsList as Parameters<NonNullable<typeof command.run>>));
    }

    private createRuntimeCliApi(cli: Cli) {
        return {
            binaryLabel: cli.binaryLabel,
            binaryName: cli.binaryName,
            binaryVersion: cli.binaryVersion,
            enableCapture: cli.enableCapture,
            enableColors: cli.enableColors,
            definitions: () => cli.definitions(),
            definition: (commandClass: any) => cli.definition(commandClass),
            error: (error: Error, opts?: any) => cli.error(error, opts),
            format: (colored?: boolean) => cli.format(colored),
            process: (input: string[]) => cli.process(input, Cli.defaultContext),
            run: (input: string[]) => cli.run(input, Cli.defaultContext),
            usage: (command?: any, opts?: any) => cli.usage(command, opts),
        };
    }

    /*----------------------------------
    - REGISTER
    ----------------------------------*/
    public fromList(list: RuntimeCommand[]) {
        for (const command of list) {
            if (this.commandsIndex[command.name] !== undefined)
                throw new Error(`Tried to register command "${command.name}", but it already has been defined.`);

            this.commandsIndex[command.name] = command;
        }

        this.invalidateRuntimeCli();
    }

    /*----------------------------------
    - RUN
    ----------------------------------*/
    public async run(commandString: string) {
        const tokens = tokenizeCommandString(commandString);

        this.config.debug && console.log(LogPrefix, `Run command: ${commandString} | Tokens:`, tokens);

        if (tokens.length === 0) throw new NotFound(`Command not found.`);

        const cli = this.getRuntimeCli();

        try {
            const command = cli.process(tokens, Cli.defaultContext);

            if (command.help) return cli.usage(command, { detailed: true });

            command.context = Cli.defaultContext;
            command.cli = this.createRuntimeCliApi(cli);

            return await command.validateAndExecute();
        } catch (error) {
            if (error instanceof UsageError) throw new InputError(error.message);

            if (error instanceof Error && ['UnknownSyntaxError', 'AmbiguousSyntaxError'].includes(error.name)) {
                throw new NotFound(error.message);
            }

            throw error;
        }
    }
}
