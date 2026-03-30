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

export const clearInteractiveConsole = () => {
    if (process.stdout.isTTY !== true || process.env.TERM === 'dumb') return;

    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
};

export const renderWelcomePanel = async ({
    version,
    tagline,
}: {
    version: string;
    tagline: string;
}) =>
    renderInk(({ Box, Text }) => {
        const createElement = React.createElement;
        const wordmark = ProteumWordmark.map((line) =>
            createElement(Text, { key: line, bold: true, color: 'blue' }, line),
        );
        const versionLabel = version ? `v${version}` : '';

        return createElement(
            Box,
            { borderStyle: 'round', borderColor: 'blue', paddingX: 2, paddingY: 0, flexDirection: 'column' },
            createElement(Text, { bold: true, backgroundColor: 'blue', color: 'white' }, ' WELCOME TO '),
            createElement(Box, { flexDirection: 'column' }, ...wordmark),
            versionLabel ? createElement(Text, { bold: true, color: 'blue' }, versionLabel) : null,
            createElement(Text, { dimColor: true }, tagline),
        );
    });

export const renderCliWelcomeBanner = async ({
    command,
    version,
}: {
    command: string;
    version: string;
}) =>
    [
        await renderWelcomePanel({
            version,
            tagline: 'Explicit SSR / SEO / TypeScript framework for agent-friendly apps.',
        }),
        renderRows(
            [
                { label: 'command', value: command },
                { label: 'shutdown', value: 'CTRL+C' },
            ],
            { minLabelWidth: 10, maxLabelWidth: 10 },
        ),
    ].join('\n\n');
