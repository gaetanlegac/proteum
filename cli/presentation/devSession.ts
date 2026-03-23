const React = require('react') as typeof import('react');

import { renderRows } from './layout';
import { renderInk } from './ink';

const ProteumWordmark = [
    String.raw` ____  ____   ___ _____ _____ _   _ __  __`,
    String.raw`|  _ \|  _ \ / _ \_   _| ____| | | |  \/  |`,
    String.raw`| |_) | |_) | | | || | |  _| | | | | |\/| |`,
    String.raw`|  __/|  _ <| |_| || | | |___| |_| | |  | |`,
    String.raw`|_|   |_| \_\\___/ |_| |_____|\___/|_|  |_|`,
];

export const renderDevSession = async ({
    appName,
    appRoot,
    routerPort,
    devEventPort,
}: {
    appName: string;
    appRoot: string;
    routerPort: number;
    devEventPort: number;
}) =>
    [
        await renderInk(({ Box, Text }) => {
            const createElement = React.createElement;
            const wordmark = ProteumWordmark.map((line) =>
                createElement(Text, { key: line, bold: true, color: 'cyan' }, line),
            );

            return createElement(
                Box,
                { borderStyle: 'round', borderColor: 'cyan', paddingX: 2, paddingY: 0, flexDirection: 'column' },
                createElement(Text, { bold: true, color: 'green' }, 'PROTEUM DEV'),
                createElement(Text, { dimColor: true }, 'Agent-first SSR compiler and server loop.'),
                createElement(Box, { flexDirection: 'column', marginTop: 1 }, ...wordmark),
            );
        }),
        renderRows(
            [
                { label: 'app', value: appName },
                { label: 'root', value: appRoot },
                { label: 'router', value: `http://localhost:${routerPort}` },
                { label: 'hmr', value: `http://localhost:${devEventPort}/__proteum_hmr` },
                { label: 'hotkeys', value: 'Ctrl+R reload, Ctrl+C stop' },
            ],
            { minLabelWidth: 12, maxLabelWidth: 12 },
        ),
    ].join('\n\n');

export const renderServerReadyBanner = async ({
    appName,
    publicUrl,
}: {
    appName: string;
    publicUrl: string;
}) =>
    renderInk(({ Box, Text }) => {
        const createElement = React.createElement;

        return createElement(
            Box,
            { borderStyle: 'round', borderColor: 'green', paddingX: 2, paddingY: 0, flexDirection: 'column' },
            createElement(Text, { bold: true, backgroundColor: 'green', color: 'black' }, ' SERVER READY '),
            createElement(Text, { bold: true, color: 'green' }, appName),
            createElement(Text, { bold: true }, publicUrl),
            createElement(Text, { dimColor: true }, 'SSR server is listening for requests and hot reloads.'),
        );
    });
