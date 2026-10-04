const assert = require('node:assert/strict');

const { createRouter, restore } = require('./clientRouterHarness.cjs');

test('on() removes a listener by reference, whatever was removed before', () => {
    const router = createRouter();
    const calls = [];
    const removeFirst = router.on('page.changed', () => calls.push('first'));
    const removeSecond = router.on('page.changed', () => calls.push('second'));
    router.on('page.changed', () => calls.push('third'));

    // An index-based remover would drop "third" here, since "second" moved to index 0
    removeFirst();
    removeSecond();
    router.runHook('page.changed', {});

    assert.deepEqual(calls, ['third']);
});

test('a listener can remove itself while its hook runs', () => {
    const router = createRouter();
    const calls = [];
    const removeOnce = router.on('page.ready', () => {
        calls.push('once');
        removeOnce();
    });
    router.on('page.ready', () => calls.push('always'));

    router.runHook('page.ready', {});
    router.runHook('page.ready', {});

    assert.deepEqual(calls, ['once', 'always', 'always']);
});

test('a listener added while its hook runs waits for the next call, and one remover drops every registration', () => {
    const router = createRouter();
    const calls = [];
    const late = () => calls.push('late');
    router.on('page.changed', () => {
        calls.push('first');
        if (!calls.includes('added')) {
            calls.push('added');
            router.on('page.changed', late);
        }
    });

    router.runHook('page.changed', {});
    assert.deepEqual(calls, ['first', 'added']);
    router.runHook('page.changed', {});
    assert.deepEqual(calls, ['first', 'added', 'first', 'late']);

    const twice = () => calls.push('twice');
    const removeTwice = router.on('page.ready', twice);
    router.on('page.ready', twice);
    removeTwice();
    router.runHook('page.ready', {});
    assert.equal(calls.includes('twice'), false);
});

test('page.ready listeners receive the request', () => {
    const router = createRouter();
    const request = { path: '/radars' };
    let received;
    router.on('page.ready', (value) => {
        received = value;
    });

    router.runHook('page.ready', request);

    assert.equal(received, request);
});

afterAll(restore);
