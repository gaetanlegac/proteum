process.traceDeprecation = true;

import fs from 'fs';
import { Cli } from 'clipanion';

import cli from './context';
import { proteumCommandNames } from './presentation/commands';
import { renderCliOverview, renderCommandHelp, resolveCustomHelpRequest } from './presentation/help';
import { normalizeHelpArgv, normalizeLegacyArgv } from './runtime/argv';
import { createCli, registeredCommands } from './runtime/commands';

const hasInitScaffold = () => fs.existsSync(`${cli.paths.core.cli}/skeleton`);

export const runCli = async (argv: string[] = process.argv.slice(2)) => {
    const normalizedArgv = normalizeHelpArgv(normalizeLegacyArgv(argv), proteumCommandNames);
    const clipanion = createCli(String(cli.packageJson.version || ''));
    const initAvailable = hasInitScaffold();
    const helpRequest = resolveCustomHelpRequest(normalizedArgv);

    if (helpRequest.kind === 'overview') {
        process.stdout.write(
            await renderCliOverview({
                version: String(cli.packageJson.version || ''),
                workdir: process.cwd(),
                initAvailable,
            }),
        );
        return;
    }

    if (helpRequest.kind === 'command') {
        process.stdout.write(
            await renderCommandHelp({
                commandName: helpRequest.commandName,
                definition: clipanion.definition(registeredCommands[helpRequest.commandName]),
                workdir: process.cwd(),
                initAvailable,
            }),
        );
        return;
    }

    await clipanion.runExit(normalizedArgv, Cli.defaultContext);
};

export default cli;
