const React = require('react') as typeof import('react');

import { importEsm } from '../runtime/importEsm';

type TInkModule = typeof import('ink');
type TInkUiModule = typeof import('@inkjs/ui');

type TCompileLoaderStatus = 'idle' | 'compiling' | 'success' | 'error';

type TCompileLoaderItem = {
    name: string;
    label: string;
    status: TCompileLoaderStatus;
    cycleCount: number;
    changedFilesCount: number;
    durationMs?: number;
};

type TCompileLoaderState = {
    mode: 'dev' | 'prod';
    items: TCompileLoaderItem[];
};

type TCompileLoaderProcessMessage =
    | { type: 'start'; compilerName: string; changedFilesCount: number }
    | { type: 'finish'; compilerName: string; succeeded: boolean; durationMs: number }
    | { type: 'stop' };

type TCompileLoaderEnvelope = {
    mode: 'dev' | 'prod';
    compilerNames: string[];
    message: TCompileLoaderProcessMessage;
};

type TInkRuntime = {
    render: TInkModule['render'];
    Box: TInkModule['Box'];
    Text: TInkModule['Text'];
    Spinner: TInkUiModule['Spinner'];
    StatusMessage: TInkUiModule['StatusMessage'];
};

type TInkInstance = ReturnType<TInkModule['render']>;

let inkRuntimePromise: Promise<TInkRuntime> | undefined;
let inkRuntime: TInkRuntime | undefined;
let inkInstance: TInkInstance | undefined;
let loaderState: TCompileLoaderState | undefined;
let messageQueue = Promise.resolve();

const loadInkRuntime = async () => {
    if (!inkRuntimePromise) {
        inkRuntimePromise = Promise.all([
            importEsm<TInkModule>('ink'),
            importEsm<TInkUiModule>('@inkjs/ui'),
        ]).then(([ink, inkUi]) => ({
            render: ink.render,
            Box: ink.Box,
            Text: ink.Text,
            Spinner: inkUi.Spinner,
            StatusMessage: inkUi.StatusMessage,
        }));
    }

    inkRuntime = await inkRuntimePromise;
    return inkRuntime;
};

const createInitialItems = (compilerNames: string[]) =>
    compilerNames.map((name) => ({
        name,
        label: name === 'server' ? 'Server bundle' : name === 'client' ? 'Client bundle' : `${name} bundle`,
        status: 'idle' as const,
        cycleCount: 0,
        changedFilesCount: 0,
    }));

const formatDuration = (durationMs: number) => {
    if (durationMs < 1000) return `${durationMs} ms`;
    if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)} s`;
    return `${Math.round(durationMs / 1000)} s`;
};

const getSummary = (state: TCompileLoaderState) => {
    const compilingItems = state.items.filter((item) => item.status === 'compiling');
    if (compilingItems.length === 0) {
        return state.mode === 'dev' ? 'Watching for the next compiler cycle.' : 'Preparing the compiler.';
    }

    const isRecompile = compilingItems.some((item) => item.cycleCount > 1);
    const labels = compilingItems.map((item) => item.label.toLowerCase()).join(' and ');

    if (isRecompile) return `Recompiling ${labels} after source changes.`;
    return `Compiling ${labels}.`;
};

const hasCompilingItems = (state: TCompileLoaderState) => state.items.some((item) => item.status === 'compiling');

const findItem = (state: TCompileLoaderState, compilerName: string) => {
    const item = state.items.find((entry) => entry.name === compilerName);
    if (!item) throw new Error(`Unknown compiler loader entry: ${compilerName}`);
    return item;
};

const renderApp = (state: TCompileLoaderState, runtime: TInkRuntime) => {
    const createElement = React.createElement;
    const { Box, Spinner, StatusMessage, Text } = runtime;

    return createElement(
        Box,
        { flexDirection: 'column' },
        createElement(Text, { bold: true, color: 'cyan' }, 'PROTEUM COMPILER'),
        createElement(Text, { dimColor: true }, getSummary(state)),
        createElement(
            Box,
            { flexDirection: 'column', marginTop: 1 },
            ...state.items.map((item) => {
                if (item.status === 'compiling') {
                    const details =
                        item.changedFilesCount > 0
                            ? `${item.label} · ${item.changedFilesCount} changed file${item.changedFilesCount > 1 ? 's' : ''}`
                            : `${item.label} · preparing output`;

                    return createElement(Spinner, {
                        key: item.name,
                        label: details,
                        type: item.cycleCount > 1 ? 'dots' : 'dots12',
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

const mount = async () => {
    if (!loaderState) return;

    const runtime = await loadInkRuntime();
    const node = renderApp(loaderState, runtime);

    if (inkInstance) {
        inkInstance.rerender(node);
        return;
    }

    inkInstance = runtime.render(node, {
        stdout: process.stderr,
        stderr: process.stderr,
        patchConsole: false,
        exitOnCtrlC: false,
        maxFps: 24,
        incrementalRendering: true,
    });
};

const clearLoader = () => {
    if (!inkInstance) return;

    inkInstance.clear();
    inkInstance.unmount();
    inkInstance.cleanup();
    inkInstance = undefined;
};

const handleStart = async (state: TCompileLoaderState, compilerName: string, changedFilesCount: number) => {
    if (!hasCompilingItems(state)) {
        for (const item of state.items) {
            item.status = 'idle';
            item.changedFilesCount = 0;
            item.durationMs = undefined;
        }
    }

    const item = findItem(state, compilerName);
    item.status = 'compiling';
    item.changedFilesCount = changedFilesCount;
    item.durationMs = undefined;
    item.cycleCount += 1;

    await mount();
};

const handleFinish = async (state: TCompileLoaderState, compilerName: string, succeeded: boolean, durationMs: number) => {
    const item = findItem(state, compilerName);
    item.status = succeeded ? 'success' : 'error';
    item.changedFilesCount = 0;
    item.durationMs = durationMs;

    const otherCompiling = state.items.some((entry) => entry.name !== compilerName && entry.status === 'compiling');

    if (!succeeded || !otherCompiling) {
        clearLoader();
        return;
    }

    await mount();
};

process.on('message', (envelope: TCompileLoaderEnvelope) => {
    messageQueue = messageQueue
        .then(async () => {
            if (!loaderState) {
                loaderState = {
                    mode: envelope.mode,
                    items: createInitialItems(envelope.compilerNames),
                };
            }

            loaderState.mode = envelope.mode;

            if (
                loaderState.items.length !== envelope.compilerNames.length ||
                loaderState.items.some((item, index) => item.name !== envelope.compilerNames[index])
            ) {
                loaderState.items = createInitialItems(envelope.compilerNames);
            }

            if (envelope.message.type === 'start') {
                await handleStart(loaderState, envelope.message.compilerName, envelope.message.changedFilesCount);
                return;
            }

            if (envelope.message.type === 'finish') {
                await handleFinish(
                    loaderState,
                    envelope.message.compilerName,
                    envelope.message.succeeded,
                    envelope.message.durationMs,
                );
                return;
            }

            clearLoader();
        })
        .catch((error) => {
            clearLoader();
            console.error(error);
        });
});

process.on('disconnect', () => {
    clearLoader();
    process.exit(0);
});
