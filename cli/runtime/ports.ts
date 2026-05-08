import net from 'net';
import path from 'path';

import fs from 'fs-extra';
import got from 'got';

export type TProteumRuntimePortProbe = {
    app?: {
        appRoot?: string;
        identifier?: string;
        name?: string;
    };
    available: boolean;
    error?: string;
    listening: boolean;
    matchesApp: boolean;
    port: number;
    proteum: boolean;
    publicUrl: string;
    statusCode?: number;
};

export type TDevPortInspection = {
    canStartOnConfiguredPort: boolean;
    hmr: {
        available: boolean;
        port: number;
    };
    recommendedPort?: number;
    router: TProteumRuntimePortProbe;
};

const normalizePath = (value: string) => {
    const resolved = path.resolve(value);

    try {
        return path.normalize(fs.realpathSync(resolved));
    } catch {
        return path.normalize(resolved);
    }
};

export const isTcpPortAvailable = async (port: number) =>
    await new Promise<boolean>((resolve) => {
        const server = net.createServer();

        server.once('error', () => {
            resolve(false);
        });

        server.once('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen(port, '127.0.0.1');
    });

export const areTcpPortsAvailable = async (ports: number[]) => {
    const availability = await Promise.all(ports.map((port) => isTcpPortAvailable(port)));
    return availability.every(Boolean);
};

export const findAvailableDevPort = async (startPort: number, { maxOffset = 30 }: { maxOffset?: number } = {}) => {
    const normalizedStartPort = Math.max(1, Math.floor(startPort));

    for (let port = normalizedStartPort; port <= normalizedStartPort + maxOffset; port += 1) {
        if (await areTcpPortsAvailable([port, port + 1])) return port;
    }

    return undefined;
};

export const probeProteumRuntimePort = async ({
    appRoot,
    port,
}: {
    appRoot: string;
    port: number;
}): Promise<TProteumRuntimePortProbe> => {
    const publicUrl = `http://localhost:${port}`;
    const available = await isTcpPortAvailable(port);

    if (available) {
        return {
            available: true,
            listening: false,
            matchesApp: false,
            port,
            proteum: false,
            publicUrl,
        };
    }

    try {
        const response = await got(`http://127.0.0.1:${port}/__proteum/explain?section=app`, {
            responseType: 'json',
            retry: { limit: 0 },
            throwHttpErrors: false,
            timeout: { request: 700 },
        });
        const body = response.body as { app?: { root?: unknown; identity?: { identifier?: unknown; name?: unknown } } };
        const root = typeof body.app?.root === 'string' ? body.app.root : undefined;
        const identifier = typeof body.app?.identity?.identifier === 'string' ? body.app.identity.identifier : undefined;
        const name = typeof body.app?.identity?.name === 'string' ? body.app.identity.name : undefined;
        const proteum = response.statusCode < 400 && Boolean(root || identifier || name);

        return {
            app: proteum ? { appRoot: root, identifier, name } : undefined,
            available: false,
            error: proteum ? undefined : `Proteum explain endpoint returned HTTP ${response.statusCode}.`,
            listening: true,
            matchesApp: Boolean(root && normalizePath(root) === normalizePath(appRoot)),
            port,
            proteum,
            publicUrl,
            statusCode: response.statusCode,
        };
    } catch (error) {
        return {
            available: false,
            error: error instanceof Error ? error.message : String(error),
            listening: true,
            matchesApp: false,
            port,
            proteum: false,
            publicUrl,
        };
    }
};

export const inspectDevPort = async ({
    appRoot,
    port,
}: {
    appRoot: string;
    port: number;
}): Promise<TDevPortInspection> => {
    const router = await probeProteumRuntimePort({ appRoot, port });
    const hmr = {
        port: port + 1,
        available: await isTcpPortAvailable(port + 1),
    };
    const canStartOnConfiguredPort = router.available && hmr.available;

    return {
        canStartOnConfiguredPort,
        hmr,
        recommendedPort: canStartOnConfiguredPort ? port : await findAvailableDevPort(port + 1),
        router,
    };
};
