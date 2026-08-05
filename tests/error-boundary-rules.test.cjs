const assert = require('node:assert/strict');
const { Linter } = require('eslint');

const { createProteumEslintConfig } = require('../eslint.js');

const lint = (code, filename = 'server/example.ts', options) => {
    const linter = new Linter({ configType: 'flat' });
    return linter.verify(code, createProteumEslintConfig(options), { filename });
};

const looseUnknownRuleId = 'proteum/no-loose-unknown';
const swallowedRuleId = 'proteum/no-swallowed-caught-error';
const count = (messages, ruleId) => messages.filter((message) => message.ruleId === ruleId).length;

/*----------------------------------
- no-loose-unknown
----------------------------------*/

test('loose unknown is still reported on an ordinary contract', () => {
    const messages = lint(`export type TRow = { value: unknown };`);

    assert.equal(count(messages, looseUnknownRuleId), 1);
});

test('unknown is allowed on a catch binding, which is how TypeScript types it', () => {
    const messages = lint(`
        export const run = () => {
            try {
                risky();
            } catch (error: unknown) {
                throw error;
            }
        };
    `);

    assert.equal(count(messages, looseUnknownRuleId), 0);
});

test('unknown is allowed as the input of a type guard', () => {
    const messages = lint(`
        export const isDomainField = (value: unknown): value is string => typeof value === 'string';
    `);

    assert.equal(count(messages, looseUnknownRuleId), 0);
});

test('unknown is allowed when the trust boundary is documented', () => {
    const messages = lint(`
        /** @boundary HumbleWorth prediction output, shape owned by the provider. */
        export const parseOutput = (output: unknown) => output;
    `);

    assert.equal(count(messages, looseUnknownRuleId), 0);
});

test('an undocumented parse boundary is still reported', () => {
    const messages = lint(`export const parseOutput = (output: unknown) => output;`);

    assert.equal(count(messages, looseUnknownRuleId), 1);
});

test('test files may use unknown without a boundary reason', () => {
    const fixture = `const STATUS_RULE = [{ filterId: 'status' }] as unknown as RadarRulesContract;`;

    assert.equal(count(lint(fixture, 'server/example.ts'), looseUnknownRuleId), 1);
    assert.equal(count(lint(fixture, 'server/example.test.ts'), looseUnknownRuleId), 0);
    assert.equal(count(lint(fixture, 'src/Domains/PendingList.node-test.ts'), looseUnknownRuleId), 0);
    assert.equal(count(lint(fixture, 'tests/unit/scope-builder.ts'), looseUnknownRuleId), 0);
});

test('the other rules still apply inside test files', () => {
    const messages = lint(
        `
            export const run = async () => {
                try {
                    await load();
                } catch (error) {
                    console.error('load failed', error);
                }
            };
        `,
        'server/example.test.ts',
    );

    assert.equal(count(messages, swallowedRuleId), 1);
});

/*----------------------------------
- no-swallowed-caught-error
----------------------------------*/

test('express next(error) counts as propagation', () => {
    const messages = lint(`
        export const handler = async (req, res, next) => {
            try {
                await load();
            } catch (error) {
                next(error);
            }
        };
    `);

    assert.equal(count(messages, swallowedRuleId), 0);
});

test('a configured reporter counts as preservation', () => {
    const source = `
        export class Scanner {
            public async run() {
                try {
                    await this.scan();
                } catch (error) {
                    this.app.reportError(error, { source: 'scan', code: 'failed' });
                }
            }
        }
    `;

    assert.equal(count(lint(source), swallowedRuleId), 0);

    // A project whose error path has another name declares it rather than being
    // told its own convention is a swallow.
    const custom = `
        export class Scanner {
            public async run() {
                try {
                    await this.scan();
                } catch (error) {
                    this.app.report('scan failed', error);
                }
            }
        }
    `;

    assert.equal(count(lint(custom), swallowedRuleId), 1);
    assert.equal(
        count(lint(custom, 'server/example.ts', { errorReporters: ['app.reportError', 'app.report'] }), swallowedRuleId),
        0,
    );
});

test('conditional preservation counts, because deliberate filtering is not a swallow', () => {
    const messages = lint(`
        export class Scanner {
            public async run() {
                try {
                    await this.scan();
                } catch (error) {
                    if (!(error instanceof ExpectedPause)) {
                        this.app.reportError(error, { source: 'scan', code: 'failed' });
                    }
                }
            }
        }
    `);

    assert.equal(count(messages, swallowedRuleId), 0);
});

test('a guard on the reporter existing is still a swallow, unlike a guard on the error', () => {
    // Filtering by what the error is: a decision.
    const filtered = lint(`
        export const run = async () => {
            try {
                await load();
            } catch (error) {
                if (error.code !== 'EXPECTED') app.reportError(error);
            }
        };
    `);
    assert.equal(count(filtered, swallowedRuleId), 0);

    // Gating on whether the reporter exists: the error vanishes when it does not.
    const gated = lint(`
        export const run = async (app) => {
            try {
                await load();
            } catch (error) {
                if (app) app.reportError(error);
            }
        };
    `);
    assert.equal(count(gated, swallowedRuleId), 1);
});

test('a guarded rethrow counts as preservation', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await load();
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        };
    `);

    assert.equal(count(messages, swallowedRuleId), 0);
});

test('an error surfaced as a returned result counts as preservation', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await load();
            } catch (error) {
                return { ok: false, message: error.message };
            }
        };
    `);

    assert.equal(count(messages, swallowedRuleId), 0);
});

test('an error pushed into a result collection counts as preservation', () => {
    const messages = lint(`
        export const run = async (results) => {
            try {
                await load();
            } catch (error) {
                results.push({ state: 'unavailable', message: describeError(error) });
            }
        };
    `);

    assert.equal(count(messages, swallowedRuleId), 0);
});

test('a console-only catch is still reported', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await load();
            } catch (error) {
                console.error('load failed', error);
            }
        };
    `);

    assert.equal(count(messages, swallowedRuleId), 1);
});

test('a discarded error is still reported', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await load();
            } catch (error) {
                return null;
            }
        };
    `);

    assert.equal(count(messages, swallowedRuleId), 1);
});
