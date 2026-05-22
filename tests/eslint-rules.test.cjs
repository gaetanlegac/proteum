const assert = require('node:assert/strict');
const { Linter } = require('eslint');

const { createProteumEslintConfig } = require('../eslint.js');

const lint = (code) => {
    const linter = new Linter({ configType: 'flat' });
    return linter.verify(code, createProteumEslintConfig(), {
        filename: 'client/example.tsx',
    });
};

const swallowedErrorRuleId = 'proteum/no-swallowed-caught-error';
const noAppImportRuleId = 'proteum/no-app-import';

test('proteum lint rejects contextual @app imports', () => {
    const messages = lint(`
        import { Router } from '@app';

        export const route = Router;
    `);

    assert.equal(messages.some((message) => message.ruleId === noAppImportRuleId), true);
});

test('proteum lint rejects empty catch blocks', () => {
    const messages = lint(`
        export const run = () => {
            try {
                risky();
            } catch {
                return null;
            }
        };
    `);

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint rejects promise catches that discard the error', () => {
    const messages = lint(`
        export const run = () => {
            api.load().catch(() => toast.error('Could not load'));
        };
    `);

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint rejects generic catch feedback that drops original error details', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await Investor.api.getDashboard();
            } catch (error) {
                toast.error('Could not load API dashboard');
            }
        };
    `);

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint rejects console calls as caught error preservation', () => {
    for (const method of ['error', 'warn']) {
        const messages = lint(`
            export const run = async () => {
                try {
                    await Investor.api.getDashboard();
                } catch (error) {
                    console.${method}(error);
                }
            };
        `);

        assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
    }
});

test('proteum lint rejects direct console promise catch handlers', () => {
    const messages = lint(`
        export const run = () => {
            Investor.api.ensureApiKey().catch(console.log);
        };
    `);

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint allows rethrowing the caught error', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await Investor.api.getDashboard();
            } catch (error) {
                toast.error('Could not load API dashboard');
                throw error;
            }
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows surfacing original error details', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await Investor.api.getDashboard();
            } catch (error) {
                toast.error('Could not load API dashboard', {
                    description: error instanceof Error ? error.message : String(error),
                });
            }
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows surfacing a message derived from the caught error', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await Investor.api.getDashboard();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setError(message);
            }
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows routing promise failures to app error handling', () => {
    const messages = lint(`
        export const run = () => {
            const context = useContext();
            Investor.api.ensureApiKey().catch((error) => {
                context.app.handleError(error);
            });
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});
