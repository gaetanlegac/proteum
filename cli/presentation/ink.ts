const React = require('react') as typeof import('react');

import { importEsm } from '../runtime/importEsm';
import { getTerminalWidth } from './layout';

type TInkModule = typeof import('ink');
type TInkUiModule = typeof import('@inkjs/ui');

type TInkRuntime = {
    Box: TInkModule['Box'];
    Text: TInkModule['Text'];
    renderToString: TInkModule['renderToString'];
    StatusMessage: TInkUiModule['StatusMessage'];
};

let inkRuntimePromise: Promise<TInkRuntime> | undefined;

const loadInkRuntime = () => {
    if (inkRuntimePromise) return inkRuntimePromise;

    inkRuntimePromise = Promise.all([
        importEsm<TInkModule>('ink'),
        importEsm<TInkUiModule>('@inkjs/ui'),
    ]).then(([ink, inkUi]) => ({
        Box: ink.Box,
        Text: ink.Text,
        renderToString: ink.renderToString,
        StatusMessage: inkUi.StatusMessage,
    }));

    return inkRuntimePromise;
};

const renderInk = async (
    buildNode: (runtime: TInkRuntime) => import('react').ReactElement | null,
    columns = getTerminalWidth(),
) => {
    const runtime = await loadInkRuntime();
    return runtime.renderToString(buildNode(runtime), { columns });
};

export const renderTitle = async (title: string, subtitle?: string) =>
    renderInk(({ Box, Text }) => {
        const createElement = React.createElement;

        return createElement(
            Box,
            { flexDirection: 'column' },
            createElement(Text, { bold: true, color: 'cyan' }, title),
            subtitle ? createElement(Text, { dimColor: true }, subtitle) : null,
        );
    });

export const renderSection = async (title: string, body: string) => {
    const heading = await renderInk(({ Text }) => React.createElement(Text, { bold: true }, title));
    return `${heading}\n${body}`;
};

export const renderStep = async (label: string, message: string) =>
    renderInk(({ Text }) => React.createElement(Text, { color: 'cyan' }, `${label} ${message}`));

const renderStatusMessage = async (variant: 'success' | 'warning' | 'error', message: string) =>
    renderInk(({ StatusMessage }) => React.createElement(StatusMessage, { variant }, message));

export const renderSuccess = (message: string) => renderStatusMessage('success', message);

export const renderWarning = (message: string) => renderStatusMessage('warning', message);

export const renderDanger = (message: string) => renderStatusMessage('error', message);
