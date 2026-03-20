/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

// Cor elibs
import cli from '..';
import Keyboard from '../utils/keyboard';

// Configs
import Compiler from '../compiler';

// Core
import { app, App } from '../app';

const ignoredWatchPathPatterns = /(node_modules\/(?!proteum\/))|(\.generated\/)|(\.cache\/)/;

/*----------------------------------
- COMMANDE
----------------------------------*/
export const run = () => new Promise<void>(async () => {

    const compiler = new Compiler('dev', {
        before: (compiler) => {
            if (compiler.name !== 'server')
                return;

            const changedFilesList = compiler.modifiedFiles ? [...compiler.modifiedFiles] : [];

            if (changedFilesList.length === 0)
                console.info("Server compilation started. App restart will wait for a successful server build.");
            else
                console.info("Need to recompile server because files changed:\n" + changedFilesList.join('\n'));

        }, 
        after: () => {


        }
    });

    const multiCompiler = await compiler.create();
    const ignoredOutputPaths = [app.paths.bin, app.paths.dev].map(normalizeWatchPath);

    multiCompiler.watch({

        // https://webpack.js.org/configuration/watch/#watchoptions
        // Watching may not work with NFS and machines in VirtualBox
        // Uncomment next line if it is your case (use true or interval in milliseconds)
        //poll: 1000,

        // Decrease CPU or memory usage in some file systems
        // Ignore updated from:
        // - Node modules except 5HTP core (framework dev mode)
        // - Generated files during runtime (cause infinite loop. Ex: models.d.ts)
        // - Webpack output folders (`./dev`, legacy `./bin`)
        ignored: (watchPath: string) => {
            const normalizedPath = normalizeWatchPath(watchPath);
            return ignoredWatchPathPatterns.test(normalizedPath)
                || ignoredOutputPaths.some(outputPath =>
                    normalizedPath === outputPath
                    || normalizedPath.startsWith(outputPath + '/')
                );
        }

        //aggregateTimeout: 1000,
    }, async (error, stats) => {

        if (error) {
            compiler.consumeRecentCompilationResults();
            console.error(`Error in milticompiler.watch`, error, stats?.toString());
            return;
        }

        const recentCompilationResults = compiler.consumeRecentCompilationResults();

        if (recentCompilationResults.server === true) {
            console.log("Watch callback. Reloading app because server bundle changed ...");
            startApp(app);
            return;
        }

        if (recentCompilationResults.server === false) {
            console.log("Watch callback. Server compilation failed; keeping current app instance.");
            return;
        }

        if (recentCompilationResults.client === true) {
            console.log("Watch callback. Client assets updated; server restart skipped.");
            return;
        }

        if (recentCompilationResults.client === false) {
            console.log("Watch callback. Client compilation failed; server restart skipped.");
            return;
        }

        console.log("Watch callback. No compiler changes were tracked.");

    });

    Keyboard.input('ctrl+r', async () => {

        console.log(`Waiting for compilers to be ready ...`, Object.keys(compiler.compiling));
        await Promise.all(Object.values(compiler.compiling));

        console.log(`Reloading app ...`);
        startApp(app);

    });

    Keyboard.input('ctrl+c', () => {
        stopApp("CTRL+C Pressed");
    });
});


/*----------------------------------
- APP RUN
----------------------------------*/
let cp: ChildProcess | undefined = undefined;

async function startApp( app: App ) {

    stopApp('Restart asked');

    console.info(`Launching new server ...`);
    cp = spawn('node', ['' + app.outputPath('dev') + '/server.js', '--preserve-symlinks'], {

        // sdin, sdout, sderr
        stdio: ['inherit', 'inherit', 'inherit']

    });
}

function stopApp( reason: string ) {
    if (cp !== undefined) {
        console.info(`Killing current server instance (ID: ${cp.pid}) for the following reason:`, reason);
        cp.kill();
    }

}

function normalizeWatchPath(watchPath: string) {
    return path.resolve(watchPath).replace(/\\/g, '/').replace(/\/$/, '');
}
