import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createProteumMcpServer, type TProteumMcpProvider } from '../../common/dev/mcpServer';

export const startProteumMcpStdioServer = async ({
    provider,
    version,
}: {
    provider: TProteumMcpProvider;
    version: string;
}) => {
    const server = createProteumMcpServer({ provider, version });
    const transport = new StdioServerTransport();

    await server.connect(transport);
};
