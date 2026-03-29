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

const ProteumTagline = 'Agent-first SSR compiler and server loop.';

export const renderDevSession = async ({
    appName,
    appRoot,
    routerPort,
    devEventPort,
    connectedProjects,
    proteumVersion,
}: {
    appName: string;
    appRoot: string;
    routerPort: number;
    devEventPort: number;
    connectedProjects?: Array<{ namespace: string; urlInternal: string }>;
    proteumVersion: string;
}) =>
    [
        await renderInk(({ Box, Text }) => {
            const createElement = React.createElement;
            const wordmark = ProteumWordmark.map((line) =>
                createElement(Text, { key: line, bold: true, color: 'blue' }, line),
            );
            const versionLabel = proteumVersion ? `v${proteumVersion}` : '';

            return createElement(
                Box,
                { borderStyle: 'round', borderColor: 'blue', paddingX: 2, paddingY: 0, flexDirection: 'column' },
                createElement(Text, { bold: true, backgroundColor: 'blue', color: 'white' }, ' WELCOME TO '),
                createElement(Box, { flexDirection: 'column' }, ...wordmark),
                versionLabel ? createElement(Text, { bold: true, color: 'blue' }, versionLabel) : null,
                createElement(Text, { dimColor: true }, ProteumTagline),
            );
        }),
        renderRows(
            [
                { label: 'app', value: appName },
                { label: 'root', value: appRoot },
                { label: 'router', value: `http://localhost:${routerPort}` },
                { label: 'hmr', value: `http://localhost:${devEventPort}/__proteum_hmr` },
                ...(connectedProjects && connectedProjects.length > 0
                    ? connectedProjects.map((connectedProject) => ({
                          label: `connect ${connectedProject.namespace}`,
                          value: connectedProject.urlInternal,
                      }))
                    : []),
                { label: 'diagnose', value: `proteum diagnose / --port ${routerPort}` },
                { label: 'perf', value: `proteum perf top --port ${routerPort}` },
                { label: 'trace', value: `proteum trace latest --port ${routerPort}` },
                { label: 'trace deep', value: `proteum trace arm --capture deep --port ${routerPort}` },
                { label: 'hotkeys', value: 'Ctrl+R reload, Ctrl+C stop' },
            ],
            { minLabelWidth: 12, maxLabelWidth: 12 },
        ),
    ].join('\n\n');

export const renderServerReadyBanner = async ({
    appName,
    publicUrl,
    routerPort,
    connectedProjectsCount,
}: {
    appName: string;
    publicUrl: string;
    routerPort: number;
    connectedProjectsCount?: number;
}) =>
    renderInk(({ Box, Text }) => {
        const createElement = React.createElement;

        return createElement(
            Box,
            { borderStyle: 'round', borderColor: 'green', paddingX: 2, paddingY: 0, flexDirection: 'column' },
            createElement(Text, { bold: true, backgroundColor: 'green', color: 'white' }, ' SERVER READY '),
            createElement(Text, { bold: true, color: 'green' }, appName),
            createElement(Text, { bold: true }, publicUrl),
            createElement(Text, { dimColor: true }, 'SSR server is listening for requests and hot reloads.'),
            connectedProjectsCount
                ? createElement(
                      Text,
                      { dimColor: true },
                      `Connected projects: ${connectedProjectsCount}`,
                  )
                : null,
            createElement(Text, { dimColor: true }, `Diagnose /: proteum diagnose / --port ${routerPort}`),
            createElement(Text, { dimColor: true }, `Perf top: proteum perf top --port ${routerPort}`),
            createElement(Text, { dimColor: true }, `Trace latest: proteum trace latest --port ${routerPort}`),
        );
    });

export const renderDevShutdownBanner = async () =>
    renderInk(({ Box, Text }) => {
        const createElement = React.createElement;

        return createElement(
            Box,
            { borderStyle: 'round', borderColor: 'blue', paddingX: 2, paddingY: 0, flexDirection: 'column' },
            createElement(Text, { bold: true, backgroundColor: 'blue', color: 'white' }, ' SHUTTING DOWN '),
            createElement(Text, { bold: true, color: 'blue' }, 'Thank you for developping with Proteum'),
        );
    });
