import cli from '..';
import { CliProteumMcpProvider } from '../mcp/provider';
import { startProteumMcpStdioServer } from '../mcp/stdio';

export const run = async () => {
    const provider = new CliProteumMcpProvider({
        appRoot: cli.paths.appRoot,
        sessionFilePath: typeof cli.args.sessionFile === 'string' && cli.args.sessionFile ? cli.args.sessionFile : undefined,
        url: typeof cli.args.url === 'string' && cli.args.url ? cli.args.url : undefined,
    });

    await startProteumMcpStdioServer({
        provider,
        version: String(cli.packageJson.version || ''),
    });
};
