import cli from '..';
import { runAppLint } from '../utils/check';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

const allowedLintArgs = new Set(['fix']);

const validateLintArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedLintArgs.has(arg));

    if (invalidArgs.length > 0)
        throw new Error(`Unknown lint argument(s): ${invalidArgs.join(', ')}. Allowed values: fix.`);
};

export const run = async (): Promise<void> => {
    validateLintArgs();

    console.info(
        [
            await renderTitle(
                'PROTEUM LINT',
                cli.args.fix === true ? 'Running ESLint with fix mode enabled.' : 'Running ESLint in check mode.',
            ),
            renderRows([
                { label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot },
                { label: 'fix', value: cli.args.fix === true ? 'enabled' : 'disabled' },
            ]),
            await renderStep('[1/1]', cli.args.fix === true ? 'Applying fixable ESLint changes.' : 'Checking ESLint rules.'),
        ].join('\n\n'),
    );

    await runAppLint({ fix: cli.args.fix === true });
    console.info(await renderSuccess(cli.args.fix === true ? 'Lint fixes applied.' : 'Lint passed.'));
};
