const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rspack } = require('@rspack/core');

const coreRoot = path.join(__dirname, '..');

/** The one line of the client entry that loads preact/debug, as it is in the source today. */
const debugGuardLine = () => {
    const source = fs.readFileSync(path.join(coreRoot, 'client/app/index.ts'), 'utf8');
    const lines = source.split('\n').filter((line) => line.includes("require('preact/debug')"));
    assert.equal(lines.length, 1, 'client/app/index.ts loads preact/debug from exactly one line');
    return lines[0];
};

/** Bundles that line alone, with `preact/debug` replaced by a marker module, and returns the emitted JS. */
const bundle = async (dev) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proteum-preact-debug-'));
    try {
        fs.writeFileSync(path.join(root, 'entry.js'), `${debugGuardLine()}\nexport const ready = true;\n`);
        fs.writeFileSync(path.join(root, 'debug.js'), "globalThis.marker = 'PREACT_DEBUG_MARKER';\n");

        const compiler = rspack({
            mode: 'production',
            context: root,
            entry: './entry.js',
            target: 'web',
            devtool: false,
            output: { path: path.join(root, 'dist'), filename: 'out.js' },
            resolve: { alias: { 'preact/debug$': path.join(root, 'debug.js') } },
            // As the client compiler defines it (cli/compiler/common/index.ts).
            plugins: [new rspack.DefinePlugin({ __DEV__: JSON.stringify(dev) })],
        });
        await new Promise((resolve, reject) =>
            compiler.run((error, stats) => {
                if (error) return reject(error);
                if (stats.hasErrors()) return reject(new Error(stats.toString()));
                compiler.close(() => resolve());
            }),
        );

        return fs.readFileSync(path.join(root, 'dist', 'out.js'), 'utf8');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
};

test('a production client bundle does not contain preact/debug', async () => {
    assert.ok(!(await bundle(false)).includes('PREACT_DEBUG_MARKER'));
});

test('a dev client bundle still loads preact/debug when the document says window.dev', async () => {
    assert.ok((await bundle(true)).includes('PREACT_DEBUG_MARKER'));
});
