import cli from '..';
import { runAppLint } from '../utils/check';

const allowedLintArgs = new Set(['fix']);

const validateLintArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedLintArgs.has(arg));

    if (invalidArgs.length > 0)
        throw new Error(`Unknown lint argument(s): ${invalidArgs.join(', ')}. Allowed values: fix.`);
};

export const run = async (): Promise<void> => {
    validateLintArgs();

    await runAppLint({ fix: cli.args.fix === true });
};
