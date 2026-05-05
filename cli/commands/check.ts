import cli from '..';
import { hasAppConfig, refreshGeneratedTypings, runAppLint, runAppTypecheck } from '../utils/check';
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
            await renderTitle('PROTEUM CHECK', 'Refreshing contracts, then running TypeScript and ESLint.'),
            renderRows([{ label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot }]),
        ].join('\n\n'),
    );

    if (hasAppConfig()) {
        console.info(await renderStep('[1/3]', 'Refreshing generated typings.'));
        await refreshGeneratedTypings();
    } else {
        console.info(await renderStep('[1/3]', 'Skipping generated typings: no Proteum app config found.'));
    }

    const failures: Error[] = [];

    console.info(await renderStep('[2/3]', 'Running TypeScript typechecking.'));
    try {
        await runAppTypecheck();
    } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    console.info(await renderStep('[3/3]', 'Running ESLint.'));
    try {
        await runAppLint();
    } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    if (failures.length > 0) {
        throw new AggregateError(failures, 'Proteum check failed. See TypeScript and ESLint output above.');
    }

    console.info(await renderSuccess('All checks passed.'));
};
