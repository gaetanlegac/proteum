/*
 * Shared doc-anchor contract.
 *
 * A doc anchor ties a source file to the durable documentation that governs it,
 * so an agent editing the file sees the governing rule without first reading the
 * whole documentation corpus.
 *
 * Supported tags, written in any leading block comment:
 *
 *   @docs docs/features/search
 *   @adr  ADR-0004
 *   @fix  docs/fixes/2026-06-09-keyword-search-semantic-order.md
 *   @rule Composite ordering stays alias-aware. Never rewrite ORDER BY with regex.
 *
 * `@docs`, `@adr` and `@fix` are pointers resolved by the MCP owner payloads.
 * `@rule` carries the one-line invariant inline, where an agent cannot miss it.
 *
 * This module is plain CommonJS with no dependencies because both the ESLint
 * rules and the TypeScript MCP payload builder load it. Keep it that way so the
 * lint surface and the agent-facing surface can never disagree on the format.
 */

const docAnchorTags = ['docs', 'adr', 'fix', 'rule'];
const pathDocAnchorTags = ['docs', 'fix'];
const maxDocAnchorScanLength = 64 * 1024;
const minDocAnchorRuleLength = 8;

const blockCommentPattern = /\/\*[\s\S]*?\*\//g;
const commentGutterPattern = /^\s*\*+[ \t]?/;
const tagPattern = /^@([a-zA-Z][\w-]*)[ \t]*(.*)$/;

const countLinesBefore = (text, index) => {
    let line = 1;
    for (let cursor = 0; cursor < index; cursor += 1) {
        if (text[cursor] === '\n') line += 1;
    }

    return line;
};

const stripCommentGutter = (line) => line.replace(commentGutterPattern, '').trim();

const isDocAnchorTag = (tag) => docAnchorTags.includes(tag);
const isPathDocAnchorTag = (tag) => pathDocAnchorTags.includes(tag);

/**
 * Parse the inner text of a single block comment.
 *
 * `startLine` is the 1-based line the comment opens on, so reported entries
 * point at the exact anchor line rather than the top of the file.
 */
const parseDocAnchorComment = (commentValue, startLine = 1) => {
    const entries = [];
    const lines = String(commentValue === undefined || commentValue === null ? '' : commentValue).split('\n');
    let current;

    lines.forEach((rawLine, index) => {
        const line = stripCommentGutter(rawLine);
        if (line === '') {
            current = undefined;
            return;
        }

        const tagMatch = line.match(tagPattern);
        if (tagMatch) {
            const tag = tagMatch[1].toLowerCase();
            if (!isDocAnchorTag(tag)) {
                current = undefined;
                return;
            }

            current = { tag, value: tagMatch[2].trim(), line: startLine + index };
            entries.push(current);
            return;
        }

        // A non-empty line that opens no new tag continues the previous value,
        // which keeps multi-line `@rule` invariants readable in source.
        if (current) current.value = `${current.value} ${line}`.trim();
    });

    return entries.filter((entry) => entry.value !== '');
};

const uniqueValues = (entries, tag) => {
    const values = [];
    entries.forEach((entry) => {
        if (entry.tag !== tag || values.includes(entry.value)) return;
        values.push(entry.value);
    });

    return values;
};

const buildDocAnchorGroups = (entries) => ({
    entries,
    docs: uniqueValues(entries, 'docs'),
    adr: uniqueValues(entries, 'adr'),
    fix: uniqueValues(entries, 'fix'),
    rules: uniqueValues(entries, 'rule'),
});

const hasDocAnchorTag = (groups, tag) => groups.entries.some((entry) => entry.tag === tag);

/**
 * Collect every doc anchor in raw source text.
 *
 * Used by the MCP owner payloads, which read a file from disk and have no AST.
 * The scan is capped so enriching an owner match stays cheap on large files.
 */
const collectDocAnchors = (sourceText, options) => {
    const maxLength = options && options.maxLength ? options.maxLength : maxDocAnchorScanLength;
    const text = String(sourceText === undefined || sourceText === null ? '' : sourceText).slice(0, maxLength);
    const entries = [];

    blockCommentPattern.lastIndex = 0;
    let match = blockCommentPattern.exec(text);
    while (match !== null) {
        const body = match[0].slice(2, -2);
        entries.push(...parseDocAnchorComment(body, countLinesBefore(text, match.index)));
        match = blockCommentPattern.exec(text);
    }

    return buildDocAnchorGroups(entries);
};

module.exports = {
    buildDocAnchorGroups,
    collectDocAnchors,
    docAnchorTags,
    hasDocAnchorTag,
    isPathDocAnchorTag,
    minDocAnchorRuleLength,
    parseDocAnchorComment,
};
