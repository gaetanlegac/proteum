const React = require('react') as typeof import('react');

import { renderRows } from './layout';
import { renderInk } from './ink';
import { renderWelcomePanel } from './welcome';

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
        await renderWelcomePanel({
            version: proteumVersion,
            tagline: 'Agent-first SSR compiler and server loop.',
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
                { label: 'reload', value: 'CTRL+R' },
                { label: 'shutdown', value: 'CTRL+C' },
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
