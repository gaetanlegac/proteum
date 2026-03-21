#!/usr/bin/env node

const path = require('path');

/*
    Why this exists (npm i vs npm link difference)

    Proteum's CLI is written in TypeScript and is executed via ts-node at runtime.
    When Proteum is installed from npm, `cli/tsconfig.json` lives inside `node_modules/proteum/cli`.

    ts-node's default ignore pattern (`/(?:^|\\/)node_modules\\//`) is applied to *paths relative to the tsconfig folder*.
    For hoisted deps (ex: `node_modules/tailwindcss/...`), the relative path becomes `../../tailwindcss/...` (no `node_modules/` segment),
    so ts-node mistakenly transpiles those sibling dependencies.

    Tailwind v4 contains `class ... extends Map` and downleveling that to ES5 turns `super()` into `Map.call(this)`,
    which throws: "TypeError: Constructor Map requires 'new'".

    Fix: extend ts-node ignore patterns so it also ignores `../../<pkg>/...` (hoisted siblings), while still allowing the CLI
    to `require()` the user's app config (ex: `../../../server/config/*.ts`).
*/
if (!process.env.TS_NODE_IGNORE) {
    process.env.TS_NODE_IGNORE = [
        // Default ts-node ignore rule (works when deps are nested under `../node_modules/...`)
        '(node_modules\/(?!proteum\/))|(\.generated\/)|(\.cache\/)',
        // Extra rule for deps hoisted next to Proteum (ex: `../../tailwindcss/...`)
        '^\\.\\./\\.\\./(?!\\./|\\.\\./)[^/]+/',
    ].join(',');
}

process.env.TS_NODE_PROJECT = path.join(__dirname, 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';

require('ts-node/register/transpile-only');

require('./index.ts');
