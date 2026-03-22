import cli from '..';
import { refreshGeneratedTypings, runAppLint, runAppTypecheck } from '../utils/check';

const validateCheckArgs = () => {
    const enabledArgs = Object.entries(cli.args).filter(([name, value]) => name !== 'workdir' && value === true);

    if (enabledArgs.length > 0)
        throw new Error(
            `Unknown check argument(s): ${enabledArgs.map(([name]) => name).join(', ')}. This command does not accept options.`,
        );
};

export const run = async (): Promise<void> => {
    validateCheckArgs();

    await refreshGeneratedTypings();
    await runAppTypecheck();
    await runAppLint();
};
