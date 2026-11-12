const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const coreRoot = path.join(__dirname, '..');

/** The `declare module '<name>'` names of a declaration file. */
const declaredModules = (filepath) =>
    [...fs.readFileSync(filepath, 'utf8').matchAll(/^declare module '([^']+)'/gm)].map((match) => match[1]);

// Apps include `types/global` only (see the scaffold's server tsconfig), while Proteum's own tsc also reads
// `types/vendors.d.ts`: a vendor declared in the root file alone typechecks here and fails in every app.
test('every vendor module declared for Proteum is declared for apps too', () => {
    const root = declaredModules(path.join(coreRoot, 'types/vendors.d.ts'));
    const global = new Set(declaredModules(path.join(coreRoot, 'types/global/vendors.d.ts')));

    assert.deepEqual(
        root.filter((name) => !global.has(name)),
        [],
        'add these blocks to types/global/vendors.d.ts',
    );
});

test('an app-shaped program reaching the HTTP server finds a declaration for every untyped vendor', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-app-typecheck-'));
    try {
        fs.mkdirSync(path.join(appRoot, 'node_modules'));
        fs.mkdirSync(path.join(appRoot, 'server'));
        fs.symlinkSync(coreRoot, path.join(appRoot, 'node_modules', 'proteum'), 'dir');
        fs.writeFileSync(
            path.join(appRoot, 'server', 'probe.ts'),
            "import HttpServer from '@server/services/router/http';\nexport type Probe = typeof HttpServer;\n",
        );

        // The shape of an app's server tsconfig: Proteum's base config, `types/global` only, noImplicitAny.
        const proteum = './node_modules/proteum';
        const config = ts.parseJsonConfigFileContent(
            {
                extends: `${proteum}/tsconfig.common.json`,
                compilerOptions: {
                    noEmit: true,
                    rootDir: '.',
                    baseUrl: '.',
                    noImplicitAny: true,
                    paths: {
                        '@client/*': [`${proteum}/client/*`],
                        '@common/*': [`${proteum}/common/*`],
                        '@server/*': [`${proteum}/server/*`],
                        react: [`${proteum}/node_modules/preact/compat`],
                        'react-dom': [`${proteum}/node_modules/preact/compat`],
                        'react/jsx-runtime': [`${proteum}/node_modules/preact/jsx-runtime`],
                    },
                },
                include: ['./server/probe.ts', `${proteum}/types/global`],
            },
            ts.sys,
            appRoot,
        );
        const program = ts.createProgram(config.fileNames, config.options);

        // TS7016 is the B1 failure: a vendor with no types and no declaration. The harness has no generated
        // `.proteum` files and no app code, so the other diagnostics are not this test's subject.
        const missingDeclarations = ts
            .getPreEmitDiagnostics(program)
            .filter((diagnostic) => diagnostic.code === 7016)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('.')[0]);

        assert.deepEqual(missingDeclarations, []);
    } finally {
        fs.rmSync(appRoot, { recursive: true, force: true });
    }
});
