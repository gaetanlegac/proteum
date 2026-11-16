const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { normalizeApplicationSetupConfig } = require('../common/applicationConfig');

test('sourceMaps and preloadFonts are optional and kept as written', () => {
    assert.deepEqual(normalizeApplicationSetupConfig({}), { transpile: [], connect: {} });
    assert.deepEqual(normalizeApplicationSetupConfig({ sourceMaps: 'public', preloadFonts: ['figtree-latin'] }), {
        transpile: [],
        connect: {},
        sourceMaps: 'public',
        preloadFonts: ['figtree-latin'],
    });
    assert.equal(normalizeApplicationSetupConfig({ sourceMaps: false }).sourceMaps, false);
    assert.equal(normalizeApplicationSetupConfig({ sourceMaps: 'hidden' }).sourceMaps, 'hidden');
});

test('a malformed sourceMaps or preloadFonts fails where the config is read', () => {
    assert.throws(() => normalizeApplicationSetupConfig({ sourceMaps: true }), /"sourceMaps" must be "hidden", "public" or false/);
    assert.throws(() => normalizeApplicationSetupConfig({ preloadFonts: 'figtree-latin' }), /preloadFonts/);
    assert.throws(() => normalizeApplicationSetupConfig({ preloadFonts: [''] }), /preloadFonts\.0/);
});
