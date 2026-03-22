/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Configs
import Compiler from '../compiler';
import cli from '..';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle } from '../presentation/ink';

/*----------------------------------
- COMMAND
----------------------------------*/
export const run = async (): Promise<void> => {
    const compiler = new Compiler('dev');

    console.info(
        [
            await renderTitle('PROTEUM REFRESH', 'Regenerating framework-owned contracts and typings.'),
            renderRows([{ label: 'app', value: cli.paths.appRoot === process.cwd() ? '.' : cli.paths.appRoot }]),
            await renderStep('[1/1]', 'Refreshing `.proteum` artifacts and generated typings.'),
        ].join('\n\n'),
    );

    await compiler.refreshGeneratedTypings();

    console.info(await renderSuccess('Generated artifacts and typings are up to date.'));
};
