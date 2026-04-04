process.traceDeprecation = true;

import { Cli } from 'clipanion';

import cli from './context';
import { resolveFrameworkInstallInfo } from './paths';
import { proteumCommandNames } from './presentation/commands';
import { renderCliOverview, renderCommandHelp, resolveCustomHelpRequest } from './presentation/help';
import { renderCliWelcomeBanner } from './presentation/welcome';
import { normalizeHelpArgv, normalizeLegacyArgv } from './runtime/argv';
import { createCli, registeredCommands } from './runtime/commands';

const formatInvocation = (argv: string[]) => ['proteum', ...argv].join(' ').trim();

const sharedWelcomeBannerCommands = new Set(['build', 'dev']);

const shouldRenderSharedWelcomeBanner = ({
    argv,
    helpRequestKind,
}: {
    argv: string[];
    helpRequestKind: 'none' | 'overview' | 'command';
}) => {
    if (helpRequestKind !== 'none') return false;
    if (argv.length !== 1) return false;

    const command = argv[0];
    if (!command || !sharedWelcomeBannerCommands.has(command)) return false;
    return true;
};

export const runCli = async (argv: string[] = process.argv.slice(2)) => {
    const normalizedArgv = normalizeHelpArgv(normalizeLegacyArgv(argv), proteumCommandNames);
    const version = String(cli.packageJson.version || '');
    const proteumInstall = resolveFrameworkInstallInfo({
        appRoot: cli.paths.appRoot,
        framework: cli.paths.framework,
    });
    const clipanion = createCli(version);
    const initAvailable = true;
    const helpRequest = resolveCustomHelpRequest(normalizedArgv);
    const shouldRenderWelcomeBanner = shouldRenderSharedWelcomeBanner({
        argv: normalizedArgv,
        helpRequestKind: helpRequest.kind,
    });

    if (shouldRenderWelcomeBanner) {
        process.stderr.write(
            `${await renderCliWelcomeBanner({
                command: formatInvocation(normalizedArgv),
                installSummary: proteumInstall.summary,
                version,
            })}\n\n`,
        );
    }

    if (helpRequest.kind === 'overview') {
        process.stdout.write(
            await renderCliOverview({
                version,
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
