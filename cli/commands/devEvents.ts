import http, { type IncomingMessage, type ServerResponse } from 'http';

export type TDevEvent = { type: 'reload'; reason: 'server' | 'manual' | 'client' };

const devEventsPath = '/__proteum_hmr';

export class DevEventServer {
    private readonly clients = new Set<ServerResponse<IncomingMessage>>();
    private readonly server = http.createServer(this.handleRequest.bind(this));

    public constructor(public port: number) {}

    public broadcast(event: TDevEvent) {
        const payload = `data: ${JSON.stringify(event)}\n\n`;

        for (const client of this.clients) {
            client.write(payload);
        }
    }

    public async close() {
        for (const client of this.clients) {
            client.end();
        }
        this.clients.clear();

        await new Promise<void>((resolve, reject) => {
            this.server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private handleRequest(request: IncomingMessage, response: ServerResponse<IncomingMessage>) {
        if (request.url !== devEventsPath) {
            response.statusCode = 404;
            response.end();
            return;
        }

        response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'Content-Type': 'text/event-stream',
            'X-Accel-Buffering': 'no',
        });
        response.write(': connected\n\n');
        response.socket?.setKeepAlive(true);
        this.clients.add(response);

        request.on('close', () => {
            this.clients.delete(response);
            response.end();
        });
    }

    public static async create(preferredPort: number) {
        const server = new DevEventServer(preferredPort);
        server.port = await server.listen(preferredPort);
        return server;
    }

    private async listen(preferredPort: number) {
        const initialPort = Number.isInteger(preferredPort) ? preferredPort : 0;

        return await new Promise<number>((resolve, reject) => {
            const tryListen = (port: number) => {
                const onError = (error: NodeJS.ErrnoException) => {
                    this.server.off('listening', onListening);

                    if (error.code === 'EADDRINUSE' && port !== 0) {
                        tryListen(port + 1);
                        return;
                    }

                    reject(error);
                };

                const onListening = () => {
                    this.server.off('error', onError);
                    const address = this.server.address();
                    if (!address || typeof address === 'string') {
                        reject(new Error('Unable to resolve the dev event server port.'));
                        return;
                    }

                    resolve(address.port);
                };

                this.server.once('error', onError);
                this.server.once('listening', onListening);
                this.server.listen(port, '0.0.0.0');
            };

            tryListen(initialPort);
        });
    }
}

export const createDevEventServer = async (preferredPort: number) => DevEventServer.create(preferredPort);
