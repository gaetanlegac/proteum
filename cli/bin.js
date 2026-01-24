#!/usr/bin/env node

const path = require('path');

process.env.TS_NODE_PROJECT = path.join(__dirname, 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';

require('ts-node/register/transpile-only');

require('./index.ts');

