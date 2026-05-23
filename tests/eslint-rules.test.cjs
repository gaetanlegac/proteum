const assert = require('node:assert/strict');
const { Linter } = require('eslint');

const { createProteumEslintConfig } = require('../eslint.js');

const lint = (code, filename = 'client/example.tsx') => {
    const linter = new Linter({ configType: 'flat' });
    return linter.verify(code, createProteumEslintConfig(), {
        filename,
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

test('proteum lint rejects user feedback that does not route the caught error', () => {
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

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint rejects derived message state that does not route the caught error', () => {
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

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint allows client catches routed to context app error handling', () => {
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

test('proteum lint rejects optional client error handler calls', () => {
    for (const statement of [
        'app?.handleError(error);',
        'context.app?.handleError(error);',
        'window.app?.handleError(error);',
    ]) {
        const messages = lint(`
            export const run = async () => {
                const app = useContext();
                const context = useContext();
                try {
                    await Investor.api.ensureApiKey();
                } catch (error) {
                    ${statement}
                }
            };
        `);

        assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
    }
});

test('proteum lint allows client catches using app error messages for UI feedback', () => {
    const messages = lint(`
        export const run = async () => {
            const context = useContext();
            try {
                await Investor.api.ensureApiKey();
            } catch (error) {
                setError(context.app.handleError(error, 'Unable to finish this action.'));
            }
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows client catches routed to local app error handling', () => {
    const messages = lint(`
        export const run = async () => {
            const app = useContext();
            try {
                await Investor.api.ensureApiKey();
            } catch (error) {
                app.handleError(error);
            }
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows client catches routed to useContext app error handling', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await Investor.api.ensureApiKey();
            } catch (error) {
                useContext().app.handleError(error);
            }
        };
    `);

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint rejects bare client error handlers', () => {
    const messages = lint(`
        export const run = async () => {
            try {
                await Investor.api.ensureApiKey();
            } catch (error) {
                handleError(error);
            }
        };
    `);

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint allows server catches routed to app error reporting', () => {
    const messages = lint(
        `
            export const run = async (context) => {
                try {
                    await context.services.Worker.run();
                } catch (error) {
                    await context.app.reportError(error, context.request);
                }
            };
        `,
        'server/example.ts',
    );

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows server catches routed to instance app error reporting', () => {
    const messages = lint(
        `
            export class WorkerController {
                async run(context) {
                    try {
                        await context.services.Worker.run();
                    } catch (error) {
                        await this.app.reportError(error, context.request);
                    }
                }
            }
        `,
        'server/example.ts',
    );

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint rejects optional server error reporter calls', () => {
    for (const statement of [
        'app.reportError?.(error);',
        'app?.reportError(error);',
        'context.app?.reportError(error);',
    ]) {
        const messages = lint(
            `
                export const run = async (context) => {
                    const app = context.app;
                    try {
                        await context.services.Worker.run();
                    } catch (error) {
                        ${statement}
                    }
                };
            `,
            'server/example.ts',
        );

        assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
    }
});

test('proteum lint rejects conditional server error reporter calls', () => {
    const messages = lint(
        `
            export const run = async (context) => {
                const app = context.app;
                try {
                    await context.services.Worker.run();
                } catch (error) {
                    if (app) app.reportError(error, context.request);
                }
            };
        `,
        'server/example.ts',
    );

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint rejects server catches routed to client app error handling', () => {
    const messages = lint(
        `
            export const run = async (context) => {
                try {
                    await context.services.Worker.run();
                } catch (error) {
                    context.app.handleError(error);
                }
            };
        `,
        'server/example.ts',
    );

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint rejects raw server error hooks as caught error handling', () => {
    const messages = lint(
        `
            export const run = async (context) => {
                try {
                    await context.services.Worker.run();
                } catch (error) {
                    await context.app.runHook('error', error, context.request);
                }
            };
        `,
        'server/example.ts',
    );

    assert.equal(messages.some((message) => message.ruleId === swallowedErrorRuleId), true);
});

test('proteum lint allows manual promise rejection', () => {
    const messages = lint(
        `
            export const run = (input) =>
                new Promise((resolve, reject) => {
                    input.load().catch((error) => {
                        reject(error);
                    });
                });
        `,
        'common/example.ts',
    );

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows returning manual promise rejection', () => {
    const messages = lint(
        `
            export const run = async (input) => {
                try {
                    await input.load();
                } catch (error) {
                    return Promise.reject(error);
                }
            };
        `,
        'common/example.ts',
    );

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});

test('proteum lint allows direct reject promise catch handlers', () => {
    const messages = lint(
        `
            export const run = (input) =>
                new Promise((resolve, reject) => {
                    input.load().catch(reject);
                });
        `,
        'common/example.ts',
    );

    assert.equal(messages.filter((message) => message.ruleId === swallowedErrorRuleId).length, 0);
});
