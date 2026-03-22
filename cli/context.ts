import cp from 'child_process';
import fs from 'fs-extra';

import Paths from './paths';

export type TArgsObject = { [key: string]: string | boolean | string[] | undefined };

export class CLIContext {
    public args: TArgsObject = { workdir: process.cwd() };

    public debug = false;

    public packageJson: { [key: string]: any };

    public constructor(public paths = new Paths(process.cwd())) {
        this.debug && console.log(`[cli] 5HTP CLI`, process.env.npm_package_version);

        this.debug && console.log(`[cli] Apply aliases ...`);
        this.paths.applyAliases();

        this.packageJson = this.loadPkg();
    }

    public setArgs(args: TArgsObject = {}) {
        this.args = { workdir: process.cwd(), ...args };
    }

    private loadPkg() {
        return fs.readJSONSync(this.paths.core.root + '/package.json');
    }

    public shell(...commands: string[]) {
        return new Promise<void>((resolve) => {
            const fullCommand = commands
                .map((command) => {
                    command = command.trim();

                    if (command.endsWith(';')) command = command.substring(0, command.length - 1);

                    return command;
                })
                .join(';');

            console.log('$ ' + fullCommand);

            const wrappedCommand = `bash -c '${fullCommand}'`;
            console.log('Running command: ' + wrappedCommand);

            const proc = cp.spawn(wrappedCommand, [], {
                cwd: process.cwd(),
                detached: false,
                shell: true,
            });

            console.log(proc.exitCode);

            proc.on('exit', () => {
                console.log('Command finished.');
                resolve();
            });
        });
    }
}

const cli = new CLIContext();

export default cli;
