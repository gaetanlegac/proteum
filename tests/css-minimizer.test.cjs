const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { minifyCss } = require('../cli/compiler/common/cssMinimizer');

// The shape Tailwind v4 emits for a variant with an opacity modifier (`lg:text-white/70`):
// a declaration followed by a nested `@supports` fallback, two levels deep.
const NESTED_FALLBACK =
    '.a { @media (width >= 64rem) { color: #ffffffb3; @supports (color: color-mix(in lab, red, red)) { color: color-mix(in oklab, var(--c) 70%, transparent); } } }';

test('css minimizer keeps the semicolon between a declaration and a nested at-rule', () => {
    // Browsers that support nesting, so nothing is flattened: the case the rspack-bundled
    // LightningCSS printed as `color:#ffffffb3@supports`, which drops the whole rule.
    const minified = minifyCss('x.css', NESTED_FALLBACK, { targets: ['last 2 chrome versions'] });

    assert.doesNotMatch(minified, /[^;{}\s]@supports/);
    assert.match(minified, /color:#ffffffb3;@supports/);
});

test('css minimizer lowers nesting for browsers that need it and honours a string query', () => {
    const minified = minifyCss('x.css', NESTED_FALLBACK, { targets: 'chrome 100' });

    assert.doesNotMatch(minified, /[^;{}\s]@supports/);
    // Chrome 100 has no CSS nesting: the media query is hoisted around the rule.
    assert.match(minified, /^@media \(min-width:64rem\)\{\.a\{/);
});

test('css minimizer minifies without targets', () => {
    assert.equal(minifyCss('x.css', '.a {\n  color: #ffffff;\n}\n'), '.a{color:#fff}');
});
