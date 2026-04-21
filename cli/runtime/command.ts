import { Command, Option } from 'clipanion';

import cli, { type TArgsObject } from '../context';
import { createClipanionUsage, proteumCommands, type TProteumCommandName } from '../presentation/commands';
import { createArgs } from './argv';

type TRunModule = { run: () => Promise<number | void> };

export const runCommandModule = async (loader: () => Promise<TRunModule>) => {
    const module = await loader();
    return await module.run();
};

export abstract class ProteumCommand extends Command {
    public verbose = Option.Boolean('-v,--verbose', false, {
        description: 'Show verbose compiler, watcher, and framework setup logs.',
    });

    protected setCliArgs(args: TArgsObject = {}) {
        cli.setArgs(createArgs({ ...args, verbose: this.verbose }));
    }
}

export const buildUsage = (commandName: TProteumCommandName) =>
    Command.Usage(createClipanionUsage(proteumCommands[commandName]));
