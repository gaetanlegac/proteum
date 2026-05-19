const assert = require('node:assert/strict');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '../../../..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const moduleAlias = require('module-alias');
moduleAlias.addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
});

const { getHttpClientErrorContext, normalizeBugReportError } = require('./index.ts');

test('wraps got HTTP errors as anomalies with original error context', () => {
    const error = new Error('Response code 422 (Unprocessable Entity)');
    error.name = 'HTTPError';
    error.code = 'ERR_NON_2XX_3XX_RESPONSE';
    error.timings = {
        phases: {
            total: 321,
        },
    };
    error.request = {
        options: {
            method: 'GET',
            url: 'https://api.example.test/ip/2001:db8::1',
            headers: {
                'x-key': 'secret-token',
            },
        },
    };
    error.response = {
        statusCode: 422,
        statusMessage: 'Unprocessable Entity',
        headers: {
            'set-cookie': 'session=secret',
        },
        body: {
            message: 'Invalid IP address',
        },
    };

    const wrapped = normalizeBugReportError(error);

    assert.equal(wrapped.message, 'HTTP client request failed.');
    assert.equal(wrapped.originalError, error);
    assert.deepEqual(wrapped.dataForDebugging, {
        code: 'ERR_NON_2XX_3XX_RESPONSE',
        statusCode: 422,
        statusMessage: 'Unprocessable Entity',
        method: 'GET',
        url: 'https://api.example.test/ip/2001:db8::1',
        timings: {
            phases: {
                total: 321,
            },
        },
        request: {
            options: {
                method: 'GET',
                url: 'https://api.example.test/ip/2001:db8::1',
                headers: {
                    'x-key': 'secret-token',
                },
            },
        },
        response: {
            statusCode: 422,
            statusMessage: 'Unprocessable Entity',
            headers: {
                'set-cookie': 'session=secret',
            },
            body: {
                message: 'Invalid IP address',
            },
        },
        options: null,
    });
});

test('ignores normal application errors', () => {
    assert.equal(getHttpClientErrorContext(new Error('Something else failed')), null);
});
