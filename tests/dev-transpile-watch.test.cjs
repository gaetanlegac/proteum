const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

const toPublicAssetUrl = (appRoot, filepath) => {
    const publicRoot = path.join(appRoot, 'dev', 'public');
    const relativePath = path.relative(publicRoot, filepath).split(path.sep).join('/');

    return `/public/${relativePath}`;
};

const request = async (port, urlPath, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers });
    const body = await response.text();

    return { response, body };
};

const waitForHeader = async (port, urlPath, headerName, expectedValue, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const { response } = await request(port, urlPath, { Accept: 'text/html' });
        if (response.headers.get(headerName) === expectedValue) return response;

        await sleep(250);
    }

    throw new Error(`Timed out waiting for ${urlPath} header ${headerName}=${expectedValue}.`);
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

const waitForBodyContaining = async (port, urlPath, marker, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const { body } = await request(port, urlPath, { Accept: 'text/html' });
            if (body.includes(marker)) return body;
        } catch {}

        await sleep(250);
    }

    throw new Error(`Timed out waiting for ${urlPath} body containing ${marker}.`);
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

const createFixture = (root, port, options = {}) => {
    const monorepoRootInstall = options.monorepoRootInstall === true;
    const appRoot = monorepoRootInstall ? path.join(root, 'apps', 'app') : path.join(root, 'app');
    const sharedRoot = monorepoRootInstall ? path.join(root, 'packages', 'shared') : path.join(root, 'shared');
    const sharedDependency = monorepoRootInstall ? 'file:../../packages/shared' : 'file:../shared';
    const sharedInstallRoot = monorepoRootInstall
        ? path.join(root, 'node_modules', '@test', 'shared')
        : path.join(appRoot, 'node_modules', '@test', 'shared');
    const cacheConfigSource = options.routerCache ? `        cache: ${options.routerCache},\n` : '';

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
                    '@test/shared': sharedDependency,
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
${cacheConfigSource}
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
        `import { defineApplication } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';

import * as appConfig from '@/server/config/app';

export default defineApplication({
    services: () => ({}),
    router: (app) =>
        new Router(
            app,
            {
                ...appConfig.routerBaseConfig,
                plugins: {
                    schema: new SchemaRouter({}, app),
                },
            },
            app,
        ),
});
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
}
`,
    );
    writeFile(
        path.join(appRoot, 'client', 'pages', 'index.tsx'),
        `import { definePageRoute } from '@common/router/definitions';
import { SharedMarker } from '@test/shared';

export default definePageRoute({
    path: '/',
    options: {
        auth: false,
        layout: false,
    },
    data: null,
    render: () => {
        return (
            <main>
                <SharedMarker />
            </main>
        );
    },
});
`,
    );
    if (options.staticPage) {
        writeFile(
            path.join(appRoot, 'client', 'pages', 'static-cache.tsx'),
            `import { definePageRoute } from '@common/router/definitions';
import { SharedMarker } from '@test/shared';

export default definePageRoute({
    path: '/static-cache',
    options: {
        auth: false,
        layout: false,
        static: { urls: ['/static-cache'] },
    },
    data: null,
    render: () => {
        return (
            <main>
                <SharedMarker />
            </main>
        );
    },
});
`,
        );
    }

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
    createSymlink(sharedRoot, sharedInstallRoot);

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

const startDevServer = (appRoot, port, sessionFile, options = {}) => {
    let output = '';
    const args = [cliBin, 'dev', '--cwd', appRoot, '--port', String(port), '--session-file', sessionFile];
    if (options.noCache !== false) args.push('--no-cache');
    args.push('--verbose');
    const child = spawn(
        process.execPath,
        args,
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

    return {
        child,
        getOutput: () => output,
    };
};

test('proteum dev invalidates client assets and reloads for transpiled package scripts and styles', { timeout: 180000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-transpile-watch-'));
    const port = await resolvePortPair();
    const { appRoot, sharedRoot } = createFixture(root, port);
    const sessionFile = path.join(appRoot, 'var', 'run', 'proteum', 'dev', 'transpile-watch-test.json');
    const { child, getOutput } = startDevServer(appRoot, port, sessionFile);

    try {
        await waitForSessionReady(sessionFile, child, getOutput);
        await request(port, '/', { Accept: 'text/html' });

        const initialScriptAsset = await waitForAssetContaining(appRoot, '.js', 'SCRIPT_MARKER_INITIAL').catch(
            (error) => {
                throw new Error(`${error.message}\n${getOutput()}`);
            },
        );
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

test(
    'proteum dev invalidates SSR and client assets for monorepo-root transpiled package installs',
    { timeout: 180000 },
    async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-monorepo-transpile-watch-'));
        const port = await resolvePortPair();
        const { appRoot, sharedRoot } = createFixture(root, port, { monorepoRootInstall: true });
        const sessionFile = path.join(appRoot, 'var', 'run', 'proteum', 'dev', 'monorepo-transpile-watch-test.json');
        const { child, getOutput } = startDevServer(appRoot, port, sessionFile, { noCache: false });

        try {
            await waitForSessionReady(sessionFile, child, getOutput);
            await waitForBodyContaining(port, '/', 'SCRIPT_MARKER_INITIAL').catch((error) => {
                throw new Error(`${error.message}\n${getOutput()}`);
            });
            await waitForAssetContaining(appRoot, '.js', 'SCRIPT_MARKER_INITIAL').catch((error) => {
                throw new Error(`${error.message}\n${getOutput()}`);
            });

            const reloadStream = await connectToReloadStream(port + 1);
            writeFile(path.join(sharedRoot, 'index.tsx'), createSharedIndexSource('SCRIPT_MARKER_MONOREPO_UPDATED'));

            await waitForAssetContaining(appRoot, '.js', 'SCRIPT_MARKER_MONOREPO_UPDATED');
            await waitForBodyContaining(port, '/', 'SCRIPT_MARKER_MONOREPO_UPDATED');
            const reloadEvent = await reloadStream.waitForReload();
            reloadStream.close();

            assert.equal(reloadEvent.type, 'reload');
        } finally {
            await stopDevServer(child);
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);

test('proteum dev applies router HTTP cache config to HTML and public assets', { timeout: 180000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-router-cache-'));
    const port = await resolvePortPair();
    const dynamicHtmlCacheControl = 'private, max-age=7';
    const staticHtmlCacheControl = 'private, max-age=13';
    const publicAssetCacheControl = 'private, max-age=17';
    const { appRoot } = createFixture(root, port, {
        staticPage: true,
        routerCache: `{
            html: {
                dynamic: { cacheControl: '${dynamicHtmlCacheControl}', surrogateControl: 'dynamic-surrogate' },
                static: { cacheControl: '${staticHtmlCacheControl}', surrogateControl: 'static-surrogate' },
            },
            publicAssets: {
                dev: '${publicAssetCacheControl}',
                versioned: '${publicAssetCacheControl}',
                unversioned: '${publicAssetCacheControl}',
                etag: false,
                lastModified: false,
            },
        }`,
    });
    const sessionFile = path.join(appRoot, 'var', 'run', 'proteum', 'dev', 'router-cache-test.json');
    const { child, getOutput } = startDevServer(appRoot, port, sessionFile);

    try {
        await waitForSessionReady(sessionFile, child, getOutput);

        const { response: dynamicResponse } = await request(port, '/', { Accept: 'text/html' });
        assert.equal(dynamicResponse.headers.get('cache-control'), dynamicHtmlCacheControl);
        assert.equal(dynamicResponse.headers.get('surrogate-control'), 'dynamic-surrogate');

        const staticResponse = await waitForHeader(port, '/static-cache', 'cache-control', staticHtmlCacheControl);
        assert.equal(staticResponse.headers.get('surrogate-control'), 'static-surrogate');

        const asset = await waitForAssetContaining(appRoot, '.js', 'SCRIPT_MARKER_INITIAL').catch((error) => {
            throw new Error(`${error.message}\n${getOutput()}`);
        });
        const { response: assetResponse } = await request(port, toPublicAssetUrl(appRoot, asset));

        assert.equal(assetResponse.headers.get('cache-control'), publicAssetCacheControl);
        assert.equal(assetResponse.headers.get('etag'), null);
        assert.equal(assetResponse.headers.get('last-modified'), null);
    } finally {
        await stopDevServer(child);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
