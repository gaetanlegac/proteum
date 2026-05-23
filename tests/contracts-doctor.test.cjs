const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { buildContractsDoctorResponse } = require('../common/dev/contractsDoctor.ts');

const touch = (filepath, content = '') => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
};

const createManifest = (appRoot, pageFilepath) => ({
    app: {
        identityFilepath: path.join(appRoot, 'identity.config.ts'),
        root: appRoot,
        setupFilepath: path.join(appRoot, 'proteum.config.ts'),
    },
    connectedProjects: [],
    commands: [],
    controllers: [],
    layouts: [],
    routes: {
        client: [
            {
                chunkFilepath: 'landing/index',
                filepath: pageFilepath,
            },
        ],
        server: [],
    },
    services: {
        app: [],
        routerPlugins: [],
    },
});

test('contracts doctor allows hooks inside definePageRoute render callbacks', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-contracts-doctor-'));
    const pageFilepath = path.join(appRoot, 'client/pages/landing/index.tsx');

    touch(path.join(appRoot, 'proteum.config.ts'), 'export default {};');
    touch(path.join(appRoot, 'identity.config.ts'), 'export default {};');
    touch(path.join(appRoot, 'client/hooks/useToast.ts'), 'export default function useToast() { return () => undefined; }');
    touch(
        pageFilepath,
        `import { definePageRoute } from '@common/router/definitions';
import useToast from '@/client/hooks/useToast';

export default definePageRoute({
    path: '/',
    options: {},
    data: null,
    render: () => {
        const toast = useToast();
        return toast ? null : null;
    },
});
`,
    );

    for (const filepath of [
        'proteum.connected.json',
        '.proteum/manifest.json',
        '.proteum/proteum.connected.d.ts',
        '.proteum/client/context.ts',
        '.proteum/client/controllers.ts',
        '.proteum/client/layouts.ts',
        '.proteum/client/models.ts',
        '.proteum/client/routes.ts',
        '.proteum/client/services.d.ts',
        '.proteum/common/controllers.ts',
        '.proteum/common/models.ts',
        '.proteum/common/services.d.ts',
        '.proteum/server/commands.app.d.ts',
        '.proteum/server/commands.d.ts',
        '.proteum/server/commands.ts',
        '.proteum/server/controllers.ts',
        '.proteum/server/models.ts',
        '.proteum/server/routes.ts',
        '.proteum/server/services.d.ts',
        '.proteum/client/route-modules/landing/index.tsx',
        '.proteum/server/route-modules/client/pages/landing/index.tsx',
    ]) {
        touch(path.join(appRoot, filepath));
    }

    const response = buildContractsDoctorResponse(createManifest(appRoot, pageFilepath));
    assert.equal(
        response.diagnostics.some((diagnostic) => diagnostic.code === 'runtime/provider-hook-outside-provider'),
        false,
    );
});
