import cli from '..';
import { refreshGeneratedTypings, runAppLint, runAppTypecheck } from '../utils/check';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

const validateCheckArgs = () => {
    const enabledArgs = Object.entries(cli.args).filter(
        ([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true,
    );

    if (enabledArgs.length > 0)
        throw new Error(
            `Unknown check argument(s): ${enabledArgs.map(([name]) => name).join(', ')}. This command does not accept options.`,
        );
};

export const run = async (): Promise<void> => {
    validateCheckArgs();

    console.info(
        [
            await renderTitle('PROTEUM CHECK', 'Refreshing contracts, running TypeScript, then running ESLint.'),
            renderRows([{ label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot }]),
        ].join('\n\n'),
    );
    console.info(await renderStep('[1/3]', 'Refreshing generated typings.'));
    await refreshGeneratedTypings();
    console.info(await renderStep('[2/3]', 'Running TypeScript typechecking.'));
    await runAppTypecheck();
    console.info(await renderStep('[3/3]', 'Running ESLint.'));
    await runAppLint();
    console.info(await renderSuccess('All checks passed.'));
};
