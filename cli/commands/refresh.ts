/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Configs
import Compiler from '../compiler';

/*----------------------------------
- COMMAND
----------------------------------*/
export const run = (): Promise<void> =>
    new Promise(async (resolve) => {
        const compiler = new Compiler('dev');

        await compiler.refreshGeneratedTypings();

        resolve();
    });
