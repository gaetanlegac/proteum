const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');

const defaultIgnores = [
    '**/node_modules/**',
    '**/bin/**',
    '**/bin-dev/**',
    '**/.generated/**',
    '**/var/**',
];

const createZodTypeFactorySelector = (factoryName) =>
    `CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.type='Identifier'][callee.object.name=/^(schema|z|zod)$/][callee.property.name='${factoryName}']`;

const skippedTraversalKeys = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

const traverseNode = (node, visit, parent = null, parentKey = null) => {
    if (!node || typeof node !== 'object') return;

    visit(node, parent, parentKey);

    for (const key of Object.keys(node)) {
        if (skippedTraversalKeys.has(key)) continue;

        const value = node[key];
        if (Array.isArray(value)) {
            value.forEach((child) => {
                if (child && typeof child.type === 'string') traverseNode(child, visit, node, key);
            });
            continue;
        }

        if (value && typeof value.type === 'string') traverseNode(value, visit, node, key);
    }
};

const collectPatternNames = (node, names = []) => {
    if (!node) return names;

    if (node.type === 'Identifier') {
        names.push(node.name);
        return names;
    }

    if (node.type === 'RestElement') return collectPatternNames(node.argument, names);
    if (node.type === 'AssignmentPattern') return collectPatternNames(node.left, names);
    if (node.type === 'TSParameterProperty') return collectPatternNames(node.parameter, names);

    if (node.type === 'ArrayPattern') {
        node.elements.forEach((element) => collectPatternNames(element, names));
        return names;
    }

    if (node.type === 'ObjectPattern') {
        node.properties.forEach((property) => {
            if (property.type === 'Property') collectPatternNames(property.value, names);
            if (property.type === 'RestElement') collectPatternNames(property.argument, names);
        });
    }

    return names;
};

const nodeReferencesName = (node, names) => {
    let references = false;

    traverseNode(node, (child, parent, parentKey) => {
        if (child.type !== 'Identifier' || !names.includes(child.name)) return;
        if (parent?.type === 'MemberExpression' && parentKey === 'property' && parent.computed === false) return;
        if (parent?.type === 'Property' && parentKey === 'key' && parent.computed === false) return;
        if (parent?.type === 'MethodDefinition' && parentKey === 'key' && parent.computed === false) return;
        if (parent?.type === 'PropertyDefinition' && parentKey === 'key' && parent.computed === false) return;

        references = true;
    });

    return references;
};

const collectDerivedErrorNames = (node, baseNames) => {
    const names = [...baseNames];
    let changed = true;

    while (changed) {
        changed = false;

        traverseNode(node, (child) => {
            if (child.type === 'VariableDeclarator' && child.id?.type === 'Identifier' && nodeReferencesName(child.init, names)) {
                if (!names.includes(child.id.name)) {
                    names.push(child.id.name);
                    changed = true;
                }
            }

            if (
                child.type === 'AssignmentExpression' &&
                child.left?.type === 'Identifier' &&
                nodeReferencesName(child.right, names)
            ) {
                if (!names.includes(child.left.name)) {
                    names.push(child.left.name);
                    changed = true;
                }
            }
        });
    }

    return names;
};

const getCalleePropertyName = (callee) => {
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') {
        if (callee.property.type === 'Identifier') return callee.property.name;
        if (callee.property.type === 'Literal') return String(callee.property.value);
    }

    return null;
};

const getErrorHandlingSide = (filename) => {
    const normalized = filename.replace(/\\/g, '/');
    if (/(^|\/)client\//.test(normalized)) return 'client';
    if (/(^|\/)(server|commands)\//.test(normalized)) return 'server';

    return 'shared';
};

const getMemberPropertyName = (node) => {
    if (node?.type !== 'MemberExpression') return null;
    if (node.property.type === 'Identifier') return node.property.name;
    if (node.property.type === 'Literal') return String(node.property.value);

    return null;
};

const isConsoleMember = (node) =>
    node?.type === 'MemberExpression' && node.object?.type === 'Identifier' && node.object.name === 'console';

const isAppReceiver = (node) => {
    if (!node) return false;
    if (node.type === 'Identifier' && node.name === 'app') return true;
    if (node.type === 'MemberExpression' && getMemberPropertyName(node) === 'app') return true;

    return false;
};

const isClientErrorHandlerCall = (callExpression) =>
    callExpression.callee.type === 'MemberExpression' &&
    getMemberPropertyName(callExpression.callee) === 'handleError' &&
    isAppReceiver(callExpression.callee.object);

const isServerErrorReporterCall = (callExpression) =>
    callExpression.callee.type === 'MemberExpression' &&
    getMemberPropertyName(callExpression.callee) === 'reportError' &&
    isAppReceiver(callExpression.callee.object);

const isPromiseRejectCall = (callExpression) => getCalleePropertyName(callExpression.callee) === 'reject';

const isPreservingCall = (callExpression, names, side) => {
    if (!nodeReferencesName(callExpression, names)) return false;
    if (isConsoleMember(callExpression.callee)) return false;
    if (isPromiseRejectCall(callExpression)) return true;
    if (side === 'client') return isClientErrorHandlerCall(callExpression);
    if (side === 'server') return isServerErrorReporterCall(callExpression);

    return isClientErrorHandlerCall(callExpression) || isServerErrorReporterCall(callExpression);
};

const handlerPreservesCaughtError = (node, names, side) => {
    let preserves = false;

    traverseNode(node, (child) => {
        if (child.type === 'ThrowStatement' && nodeReferencesName(child.argument, names)) preserves = true;
        if (child.type === 'CallExpression' && isPreservingCall(child, names, side)) preserves = true;
    });

    return preserves;
};

const isDirectPromiseCatchHandler = (node) => {
    const name = getCalleePropertyName(node);
    return name === 'reject';
};

const createSwallowedErrorRule = () => ({
    meta: {
        type: 'problem',
        docs: {
            description: 'Require caught errors to reach the standard app error path or be rethrown.',
        },
        messages: {
            missingParam:
                'Caught errors must be bound and routed through the standard error path. Use `catch (error)` and rethrow, call app.reportError on the server, or call app.handleError on the client.',
            unusedParam:
                'Caught error `{{name}}` is discarded. Rethrow it, call app.reportError on the server, or call app.handleError on the client.',
            unpreserved:
                'Caught error `{{name}}` is used but not routed through the standard error path. Rethrow it, call app.reportError on the server, or call app.handleError on the client.',
        },
        schema: [],
    },
    create(context) {
        const side = getErrorHandlingSide(context.filename || context.getFilename?.() || '');
        const reportHandler = (node, params, body) => {
            const names = params.flatMap((param) => collectPatternNames(param));
            if (names.length === 0) {
                context.report({ node, messageId: 'missingParam' });
                return;
            }

            const referencedName = names.find((name) => nodeReferencesName(body, [name]));
            if (!referencedName) {
                context.report({ node, messageId: 'unusedParam', data: { name: names[0] } });
                return;
            }

            if (!handlerPreservesCaughtError(body, collectDerivedErrorNames(body, names), side)) {
                context.report({ node, messageId: 'unpreserved', data: { name: referencedName } });
            }
        };

        return {
            CatchClause(node) {
                reportHandler(node, node.param ? [node.param] : [], node.body);
            },
            "CallExpression[callee.type='MemberExpression'][callee.property.name='catch']"(node) {
                const [handler] = node.arguments;
                if (!handler) return;
                if (isDirectPromiseCatchHandler(handler)) return;

                if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') {
                    context.report({ node: handler, messageId: 'missingParam' });
                    return;
                }

                reportHandler(handler, handler.params, handler.body);
            },
        };
    },
});

const createNoAppImportRule = () => ({
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow Proteum contextual @app imports in user code.',
        },
        messages: {
            noAppImport:
                '`@app` is not a real runtime module. Receive app services through typed route/controller callback context instead.',
        },
        schema: [],
    },
    create(context) {
        return {
            ImportDeclaration(node) {
                if (node.source?.value === '@app') context.report({ node, messageId: 'noAppImport' });
            },
            CallExpression(node) {
                if (
                    node.callee?.type === 'Identifier' &&
                    node.callee.name === 'require' &&
                    node.arguments?.[0]?.type === 'Literal' &&
                    node.arguments[0].value === '@app'
                ) {
                    context.report({ node, messageId: 'noAppImport' });
                }
            },
        };
    },
});

const createProteumEslintConfig = ({ ignores = [] } = {}) => [
    {
        ignores: [...defaultIgnores, ...ignores],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            proteum: {
                rules: {
                    'no-app-import': createNoAppImportRule(),
                    'no-swallowed-caught-error': createSwallowedErrorRule(),
                },
            },
            react: reactPlugin,
            'react-hooks': reactHooksPlugin,
            'jsx-a11y': jsxA11yPlugin,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            'proteum/no-app-import': 'error',
            'proteum/no-swallowed-caught-error': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSUnknownKeyword',
                    message: 'Do not use `unknown`; define an explicit type instead.',
                },
                {
                    selector: createZodTypeFactorySelector('any'),
                    message: 'Do not use Zod `any()` schemas; define an explicit schema instead.',
                },
                {
                    selector: createZodTypeFactorySelector('unknown'),
                    message: 'Do not use Zod `unknown()` schemas; define an explicit schema instead.',
                },
            ],
        },
    },
];

module.exports = {
    createProteumEslintConfig,
};
