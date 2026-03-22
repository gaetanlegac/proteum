import cli from '..';
import { refreshGeneratedTypings, runAppTypecheck } from '../utils/check';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

const validateTypecheckArgs = () => {
    const enabledArgs = Object.entries(cli.args).filter(
        ([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true,
    );

    if (enabledArgs.length > 0)
        throw new Error(
            `Unknown typecheck argument(s): ${enabledArgs.map(([name]) => name).join(', ')}. This command does not accept options.`,
        );
};

export const run = async (): Promise<void> => {
    validateTypecheckArgs();

    console.info(
        [
            await renderTitle('PROTEUM TYPECHECK', 'Refreshing generated contracts, then running TypeScript.'),
            renderRows([{ label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot }]),
        ].join('\n\n'),
    );
    console.info(await renderStep('[1/2]', 'Refreshing generated typings.'));
    await refreshGeneratedTypings();
    console.info(await renderStep('[2/2]', 'Running TypeScript typechecking.'));
    await runAppTypecheck();
    console.info(await renderSuccess('Typecheck passed.'));
};
