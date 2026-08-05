const assert = require('node:assert/strict');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const {
    buildDevSessionLoginUrl,
    normalizeDevSessionRedirectPath,
} = require('../common/dev/session.ts');

test('buildDevSessionLoginUrl creates a local browser handoff URL', () => {
    const url = buildDevSessionLoginUrl({
        baseUrl: 'http://127.0.0.1:3020/',
        email: 'contact@gaetan-legac.fr',
        redirect: '/projects/project-123?tab=radar',
        role: 'GOD',
    });

    assert.equal(
        url,
        'http://127.0.0.1:3020/__proteum/session/login?email=contact%40gaetan-legac.fr&redirect=%2Fprojects%2Fproject-123%3Ftab%3Dradar&role=GOD',
    );
});

test('normalizeDevSessionRedirectPath rejects external redirects', () => {
    assert.throws(() => normalizeDevSessionRedirectPath('https://example.com'), /local absolute path/);
    assert.throws(() => normalizeDevSessionRedirectPath('//example.com'), /local absolute path/);
    assert.throws(() => normalizeDevSessionRedirectPath('/\nadmin'), /local absolute path/);
    assert.equal(normalizeDevSessionRedirectPath(''), '/');
});
