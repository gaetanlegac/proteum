const assert = require('node:assert/strict');

const {
    buildDocAnchorGroups,
    collectDocAnchors,
    hasDocAnchorTag,
    isPathDocAnchorTag,
    parseDocAnchorComment,
} = require('../docAnchors.js');

test('doc anchor parser reads every supported tag from a block comment', () => {
    const groups = collectDocAnchors(`
        /**
         * @docs docs/features/search
         * @adr  ADR-0004
         * @fix  docs/fixes/2026-06-09-keyword-search-semantic-order.md
         * @rule Composite ordering stays alias-aware.
         */
        export default definePageRoute({ path: '/browse' });
    `);

    assert.deepEqual(groups.docs, ['docs/features/search']);
    assert.deepEqual(groups.adr, ['ADR-0004']);
    assert.deepEqual(groups.fix, ['docs/fixes/2026-06-09-keyword-search-semantic-order.md']);
    assert.deepEqual(groups.rules, ['Composite ordering stays alias-aware.']);
});

test('doc anchor parser joins multi-line rule invariants into one value', () => {
    const groups = collectDocAnchors(`
        /**
         * @rule Composite ordering stays alias-aware.
         *       Never rewrite ORDER BY with regex.
         */
    `);

    assert.deepEqual(groups.rules, ['Composite ordering stays alias-aware. Never rewrite ORDER BY with regex.']);
});

test('doc anchor parser reports the line each anchor sits on', () => {
    const groups = collectDocAnchors(['const a = 1;', '', '/**', ' * @docs docs/features/search', ' */'].join('\n'));

    assert.equal(groups.entries.length, 1);
    assert.equal(groups.entries[0].line, 4);
});

test('doc anchor parser ignores unrelated jsdoc tags', () => {
    const groups = collectDocAnchors(`
        /**
         * @param input The request payload.
         * @returns The parsed row.
         */
    `);

    assert.equal(groups.entries.length, 0);
});

test('doc anchor parser stops a value at a blank comment line', () => {
    const groups = collectDocAnchors(`
        /**
         * @rule Never rewrite ORDER BY with regex.
         *
         * Unrelated prose that must not join the invariant.
         */
    `);

    assert.deepEqual(groups.rules, ['Never rewrite ORDER BY with regex.']);
});

test('doc anchor parser collects anchors from several comments and drops duplicates', () => {
    const groups = collectDocAnchors(`
        /** @docs docs/features/search */
        const first = 1;
        /** @docs docs/features/search */
        /** @docs docs/features/billing */
        const second = 2;
    `);

    assert.deepEqual(groups.docs, ['docs/features/search', 'docs/features/billing']);
});

test('doc anchor parser ignores tags with no value', () => {
    const groups = collectDocAnchors(`
        /**
         * @docs
         * @rule
         */
    `);

    assert.equal(groups.entries.length, 0);
});

test('doc anchor parser caps how much source it scans', () => {
    const padding = `${'// filler\n'.repeat(200)}`;
    const source = `${padding}/** @docs docs/features/search */`;

    assert.equal(collectDocAnchors(source, { maxLength: 50 }).entries.length, 0);
    assert.equal(collectDocAnchors(source).docs.length, 1);
});

test('doc anchor parser tolerates empty and missing input', () => {
    assert.equal(collectDocAnchors('').entries.length, 0);
    assert.equal(collectDocAnchors(undefined).entries.length, 0);
    assert.equal(parseDocAnchorComment(undefined).length, 0);
});

test('doc anchor helpers expose the tag contract', () => {
    const groups = buildDocAnchorGroups(parseDocAnchorComment('* @docs docs/features/search', 1));

    assert.equal(hasDocAnchorTag(groups, 'docs'), true);
    assert.equal(hasDocAnchorTag(groups, 'rule'), false);
    assert.equal(isPathDocAnchorTag('docs'), true);
    assert.equal(isPathDocAnchorTag('fix'), true);
    assert.equal(isPathDocAnchorTag('adr'), false);
    assert.equal(isPathDocAnchorTag('rule'), false);
});
