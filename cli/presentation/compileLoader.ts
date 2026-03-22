import cp from 'child_process';
import path from 'path';

type TCompileLoaderMessage =
    | { type: 'start'; compilerName: string; changedFilesCount: number }
    | { type: 'finish'; compilerName: string; succeeded: boolean; durationMs: number }
    | { type: 'stop' };

export type TCompileLoader = {
    start: (compilerName: string, changedFiles: string[]) => void;
    finish: (compilerName: string, options: { succeeded: boolean; durationMs: number }) => void;
    stop: () => void;
};

const createNoopCompileLoader = (): TCompileLoader => ({
    start() {},
    finish() {},
    stop() {},
});

class ProcessCompileLoader implements TCompileLoader {
    private child?: cp.ChildProcess;

    public constructor(private mode: 'dev' | 'prod', private compilerNames: string[]) {}

    public start(compilerName: string, changedFiles: string[]) {
        this.ensureChild();
        this.send({
            type: 'start',
            compilerName,
            changedFilesCount: changedFiles.length,
        });
    }

    public finish(compilerName: string, { succeeded, durationMs }: { succeeded: boolean; durationMs: number }) {
        this.send({
            type: 'finish',
            compilerName,
            succeeded,
            durationMs,
        });
    }

    public stop() {
        if (!this.child) return;

        this.send({ type: 'stop' });
        this.child.disconnect();
        this.child = undefined;
    }

    private ensureChild() {
        if (this.child && this.child.connected) return;

        const loaderEntrypoint = path.join(__dirname, 'compileLoaderProcess.ts');

        this.child = cp.fork(loaderEntrypoint, [], {
            env: {
                ...process.env,
                TS_NODE_PROJECT: path.join(__dirname, '..', 'tsconfig.json'),
                TS_NODE_TRANSPILE_ONLY: '1',
            },
            execArgv: ['-r', 'ts-node/register/transpile-only'],
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });

        this.child.on('exit', () => {
            this.child = undefined;
        });
    }

    private send(message: TCompileLoaderMessage) {
        if (!this.child || !this.child.connected) return;

        this.child.send({
            mode: this.mode,
            compilerNames: this.compilerNames,
            message,
        });
    }
}

export const createCompileLoader = async ({
    mode,
    compilerNames,
    enabled,
}: {
    mode: 'dev' | 'prod';
    compilerNames: string[];
    enabled: boolean;
}): Promise<TCompileLoader> => {
    if (!enabled || !process.stderr.isTTY) return createNoopCompileLoader();

    return new ProcessCompileLoader(mode, compilerNames);
};
