const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { buildMetaTags, isOpenGraphMetaKey } = require('../server/services/router/response/page/metas');

test('page metas use property only for Open Graph vocabularies', () => {
    assert.equal(isOpenGraphMetaKey('og:title'), true);
    assert.equal(isOpenGraphMetaKey('article:published_time'), true);
    assert.equal(isOpenGraphMetaKey('robots'), false);
    assert.equal(isOpenGraphMetaKey('twitter:card'), false);

    const tags = buildMetaTags({ robots: 'index', 'og:type': 'website', 'twitter:card': 'summary' }, []);

    assert.deepEqual(tags, [
        { $: 'meta', name: 'robots', content: 'index' },
        { $: 'meta', property: 'og:type', content: 'website' },
        { $: 'meta', name: 'twitter:card', content: 'summary' },
    ]);
});

test('page metas skip keys the page already pushed and empty values', () => {
    const head = [
        { $: 'meta', name: 'robots', content: 'noindex,follow' },
        { $: 'link', rel: 'canonical', href: '/x' },
    ];
    const tags = buildMetaTags({ robots: 'index', 'og:description': '', 'og:title': 'T' }, head);

    assert.deepEqual(tags, [{ $: 'meta', property: 'og:title', content: 'T' }]);
});
