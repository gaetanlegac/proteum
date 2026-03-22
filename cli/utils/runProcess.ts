import cp from 'child_process';

type TRunProcessOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
};

export const runProcess = (command: string, args: string[] = [], options: TRunProcessOptions = {}) =>
    new Promise<void>((resolve, reject) => {
        const child = cp.spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: 'inherit',
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Command "${command}" was interrupted by signal ${signal}.`));
                return;
            }

            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`Command "${command}" exited with code ${code ?? 'unknown'}.`));
        });
    });
