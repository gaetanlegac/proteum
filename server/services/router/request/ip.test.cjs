const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveRequestIp } = require('./ip.ts');

const request = (headers, ip = '192.0.2.10') => ({
    headers,
    ip,
});

test('Cloudflare client IP wins over Express fallback IP', () => {
    assert.equal(
        resolveRequestIp(request({ 'cf-connecting-ip': '203.0.113.10' }, '192.0.2.10')),
        '203.0.113.10',
    );
});

test('True-Client-IP wins when Cloudflare IP is absent', () => {
    assert.equal(
        resolveRequestIp(request({ 'true-client-ip': '198.51.100.24' }, '192.0.2.10')),
        '198.51.100.24',
    );
});

test('Fastly-Client-IP wins when Cloudflare and True-Client-IP are absent', () => {
    assert.equal(
        resolveRequestIp(request({ 'fastly-client-ip': '51.182.144.154' }, '192.0.2.10')),
        '51.182.144.154',
    );
});

test('invalid and spoof-looking values are ignored before falling back to Express IP', () => {
    assert.equal(
        resolveRequestIp(
            request(
                {
                    'cf-connecting-ip': 'not-an-ip',
                    'true-client-ip': '203.0.113.10, 198.51.100.24',
                    'fastly-client-ip': 'unknown',
                    'x-forwarded-for': '203.0.113.200',
                    forwarded: 'for=203.0.113.201',
                },
                '192.0.2.10',
            ),
        ),
        '192.0.2.10',
    );
});

test('IPv4-mapped IPv6 and bracketed IPv6 candidates normalize correctly', () => {
    assert.equal(
        resolveRequestIp(request({ 'fastly-client-ip': ' ::ffff:51.182.144.154 ' }, '192.0.2.10')),
        '51.182.144.154',
    );
    assert.equal(resolveRequestIp(request({ 'true-client-ip': '[2001:db8::12]' }, '192.0.2.10')), '2001:db8::12');
});

test('IPv4 port suffix candidates normalize correctly', () => {
    assert.equal(resolveRequestIp(request({ 'fastly-client-ip': '51.182.144.154:443' }, '192.0.2.10')), '51.182.144.154');
});
