const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');

const { createProteumEslintConfig } = require('../eslint.js');

const lint = (code, filename = 'client/example.tsx', configOptions) => {
    const linter = new Linter({ configType: 'flat' });
    return linter.verify(code, createProteumEslintConfig(configOptions), {
        filename,
    });
};

const swallowedErrorRuleId = 'proteum/no-swallowed-caught-error';
const noAppImportRuleId = 'proteum/no-app-import';
const requireDocAnchorRuleId = 'proteum/require-doc-anchor';
const validDocAnchorRuleId = 'proteum/valid-doc-anchor';

const messagesFor = (messages, ruleId) => messages.filter((message) => message.ruleId === ruleId);

// The fixture lives inside the repository `.temp` directory rather than the OS
// temp directory: on macOS the latter sits under `/var/folders`, which the
// shared `**/var/**` ignore would exclude from linting entirely.
const docProjectParent = path.resolve(__dirname, '..', '.temp');
const docProjectRoots = [];

afterAll(() => {
    docProjectRoots.forEach((root) => fs.rmSync(root, { force: true, recursive: true }));
});

/**
 * Build a throwaway project whose documentation corpus really exists on disk,
 * because the anchor rules resolve their paths against the filesystem.
 */
const createDocProject = () => {
    fs.mkdirSync(docProjectParent, { recursive: true });
    const root = fs.mkdtempSync(path.join(docProjectParent, 'proteum-doc-anchor-'));
    docProjectRoots.push(root);

    fs.mkdirSync(path.join(root, 'docs', 'features', 'search'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'features', 'search', 'README.md'), '# Search\n');
    fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'decisions', 'ADR-0004-page-query-contracts.md'), '# ADR-0004\n');
    fs.mkdirSync(path.join(root, 'docs', 'fixes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'fixes', '2026-06-09-keyword-order.md'), '# Fix\n');
    fs.mkdirSync(path.join(root, 'client', 'pages'), { recursive: true });

    return { pageFile: path.join(root, 'client', 'pages', 'browse.tsx'), root };
};

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

test('proteum lint requires a doc anchor on definition files', () => {
    const { pageFile } = createDocProject();
    const messages = lint(`export default definePageRoute({ path: '/browse' });`, pageFile);

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 1);
});

test('proteum lint accepts a definition file that anchors its feature pack', () => {
    const { pageFile } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/search
             */
            export default definePageRoute({ path: '/browse' });
        `,
        pageFile,
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 0);
});

test('proteum lint requires a doc anchor on every Proteum definition kind', () => {
    const { pageFile } = createDocProject();

    for (const definition of [
        'defineController',
        'definePageRoute',
        'defineServerRoute',
        'defineServerRoutes',
    ]) {
        const messages = lint(`export default ${definition}({ path: '/browse' });`, pageFile);
        assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 1, definition);
    }
});

test('proteum lint requires a doc anchor on exported service classes', () => {
    const { root } = createDocProject();
    const serviceFile = path.join(root, 'server', 'services', 'Domains', 'search', 'index.ts');

    const missing = lint(
        `export default class DomainsSearchService extends Service<Config, {}, Application, object> {}`,
        serviceFile,
    );
    assert.equal(messagesFor(missing, requireDocAnchorRuleId).length, 1);

    const anchored = lint(
        `
            /**
             * @docs docs/features/search
             */
            export default class DomainsSearchService extends Service<Config, {}, Application, object> {}
        `,
        serviceFile,
    );
    assert.equal(messagesFor(anchored, requireDocAnchorRuleId).length, 0);
});

test('proteum lint covers app-specific service base classes and named exports', () => {
    const { root } = createDocProject();
    const messages = lint(
        `export class AuthManagement extends UsersManagementService<TUser, AuthApplication, TJwtSession> {}`,
        path.join(root, 'server', 'services', 'Users', 'Auth', 'index.ts'),
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 1);
});

test('proteum lint leaves non-service classes alone', () => {
    const { root } = createDocProject();
    const messages = lint(
        `export default class DomainCard extends React.Component {}`,
        path.join(root, 'client', 'components', 'DomainCard.tsx'),
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
});

test('proteum lint reports a service class only once per file', () => {
    const { root } = createDocProject();
    const messages = lint(
        `
            export class FirstService extends Service {}
            export default class SecondService extends Service {}
        `,
        path.join(root, 'server', 'services', 'Two', 'index.ts'),
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 1);
});

test('proteum lint opts extra files in through include globs', () => {
    const { root } = createDocProject();
    const paywallFile = path.join(root, 'client', 'components', 'paywall', 'PaywallModal', 'index.tsx');
    const iconFile = path.join(root, 'client', 'components', 'Icon.tsx');
    const source = `const Modal = () => null;\nexport default Modal;\n`;
    const options = { docAnchors: 'warn', includeDocAnchors: ['client/components/paywall/**'] };

    assert.equal(messagesFor(lint(source, paywallFile, options), requireDocAnchorRuleId).length, 1);
    assert.equal(messagesFor(lint(source, iconFile, options), requireDocAnchorRuleId).length, 0);
});

test('proteum lint accepts an included file once it carries an anchor', () => {
    const { root } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/search
             */
            const Modal = () => null;
            export default Modal;
        `,
        path.join(root, 'client', 'components', 'paywall', 'PaywallModal', 'index.tsx'),
        { docAnchors: 'warn', includeDocAnchors: ['client/components/paywall/**'] },
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
});

test('proteum lint exempts infrastructure paths listed in excludeDocAnchors', () => {
    const { root } = createDocProject();
    const options = { docAnchors: 'warn', excludeDocAnchors: ['server/services/Utils/**', 'server/routes/debug.ts'] };

    const utilService = lint(
        `export default class FetchService extends Service {}`,
        path.join(root, 'server', 'services', 'Utils', 'Fetch', 'index.ts'),
        options,
    );
    assert.equal(messagesFor(utilService, requireDocAnchorRuleId).length, 0);

    const debugRoute = lint(
        `export default defineServerRoutes(() => null);`,
        path.join(root, 'server', 'routes', 'debug.ts'),
        options,
    );
    assert.equal(messagesFor(debugRoute, requireDocAnchorRuleId).length, 0);

    // A service outside the excluded paths is still required to anchor.
    const covered = lint(
        `export default class SearchService extends Service {}`,
        path.join(root, 'server', 'services', 'Domains', 'search', 'index.ts'),
        options,
    );
    assert.equal(messagesFor(covered, requireDocAnchorRuleId).length, 1);
});

test('proteum lint still validates anchors declared on an excluded file', () => {
    const { root } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/deleted-feature
             */
            export default class FetchService extends Service {}
        `,
        path.join(root, 'server', 'services', 'Utils', 'Fetch', 'index.ts'),
        { docAnchors: 'warn', excludeDocAnchors: ['server/services/Utils/**'] },
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 1);
});

test('proteum lint does not require a doc anchor on error routes', () => {
    const { root } = createDocProject();
    const messages = lint(
        `export default defineErrorRoute({ code: 404 });`,
        path.join(root, 'client', 'pages', '_messages', '404.tsx'),
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
});

test('proteum lint ignores files that export no Proteum definition', () => {
    const { pageFile } = createDocProject();
    const messages = lint(`export default { path: '/browse' };`, pageFile);

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
});

test('proteum lint reports a definition file whose anchors omit the feature pack', () => {
    const { pageFile } = createDocProject();
    const messages = lint(
        `
            /**
             * @rule Browse rows never expose raw score values.
             */
            export default definePageRoute({ path: '/browse' });
        `,
        pageFile,
    );

    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 1);
});

test('proteum lint resolves anchors against the repo corpus when the app has its own docs directory', () => {
    const { root } = createDocProject();

    // Mirrors the monorepo layout: apps/<app>/docs/ sits between the source file
    // and the repository-level corpus that the anchor actually points at.
    const appRoot = path.join(root, 'apps', 'website');
    fs.mkdirSync(path.join(appRoot, 'docs', 'fixes'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'client', 'pages'), { recursive: true });

    const messages = lint(
        `
            /**
             * @docs docs/features/search
             */
            export default definePageRoute({ path: '/browse' });
        `,
        path.join(appRoot, 'client', 'pages', 'browse.tsx'),
    );

    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 0);
    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
});

test('proteum lint rejects a doc anchor pointing at a missing document', () => {
    const { pageFile } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/deleted-feature
             */
            export default definePageRoute({ path: '/browse' });
        `,
        pageFile,
    );

    const reported = messagesFor(messages, validDocAnchorRuleId);
    assert.equal(reported.length, 1);
    assert.equal(/docs\/features\/deleted-feature/.test(reported[0].message), true);
});

test('proteum lint resolves fix and decision anchors against the documentation corpus', () => {
    const { pageFile } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/search
             * @adr  ADR-0004
             * @fix  docs/fixes/2026-06-09-keyword-order.md
             * @rule Composite ordering stays alias-aware.
             */
            export default definePageRoute({ path: '/browse' });
        `,
        pageFile,
    );

    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 0);
});

test('proteum lint rejects a decision anchor that matches no decision record', () => {
    const { pageFile } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/search
             * @adr  ADR-9999
             */
            export default definePageRoute({ path: '/browse' });
        `,
        pageFile,
    );

    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 1);
});

test('proteum lint rejects a rule anchor that states no invariant', () => {
    const { pageFile } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/search
             * @rule todo
             */
            export default definePageRoute({ path: '/browse' });
        `,
        pageFile,
    );

    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 1);
});

test('proteum lint validates anchors on files that export no definition', () => {
    const { root } = createDocProject();
    const messages = lint(
        `
            /**
             * @docs docs/features/deleted-feature
             */
            export const helper = () => null;
        `,
        path.join(root, 'server', 'services', 'search.ts'),
    );

    assert.equal(messagesFor(messages, validDocAnchorRuleId).length, 1);
    assert.equal(messagesFor(messages, requireDocAnchorRuleId).length, 0);
});

test('proteum lint escalates and disables doc anchor rules through config options', () => {
    const { pageFile } = createDocProject();
    const source = `
        /**
         * @docs docs/features/deleted-feature
         */
        export default definePageRoute({ path: '/browse' });
    `;

    const warned = lint(`export default definePageRoute({ path: '/browse' });`, pageFile);
    assert.equal(messagesFor(warned, requireDocAnchorRuleId)[0].severity, 1);

    const escalated = lint(`export default definePageRoute({ path: '/browse' });`, pageFile, {
        docAnchors: 'error',
    });
    assert.equal(messagesFor(escalated, requireDocAnchorRuleId)[0].severity, 2);

    const disabled = lint(source, pageFile, { docAnchors: 'off' });
    assert.equal(messagesFor(disabled, requireDocAnchorRuleId).length, 0);
    assert.equal(messagesFor(disabled, validDocAnchorRuleId).length, 0);
});
