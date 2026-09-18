const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { buildDefaultJsonLd } = require('../server/services/router/response/page/jsonld');

const input = {
    url: 'https://example.test/pricing',
    title: 'Pricing',
    description: 'What it costs.',
    identity: {
        name: 'Example',
        description: 'An example app.',
        locale: 'en-US',
        author: { name: 'Example Ltd', url: 'https://example.test' },
        web: { jsonld: { potentialAction: [{ '@type': 'SearchAction' }] } },
    },
    resolveUrl: (path) => 'https://example.test' + path,
};

test('default JSON-LD adds a generic WebPage only when the page has none', () => {
    const withoutPage = buildDefaultJsonLd({ ...input, pageJsonLd: [{ '@type': 'FAQPage' }] });
    assert.deepEqual(withoutPage.map((node) => node['@type']), ['Organization', 'WebSite', 'WebPage']);
    assert.equal(withoutPage[2]['@id'], 'https://example.test/pricing');
    assert.equal(withoutPage[2].name, 'Pricing');

    const withPage = buildDefaultJsonLd({
        ...input,
        pageJsonLd: [{ '@type': 'WebPage', '@id': 'https://example.test/pricing#webpage', name: 'Plans' }],
    });
    assert.deepEqual(withPage.map((node) => node['@type']), ['Organization', 'WebSite']);

    const withTypedArray = buildDefaultJsonLd({ ...input, pageJsonLd: [{ '@type': ['WebPage', 'FAQPage'] }] });
    assert.deepEqual(withTypedArray.map((node) => node['@type']), ['Organization', 'WebSite']);
});

test('default JSON-LD emits no empty sameAs or potentialAction, and keeps identity additions', () => {
    const nodes = buildDefaultJsonLd({ ...input, pageJsonLd: [] });
    assert.equal('sameAs' in nodes[0], false);
    assert.deepEqual(nodes[1].potentialAction, [{ '@type': 'SearchAction' }]);

    const bare = buildDefaultJsonLd({ ...input, identity: { ...input.identity, web: {} }, pageJsonLd: [] });
    assert.equal('potentialAction' in bare[1], false);
    assert.equal(bare[1].publisher['@id'], 'https://example.test/#organization');
});
