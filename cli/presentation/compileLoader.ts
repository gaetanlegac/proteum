const React = require('react') as typeof import('react');

import { importEsm } from '../runtime/importEsm';

type TInkModule = typeof import('ink');
type TInkUiModule = typeof import('@inkjs/ui');

type TInkInstance = ReturnType<TInkModule['render']>;

type TCompileLoaderRuntime = {
    render: TInkModule['render'];
    Box: TInkModule['Box'];
    Text: TInkModule['Text'];
    Spinner: TInkUiModule['Spinner'];
    StatusMessage: TInkUiModule['StatusMessage'];
};

type TCompileLoaderStatus = 'idle' | 'compiling' | 'success' | 'error';

type TCompileLoaderItem = {
    name: string;
    label: string;
    status: TCompileLoaderStatus;
    cycleCount: number;
    changedFilesCount: number;
    durationMs?: number;
};

type TCompileLoaderAppProps = {
    mode: 'dev' | 'prod';
    items: TCompileLoaderItem[];
};

export type TCompileLoader = {
    start: (compilerName: string, changedFiles: string[]) => void;
    finish: (compilerName: string, options: { succeeded: boolean; durationMs: number }) => void;
    stop: () => void;
};

let compileLoaderRuntimePromise: Promise<TCompileLoaderRuntime> | undefined;

const loadCompileLoaderRuntime = () => {
    if (compileLoaderRuntimePromise) return compileLoaderRuntimePromise;

    compileLoaderRuntimePromise = Promise.all([
        importEsm<TInkModule>('ink'),
        importEsm<TInkUiModule>('@inkjs/ui'),
    ]).then(([ink, inkUi]) => ({
        render: ink.render,
        Box: ink.Box,
        Text: ink.Text,
        Spinner: inkUi.Spinner,
        StatusMessage: inkUi.StatusMessage,
    }));

    return compileLoaderRuntimePromise;
};

const formatDuration = (durationMs: number) => {
    if (durationMs < 1000) return `${durationMs} ms`;
    if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)} s`;
    return `${Math.round(durationMs / 1000)} s`;
};

const getLoaderSummary = (mode: 'dev' | 'prod', items: TCompileLoaderItem[]) => {
    const compilingItems = items.filter((item) => item.status === 'compiling');
    if (compilingItems.length === 0) {
        const completedItems = items.filter((item) => item.cycleCount > 0);

        if (completedItems.length === 0) {
            return mode === 'dev' ? 'Waiting for the first compiler cycle.' : 'Waiting for the compiler to start.';
        }

        return mode === 'dev' ? 'Compilation finished. Returning to watch mode.' : 'Compilation finished.';
    }

    const isRecompile = compilingItems.some((item) => item.cycleCount > 1);
    const labels = compilingItems.map((item) => item.label.toLowerCase()).join(' and ');

    if (isRecompile) return `Recompiling ${labels} after source changes.`;
    return `Compiling ${labels}.`;
};

const renderCompileLoaderApp = ({ mode, items }: TCompileLoaderAppProps, runtime: TCompileLoaderRuntime) => {
    const createElement = React.createElement;
    const { Box, Spinner, StatusMessage, Text } = runtime;

    return createElement(
        Box,
        { flexDirection: 'column' },
        createElement(Text, { bold: true, color: 'cyan' }, 'PROTEUM COMPILER'),
        createElement(Text, { dimColor: true }, getLoaderSummary(mode, items)),
        createElement(
            Box,
            { flexDirection: 'column', marginTop: 1 },
            ...items.map((item) => {
                if (item.status === 'compiling') {
                    const details =
                        item.changedFilesCount > 0
                            ? `${item.label} · ${item.changedFilesCount} changed file${item.changedFilesCount > 1 ? 's' : ''}`
                            : `${item.label} · preparing output`;

                    return createElement(Spinner, {
                        key: item.name,
                        label: details,
                        type: item.cycleCount > 1 ? 'dots' : 'arc',
                    });
                }

                if (item.status === 'success') {
                    return createElement(
                        StatusMessage,
                        { key: item.name, variant: 'success' },
                        `${item.label} compiled in ${formatDuration(item.durationMs || 0)}.`,
                    );
                }

                if (item.status === 'error') {
                    return createElement(
                        StatusMessage,
                        { key: item.name, variant: 'error' },
                        `${item.label} failed after ${formatDuration(item.durationMs || 0)}.`,
                    );
                }

                return createElement(Text, { key: item.name, dimColor: true }, `○ ${item.label} waiting`);
            }),
        ),
    );
};

const createNoopCompileLoader = (): TCompileLoader => ({
    start() {},
    finish() {},
    stop() {},
});

class LiveCompileLoader implements TCompileLoader {
    private instance?: TInkInstance;
    private readonly items: TCompileLoaderItem[];

    public constructor(
        private runtime: TCompileLoaderRuntime,
        private mode: 'dev' | 'prod',
        compilerNames: string[],
    ) {
        this.items = compilerNames.map((name) => ({
            name,
            label: name === 'server' ? 'Server bundle' : name === 'client' ? 'Client bundle' : `${name} bundle`,
            status: 'idle',
            cycleCount: 0,
            changedFilesCount: 0,
        }));
    }

    public start(compilerName: string, changedFiles: string[]) {
        if (!this.hasCompilingItems()) {
            for (const item of this.items) {
                item.status = 'idle';
                item.changedFilesCount = 0;
                item.durationMs = undefined;
            }
        }

        const item = this.getItem(compilerName);
        item.status = 'compiling';
        item.changedFilesCount = changedFiles.length;
        item.durationMs = undefined;
        item.cycleCount += 1;

        this.render();
    }

    public finish(compilerName: string, { succeeded, durationMs }: { succeeded: boolean; durationMs: number }) {
        const item = this.getItem(compilerName);
        item.status = succeeded ? 'success' : 'error';
        item.durationMs = durationMs;
        item.changedFilesCount = 0;
        const hasOtherCompilingItems = this.items.some(
            (entry) => entry.name !== compilerName && entry.status === 'compiling',
        );

        if (!succeeded || !hasOtherCompilingItems) {
            this.stop();
            return;
        }

        this.render();
    }

    public stop() {
        if (!this.instance) return;

        this.instance.clear();
        this.instance.unmount();
        this.instance.cleanup();
        this.instance = undefined;
    }

    private hasCompilingItems() {
        return this.items.some((item) => item.status === 'compiling');
    }

    private getItem(compilerName: string) {
        const item = this.items.find((entry) => entry.name === compilerName);
        if (!item) throw new Error(`Cannot update unknown compiler loader entry: ${compilerName}`);
        return item;
    }

    private render() {
        const node = renderCompileLoaderApp(
            {
                mode: this.mode,
                items: this.items,
            },
            this.runtime,
        );

        if (this.instance) {
            this.instance.rerender(node);
            return;
        }

        this.instance = this.runtime.render(node, {
            stdout: process.stderr,
            stderr: process.stderr,
            patchConsole: false,
            exitOnCtrlC: false,
            maxFps: 18,
            incrementalRendering: true,
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

    const runtime = await loadCompileLoaderRuntime();
    return new LiveCompileLoader(runtime, mode, compilerNames);
};
