const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { normalizeApplicationSetupConfig } = require('../common/applicationConfig');

test('sourceMaps is optional and kept as written', () => {
    assert.deepEqual(normalizeApplicationSetupConfig({}), { transpile: [], connect: {} });
    assert.deepEqual(normalizeApplicationSetupConfig({ sourceMaps: 'public' }), { transpile: [], connect: {}, sourceMaps: 'public' });
    assert.equal(normalizeApplicationSetupConfig({ sourceMaps: false }).sourceMaps, false);
    assert.equal(normalizeApplicationSetupConfig({ sourceMaps: 'hidden' }).sourceMaps, 'hidden');
});

test('a malformed sourceMaps fails where the config is read', () => {
    assert.throws(() => normalizeApplicationSetupConfig({ sourceMaps: true }), /"sourceMaps" must be "hidden", "public" or false/);
});
