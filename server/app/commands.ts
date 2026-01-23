/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import yargsParser from 'yargs-parser';

// Core
import type { Application } from '@server/app';
import Service from '@server/app/service';
import { NotFound } from '@common/errors';

/*----------------------------------
- TYPES
----------------------------------*/

type CommandCallback<TArgs extends any[]> = (...args: TArgs) => Promise<any>

export type CommandsList = {
    [commandName: string]: Command
}

export type Command<TArgs extends any[] = any[]> = {
    name: string,
    description: string,
    run?: CommandCallback<TArgs>
    childrens: CommandsList
}

/*----------------------------------
- SERVICE TYPES
----------------------------------*/

const LogPrefix = `[commands]`;

export type Config = {
    debug: boolean
}

export type Hooks = {

}

export type Services = {

}

/*----------------------------------
- SERVICE
----------------------------------*/
export default class CommandsManager extends Service<Config, Hooks, Application> {

    public priority = 2 as 2;

    public commandsIndex: CommandsList = {}
    
    public command<TArgs extends any[]>( 
        ...args: (
            [name: string, description: string, childrens: Command[]]
            |
            [name: string, description: string, run: CommandCallback<TArgs>, childrens?: Command[]]
        )
    ): Command {

        let name: string, description: string;
        let childrens: Command[] | undefined;
        let run: CommandCallback<TArgs> | undefined;

        if (typeof args[2] === 'object')
            ([name, description, childrens] = args)
        else
            ([name, description, run, childrens] = args)
        
        const command: Command = {
            name,
            description,
            run, 
            childrens: childrens ? this.indexFromList(childrens) : {}
        }

        return command;
    }

    private indexFromList( list: Command[] ): CommandsList {

        const index: CommandsList = {}
        for (const command of list)
            index[ command.name ] = command;

        return index;
    }

    /*----------------------------------
    - REGISTER
    ----------------------------------*/
    public fromList( list: Command[] ) {
        for (const command of list) {

            if (this.commandsIndex[ command.name ] !== undefined)
                throw new Error(`Tried to register command "${command.name}", but it already has been defined.`);

            this.commandsIndex[ command.name ] = command;
        }
    }

    /*----------------------------------
    - RUN
    ----------------------------------*/
    public async run( commandString: string ) {

        const { _, ...args } = yargsParser(commandString);

        this.config.debug && console.log(LogPrefix, `Run command: ${commandString} | Parsed:`, { _, ...args });

        let command: Command | undefined;
        for (const commandName of _) {

            const commandsList: CommandsList = command === undefined 
                ? this.commandsIndex
                : command.childrens;

            command = commandsList[commandName];

            if (command === undefined)
                break;
        }

        if (command === undefined)
            throw new NotFound(`Command not found.`);

        if (command.run === undefined)
            throw new NotFound(`This command isn't runnable.`);

        // TODO: order correctly & validate type according to injected typescript typedefs (command.run.params)
        const argsList = Object.values(args);

        const result = await command.run(argsList);

        return result;    
    }
}