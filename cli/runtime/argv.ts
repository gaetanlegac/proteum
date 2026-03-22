import { UsageError } from 'clipanion';

import type { TArgsObject } from '../context';

export const normalizeLegacyArgv = (argv: string[]) =>
    argv.map((arg) => {
        if (!/^-[-A-Za-z0-9]+$/.test(arg)) return arg;
        if (arg.startsWith('--')) return arg;
        if (arg.length <= 2) return arg;

        return `--${arg.substring(1)}`;
    });

export const normalizeHelpArgv = (argv: string[], commandNames: readonly string[]) => {
    if (argv.length === 0) return argv;
    if (!commandNames.includes(argv[0])) return argv;
    if (!argv.includes('--help') && !argv.includes('-h')) return argv;

    return [argv[0], '--help'];
};

export const createArgs = (args: TArgsObject = {}) => ({ workdir: process.cwd(), ...args });

export const applyLegacyBooleanArgs = (
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

export const assertNoLegacyArgs = (commandName: string, legacyArgs: readonly string[]) => {
    if (legacyArgs.length === 0) return;

    throw new UsageError(
        `${commandName} does not accept positional arguments. Received: ${legacyArgs.join(', ')}.`,
    );
};
