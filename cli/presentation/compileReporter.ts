const ansi = {
    reset: '\u001b[0m',
    bold: '\u001b[1m',
    dim: '\u001b[2m',
    red: '\u001b[31m',
    green: '\u001b[32m',
    cyan: '\u001b[36m',
} as const;

export type TCompileReporter = {
    start: (compilerName: string, changedFiles: string[]) => void;
    finish: (compilerName: string, options: { succeeded: boolean; durationMs: number }) => void;
    stop: () => void;
};

const createNoopCompileReporter = (): TCompileReporter => ({
    start() {},
    finish() {},
    stop() {},
});

const supportsColor = () => process.stdout.isTTY === true;

const colorize = (value: string, ...codes: string[]) => (supportsColor() ? `${codes.join('')}${value}${ansi.reset}` : value);

const formatDuration = (durationMs: number) => {
    if (durationMs < 1000) return `${durationMs} ms`;
    if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)} s`;
    return `${Math.round(durationMs / 1000)} s`;
};

const formatChangedFiles = (changedFilesCount: number) => {
    if (changedFilesCount === 0) return 'initial build';
    return `${changedFilesCount} changed file${changedFilesCount === 1 ? '' : 's'}`;
};

class ConsoleCompileReporter implements TCompileReporter {
    public start(compilerName: string, changedFiles: string[]) {
        console.info(
            [
                colorize('compiler:start', ansi.bold, ansi.cyan),
                colorize(compilerName, ansi.bold),
                colorize(formatChangedFiles(changedFiles.length), ansi.dim),
            ].join('  '),
        );
    }

    public finish(compilerName: string, { succeeded, durationMs }: { succeeded: boolean; durationMs: number }) {
        console.info(
            [
                colorize(succeeded ? 'compiler:done' : 'compiler:fail', ansi.bold, succeeded ? ansi.green : ansi.red),
                colorize(compilerName, ansi.bold),
                colorize(formatDuration(durationMs), ansi.dim),
            ].join('  '),
        );
    }

    public stop() {}
}

export const createCompileReporter = ({ enabled }: { enabled: boolean }): TCompileReporter => {
    if (!enabled) return createNoopCompileReporter();

    return new ConsoleCompileReporter();
};
