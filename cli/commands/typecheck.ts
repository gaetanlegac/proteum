import cli from '..';
import { refreshGeneratedTypings, runAppTypecheck } from '../utils/check';

const validateTypecheckArgs = () => {
    const enabledArgs = Object.entries(cli.args).filter(([name, value]) => name !== 'workdir' && value === true);

    if (enabledArgs.length > 0)
        throw new Error(
            `Unknown typecheck argument(s): ${enabledArgs.map(([name]) => name).join(', ')}. This command does not accept options.`,
        );
};

export const run = async (): Promise<void> => {
    validateTypecheckArgs();

    await refreshGeneratedTypings();
    await runAppTypecheck();
};
