const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const coreRoot = path.resolve(__dirname, '..');
const cliBin = path.join(coreRoot, 'cli', 'bin.js');

const sleep = async (durationMs) => await new Promise((resolve) => setTimeout(resolve, durationMs));

const writeFile = (filepath, content) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const createSymlink = (target, linkPath) => {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath, 'dir');
};

const canListen = async (port) =>
    await new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });

const resolvePortPair = async () => {
    for (let port = 34000; port < 39000; port += 2) {
        if ((await canListen(port)) && (await canListen(port + 1))) return port;
    }

    throw new Error('Unable to find a free port pair for the dev server and HMR stream.');
};

const walkFiles = (root, predicate, output = []) => {
    if (!fs.existsSync(root)) return output;

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const filepath = path.join(root, entry.name);

        if (entry.isDirectory()) {
            walkFiles(filepath, predicate, output);
            continue;
        }

        if (predicate(filepath)) output.push(filepath);
    }

    return output;
};

const findAssetContaining = (appRoot, extension, marker) => {
    const publicRoot = path.join(appRoot, 'dev', 'public');
    const candidates = walkFiles(publicRoot, (filepath) => filepath.endsWith(extension));

    return candidates.find((filepath) => fs.readFileSync(filepath, 'utf8').includes(marker));
};

const waitForAssetContaining = async (appRoot, extension, marker, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const filepath = findAssetContaining(appRoot, extension, marker);
        if (filepath) return filepath;
        await sleep(250);
    }

    throw new Error(`Timed out waiting for ${extension} asset containing ${marker}.`);
};

const waitForSessionReady = async (sessionFile, child, getOutput, timeoutMs = 90000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`proteum dev exited early with ${child.exitCode}.\n${getOutput()}`);
        }

        try {
            const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
            if (session.state === 'ready' && session.publicUrl) return session;
        } catch {}

        await sleep(250);
    }

    throw new Error(`Timed out waiting for proteum dev to become ready.\n${getOutput()}`);
};

const connectToReloadStream = async (hmrPort) => {
    let request;

    const eventPromise = new Promise((resolve, reject) => {
        request = http.request(
            {
                hostname: '127.0.0.1',
                port: hmrPort,
                path: '/__proteum_hmr',
                method: 'GET',
                headers: {
                    Accept: 'text/event-stream',
                },
            },
            (response) => {
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    for (const line of chunk.split('\n')) {
                        if (!line.startsWith('data:')) continue;

                        try {
                            const event = JSON.parse(line.slice('data:'.length).trim());
                            if (event.type === 'reload') {
                                resolve(event);
                                request.destroy();
                            }
                        } catch (error) {
                            reject(error);
                        }
                    }
                });
            },
        );

        request.on('error', reject);
        request.end();
    });

    await sleep(250);

    return {
        waitForReload: async (timeoutMs = 60000) =>
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timed out waiting for an HMR reload event.'));
                }, timeoutMs);

                eventPromise.then(
                    (event) => {
                        clearTimeout(timeout);
                        resolve(event);
                    },
                    (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    },
                );
            }),
        close: () => request?.destroy(),
    };
};

const createSharedIndexSource = (marker) => `import React from 'react';
import './styles.css';

export const SharedMarker = () => {
    return <strong className="shared-marker shared-style-marker">${marker}</strong>;
};
`;

const createSharedStyleSource = (marker) => `.shared-style-marker {
    --shared-watch-marker: "${marker}";
    color: rgb(25, 45, 65);
}
`;

const createFixture = (root, port) => {
    const appRoot = path.join(root, 'app');
    const sharedRoot = path.join(root, 'shared');

    fs.mkdirSync(path.join(appRoot, 'public'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'client', 'assets', 'identity'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'client', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'server', 'config'), { recursive: true });
    fs.mkdirSync(sharedRoot, { recursive: true });

    writeFile(
        path.join(appRoot, 'package.json'),
        JSON.stringify(
            {
                name: 'proteum-transpile-watch-fixture',
                private: true,
                version: '0.0.0',
                dependencies: {
                    '@test/shared': 'file:../shared',
                    proteum: `file:${coreRoot}`,
                },
            },
            null,
            4,
        ) + '\n',
    );
    writeFile(
        path.join(appRoot, '.env'),
        `ENV_NAME=local
ENV_PROFILE=dev
PORT=${port}
URL=http://localhost:${port}
URL_INTERNAL=http://localhost:${port}
`,
    );
    writeFile(
        path.join(appRoot, 'identity.config.ts'),
        `import { Application } from 'proteum/config';

export default Application.identity({
    name: 'Transpile Watch Fixture',
    identifier: 'TranspileWatchFixture',
    description: 'Proteum transpile watcher fixture.',
    author: {
        name: 'Proteum',
        url: 'localhost',
        email: 'team@example.com',
    },
    social: {},
    language: 'en',
    locale: 'en-US',
    maincolor: 'white',
    iconsPack: 'light',
    web: {
        title: 'Transpile Watch Fixture',
        titleSuffix: 'Transpile Watch Fixture',
        fullTitle: 'Transpile Watch Fixture',
        description: 'Proteum transpile watcher fixture.',
        version: '0.0.0',
    },
});
`,
    );
    writeFile(
        path.join(appRoot, 'proteum.config.ts'),
        `import { Application } from 'proteum/config';

export default Application.setup({
    transpile: ['@test/shared'],
    connect: {},
});
`,
    );
    writeFile(
        path.join(appRoot, 'client', 'assets', 'identity', 'logo.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="12" fill="#111827"/>
    <path d="M18 42V22h15c8 0 13 4 13 10s-5 10-13 10H18Zm8-7h7c4 0 6-1 6-3s-2-3-6-3h-7v6Z" fill="#ffffff"/>
</svg>
`,
    );
    writeFile(
        path.join(appRoot, 'client', 'tsconfig.json'),
        `{
    "extends": "../node_modules/proteum/tsconfig.common.json",
    "compilerOptions": {
        "rootDir": "..",
        "baseUrl": "..",
        "jsx": "react-jsx",
        "jsxImportSource": "preact",
        "paths": {
            "@client/*": ["./node_modules/proteum/client/*"],
            "@common/*": ["./node_modules/proteum/common/*"],
            "@server/*": ["./node_modules/proteum/server/*"],
            "@/client/context": ["./.proteum/client/context.ts"],
            "@generated/client/*": ["./.proteum/client/*"],
            "@generated/common/*": ["./.proteum/common/*"],
            "@generated/server/*": ["./.proteum/server/*"],
            "@/*": ["./*"],
            "react": ["./node_modules/preact/compat"],
            "react-dom/client": ["./node_modules/preact/compat/client"],
            "react-dom/test-utils": ["./node_modules/preact/test-utils"],
            "react-dom": ["./node_modules/preact/compat"],
            "react/jsx-runtime": ["./node_modules/preact/jsx-runtime"]
        }
    },
    "include": [".", "../server/index.ts"]
}
`,
    );
    writeFile(
        path.join(appRoot, 'server', 'tsconfig.json'),
        `{
    "extends": "../node_modules/proteum/tsconfig.common.json",
    "compilerOptions": {
        "rootDir": "..",
        "baseUrl": "..",
        "jsx": "react-jsx",
        "jsxImportSource": "preact",
        "moduleSuffixes": [".ssr", ""],
        "paths": {
            "@client/*": ["./node_modules/proteum/client/*"],
            "@common/*": ["./node_modules/proteum/common/*"],
            "@server/*": ["./node_modules/proteum/server/*"],
            "@/client/context": ["./.proteum/client/context.ts"],
            "@generated/client/*": ["./.proteum/client/*"],
            "@generated/common/*": ["./.proteum/common/*"],
            "@generated/server/*": ["./.proteum/server/*"],
            "@/*": ["./*"],
            "react": ["./node_modules/preact/compat"],
            "react-dom/client": ["./node_modules/preact/compat/client"],
            "react-dom/test-utils": ["./node_modules/preact/test-utils"],
            "react-dom": ["./node_modules/preact/compat"],
            "react/jsx-runtime": ["./node_modules/preact/jsx-runtime"]
        }
    },
    "include": [".", "../identity.config.ts", "../proteum.config.ts", "../server/index.ts"]
}
`,
    );
    writeFile(
        path.join(appRoot, 'server', 'config', 'app.ts'),
        `import { type ServiceConfig } from '@server/app';
import AppContainer from '@server/app/container';
import Router from '@server/services/router';

type RouterBaseConfig = Omit<ServiceConfig<typeof Router>, 'plugins'>;

const currentDomain = AppContainer.Environment.router.currentDomain;
const currentUrl = new URL(currentDomain);

export const routerBaseConfig = {
    currentDomain,
    http: {
        domain: currentUrl.hostname,
        port: AppContainer.Environment.router.port,
        ssl: currentUrl.protocol === 'https:',
        upload: {
            maxSize: '10mb',
        },
        csp: {
            scripts: [],
        },
    },
    context: () => ({}),
} satisfies RouterBaseConfig;
`,
    );
    writeFile(
        path.join(appRoot, 'server', 'index.ts'),
        `import { Application } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';

import * as appConfig from '@/server/config/app';

export default class TranspileWatchFixture extends Application {
    public Router = new Router(
        this,
        {
            ...appConfig.routerBaseConfig,
            plugins: {
                schema: new SchemaRouter({}, this),
            },
        },
        this,
    );
}
`,
    );
    writeFile(
        path.join(appRoot, 'client', 'index.ts'),
        `import ClientApplication from '@client/app';
import Router from '@client/services/router';

export default class TranspileWatchClient extends ClientApplication {
    public Router = new Router(this, {
        preload: [],
        context: () => ({}),
    });

    public boot() {}
    public handleUpdate() {}
    public handleError(error: Error) {
        throw error;
    }
}
`,
    );
    writeFile(
        path.join(appRoot, 'client', 'pages', 'index.tsx'),
        `import Router from '@/client/router';
import { SharedMarker } from '@test/shared';

Router.page(
    '/',
    {
        auth: false,
        layout: false,
    },
    null,
    () => {
        return (
            <main>
                <SharedMarker />
            </main>
        );
    },
);
`,
    );

    writeFile(
        path.join(sharedRoot, 'package.json'),
        JSON.stringify(
            {
                name: '@test/shared',
                version: '0.0.0',
                private: true,
                main: './index.tsx',
                sideEffects: true,
            },
            null,
            4,
        ) + '\n',
    );
    writeFile(path.join(sharedRoot, 'index.tsx'), createSharedIndexSource('SCRIPT_MARKER_INITIAL'));
    writeFile(path.join(sharedRoot, 'styles.css'), createSharedStyleSource('STYLE_MARKER_INITIAL'));

    createSymlink(coreRoot, path.join(appRoot, 'node_modules', 'proteum'));
    createSymlink(sharedRoot, path.join(appRoot, 'node_modules', '@test', 'shared'));

    return {
        appRoot,
        sharedRoot,
    };
};

const stopDevServer = async (child) => {
    if (child.exitCode !== null) return;

    child.kill('SIGTERM');

    await new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
            resolve();
        }, 10000);

        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
};

test('proteum dev invalidates client assets and reloads for transpiled package scripts and styles', { timeout: 180000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-transpile-watch-'));
    const port = await resolvePortPair();
    const { appRoot, sharedRoot } = createFixture(root, port);
    const sessionFile = path.join(appRoot, 'var', 'run', 'proteum', 'dev', 'transpile-watch-test.json');
    let output = '';

    const child = spawn(
        process.execPath,
        [cliBin, 'dev', '--cwd', appRoot, '--port', String(port), '--session-file', sessionFile, '--no-cache', '--verbose'],
        {
            cwd: appRoot,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
                NODE_ENV: 'development',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );

    child.stdout.on('data', (chunk) => {
        output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
        output += chunk.toString();
    });

    try {
        await waitForSessionReady(sessionFile, child, () => output);

        const initialScriptAsset = await waitForAssetContaining(appRoot, '.js', 'SCRIPT_MARKER_INITIAL');
        const initialScriptContent = fs.readFileSync(initialScriptAsset, 'utf8');
        const scriptReloadStream = await connectToReloadStream(port + 1);

        writeFile(path.join(sharedRoot, 'index.tsx'), createSharedIndexSource('SCRIPT_MARKER_UPDATED'));

        const updatedScriptAsset = await waitForAssetContaining(appRoot, '.js', 'SCRIPT_MARKER_UPDATED');
        const scriptReloadEvent = await scriptReloadStream.waitForReload();
        scriptReloadStream.close();

        assert.equal(updatedScriptAsset, initialScriptAsset);
        assert.notEqual(fs.readFileSync(updatedScriptAsset, 'utf8'), initialScriptContent);
        assert.equal(scriptReloadEvent.type, 'reload');

        const initialStyleAsset = await waitForAssetContaining(appRoot, '.css', 'STYLE_MARKER_INITIAL');
        const initialStyleContent = fs.readFileSync(initialStyleAsset, 'utf8');
        const styleReloadStream = await connectToReloadStream(port + 1);

        writeFile(path.join(sharedRoot, 'styles.css'), createSharedStyleSource('STYLE_MARKER_UPDATED'));

        const updatedStyleAsset = await waitForAssetContaining(appRoot, '.css', 'STYLE_MARKER_UPDATED');
        const styleReloadEvent = await styleReloadStream.waitForReload();
        styleReloadStream.close();

        assert.equal(updatedStyleAsset, initialStyleAsset);
        assert.notEqual(fs.readFileSync(updatedStyleAsset, 'utf8'), initialStyleContent);
        assert.equal(styleReloadEvent.type, 'reload');
    } finally {
        await stopDevServer(child);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
