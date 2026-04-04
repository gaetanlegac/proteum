import cp from 'child_process';
import fs from 'fs-extra';

import Paths from './paths';

export type TArgsObject = { [key: string]: string | boolean | string[] | undefined };

export class CLIContext {
    public args: TArgsObject = { workdir: process.cwd() };

    public verbose = false;

    public debug = false;

    public packageJson: { [key: string]: any };

    public constructor(public paths = new Paths(process.cwd())) {
        this.debug && console.log(`[cli] 5HTP CLI`, process.env.npm_package_version);

        this.debug && console.log(`[cli] Apply aliases ...`);
        this.paths.applyAliases();

        this.packageJson = this.loadPkg();
    }

    public setArgs(args: TArgsObject = {}) {
        const workdir =
            typeof args.workdir === 'string' && args.workdir.trim().length > 0 ? args.workdir.trim() : process.cwd();

        this.args = { workdir, ...args, workdir };
        this.paths = new Paths(workdir, this.paths.core.root);
        this.paths.applyAliases();
        this.verbose = this.args.verbose === true;
        this.debug = this.verbose;
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

            this.verbose && console.log('$ ' + fullCommand);

            const wrappedCommand = `bash -c '${fullCommand}'`;
            this.verbose && console.log('Running command: ' + wrappedCommand);

            const proc = cp.spawn(wrappedCommand, [], {
                cwd: process.cwd(),
                detached: false,
                shell: true,
            });

            this.verbose && console.log(proc.exitCode);

            proc.on('exit', () => {
                this.verbose && console.log('Command finished.');
                resolve();
            });
        });
    }
}

const cli = new CLIContext();

export default cli;
