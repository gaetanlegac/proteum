const assert = require('node:assert/strict');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..');
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { createCommandTemplate, createControllerTemplate, createServerIndexTemplate } = require('../cli/scaffold/templates.ts');

test('server index scaffold uses explicit defineApplication router property', () => {
    const content = createServerIndexTemplate({ appIdentifier: 'ExampleApp' });

    assert.match(content, /const ExampleAppApplication = defineApplication\(\{/);
    assert.match(content, /export type ExampleApp = InstanceType<typeof ExampleAppApplication>/);
    assert.match(content, /export default ExampleAppApplication/);
    assert.match(content, /export type TControllerRequestServices = \{\}/);
    assert.match(content, /services: \(\) => \(\{\}\),/);
    assert.match(content, /router: \(app\) =>\s+new Router\(/);
    assert.doesNotMatch(content, /services: \(app\) => \(\{\s+Router: new Router\(/);
});

test('controller scaffold imports app-typed generated controller helpers', () => {
    const content = createControllerTemplate({
        appIdentifier: 'ExampleApp',
        className: 'BillingController',
        methodName: 'read',
    });

    assert.match(content, /from '@generated\/server\/controller'/);
    assert.doesNotMatch(content, /from '@server\/app\/controller'/);
});

test('command scaffold infers app type from defineApplication default export', () => {
    const content = createCommandTemplate({
        className: 'BillingCommands',
        methodName: 'sync',
    });

    assert.match(content, /import type AppApplication from '@\/server\/index'/);
    assert.match(content, /type App = InstanceType<typeof AppApplication>/);
    assert.doesNotMatch(content, /import type App from '@\/server\/index'/);
});
