import { CliReact, renderInk } from './ink';

export type TMcpDaemonBannerState = 'started' | 'connected';

export const renderMcpDaemonBanner = async ({
    mcpUrl,
    pid,
    state,
}: {
    mcpUrl: string;
    pid?: number;
    state: TMcpDaemonBannerState;
}) =>
    renderInk(({ Box, Text }) => {
        const createElement = CliReact.createElement;
        const summary =
            state === 'started' ? 'Launched central MCP server.' : 'Connected to central MCP server.';
        const pidLabel = pid ? ` pid ${pid}` : '';

        return createElement(
            Box,
            { borderStyle: 'round', borderColor: 'cyan', paddingX: 2, paddingY: 0, flexDirection: 'column' },
            createElement(Text, { bold: true, backgroundColor: 'cyan', color: 'black' }, ' CENTRAL MCP READY '),
            createElement(Text, { bold: true, color: 'cyan' }, `${summary}${pidLabel}`),
            createElement(Text, { dimColor: true }, `Connect MCP client (HTTP): ${mcpUrl}`),
        );
    });
