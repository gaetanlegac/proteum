const fs = require('node:fs');
const path = require('node:path');
const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');

const {
    buildDocAnchorGroups,
    docAnchorTags,
    hasDocAnchorTag,
    isPathDocAnchorTag,
    minDocAnchorRuleLength,
    parseDocAnchorComment,
} = require('./docAnchors.js');

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

const traverseNode = (node, visit, parent = null, parentKey = null, ancestors = []) => {
    if (!node || typeof node !== 'object') return;

    visit(node, parent, parentKey, ancestors);

    for (const key of Object.keys(node)) {
        if (skippedTraversalKeys.has(key)) continue;

        const value = node[key];
        const nextAncestors = [...ancestors, { node, childKey: key }];
        if (Array.isArray(value)) {
            value.forEach((child) => {
                if (child && typeof child.type === 'string') traverseNode(child, visit, node, key, nextAncestors);
            });
            continue;
        }

        if (value && typeof value.type === 'string') traverseNode(value, visit, node, key, nextAncestors);
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

const hasOptionalCallBoundary = (callExpression, ancestors = []) => {
    if (callExpression.optional === true) return true;

    let hasOptional = false;
    traverseNode(callExpression.callee, (child) => {
        if (child.type === 'ChainExpression' || child.optional === true) hasOptional = true;
    });

    return hasOptional || ancestors.some(({ node }) => node.type === 'ChainExpression');
};

// A loop body is iteration, not a condition. `for (const item of batch) item.reject(error)`
// preserves the error for every item there is, so it is not a swallow.
const isUnderConditionalControlFlow = (ancestors = []) =>
    ancestors.some(({ node, childKey }) => {
        if (node.type === 'IfStatement') return childKey === 'consequent' || childKey === 'alternate';
        if (node.type === 'ConditionalExpression') return childKey === 'consequent' || childKey === 'alternate';
        if (node.type === 'LogicalExpression') return childKey === 'right';
        if (node.type === 'SwitchCase') return childKey === 'consequent';

        return false;
    });

/**
 * Does the handler throw, whatever it throws?
 *
 * `catch { throw new Error('must be an absolute URL') }` translates a failure
 * into the domain's own vocabulary. The original object is dropped, but the
 * failure still propagates and nothing continues silently, which is what this
 * rule exists to prevent. Attaching the original as `cause` is better practice,
 * not a separate correctness question for this rule.
 */
const handlerThrows = (node) => {
    let throws = false;

    traverseNode(node, (child, _parent, _parentKey, ancestors) => {
        if (child.type === 'ThrowStatement' && !isUnderConditionalControlFlow(ancestors)) throws = true;
    });

    return throws;
};

// A returned fallback is deliberately NOT accepted. `catch { return null }` is
// the textbook swallow, and no structural signal separates it from
// `.catch(() => [])`. Where a fallback really is correct, the call site says so
// with a disable comment and a reason, which stays greppable.

const defaultErrorReporters = ['app.reportError', 'app.handleError'];

/**
 * Does this call match one of the configured `receiver.method` reporters?
 *
 * The receiver may be a bare identifier or the property of a longer chain, so
 * `app.reportError(...)`, `this.app.reportError(...)` and `ctx.app.report(...)`
 * all match a `app.reportError` entry.
 */
const matchesConfiguredReporter = (callExpression, reporters) => {
    const method = getMemberPropertyName(callExpression.callee);
    if (!method) return false;

    // Only project-added reporters are matched here. The built-in two stay with
    // the side logic below, so a server file calling the client's `handleError`
    // is still reported rather than quietly accepted.
    const extraReporters = reporters.filter((reporter) => !defaultErrorReporters.includes(reporter));

    return extraReporters.some((reporter) => {
        const [receiverName, methodName] = reporter.includes('.') ? reporter.split('.') : [null, reporter];
        if (method !== methodName) return false;
        if (receiverName === null) return true;

        const receiver = callExpression.callee.object;
        if (receiver?.type === 'Identifier') return receiver.name === receiverName;

        return getMemberPropertyName(receiver) === receiverName;
    });
};

/**
 * Express hands a caught error to its error middleware with `next(error)`. That
 * is the framework's own propagation path, so treating it as a swallow would
 * report the correct implementation of every route handler.
 */
const isFrameworkPropagationCall = (callExpression, names) =>
    callExpression.callee?.type === 'Identifier' &&
    callExpression.callee.name === 'next' &&
    (callExpression.arguments || []).some((argument) => nodeReferencesName(argument, names));

const isPreservingCall = (callExpression, names, side, ancestors = [], reporters = defaultErrorReporters) => {
    if (!nodeReferencesName(callExpression, names)) return false;
    if (hasOptionalCallBoundary(callExpression, ancestors)) return false;
    if (isConsoleMember(callExpression.callee)) return false;
    if (isPromiseRejectCall(callExpression)) return true;
    if (isFrameworkPropagationCall(callExpression, names)) return true;
    if (matchesConfiguredReporter(callExpression, reporters)) return true;
    if (side === 'client') return isClientErrorHandlerCall(callExpression);
    if (side === 'server') return isServerErrorReporterCall(callExpression);

    return isClientErrorHandlerCall(callExpression) || isServerErrorReporterCall(callExpression);
};

/**
 * Is the caught error handed back to the caller as a value?
 *
 * `return { ok: false, message: error.message }` and
 * `results.push({ state: 'unavailable', message: describeError(error) })` both
 * surface the failure in the API's own vocabulary. That is a designed
 * degradation path, not a loss, so it counts as preservation.
 */
const handlerSurfacesCaughtError = (node, names) => {
    let surfaces = false;

    traverseNode(node, (child) => {
        if (child.type === 'ReturnStatement' && nodeReferencesName(child.argument, names)) surfaces = true;

        if (
            child.type === 'CallExpression' &&
            ['push', 'unshift', 'add', 'set'].includes(getCalleePropertyName(child.callee) || '') &&
            (child.arguments || []).some((argument) => nodeReferencesName(argument, names))
        ) {
            surfaces = true;
        }
    });

    return surfaces;
};

/**
 * Is preservation guarded by a condition that tests the caught error itself?
 *
 * `if (!(error instanceof ExpectedPause)) report(error)` is deliberate
 * filtering: the author chose which failures are worth reporting, which is a
 * decision rather than a swallow. `if (app) app.reportError(error)` is not: it
 * gates on whether the reporter exists, so the error is lost whenever it does
 * not. Only the first is accepted.
 */
const isGuardedByErrorPredicate = (ancestors, names) =>
    ancestors.some(({ node, childKey }) => {
        if (node.type === 'IfStatement' && (childKey === 'consequent' || childKey === 'alternate'))
            return nodeReferencesName(node.test, names);
        if (node.type === 'ConditionalExpression' && (childKey === 'consequent' || childKey === 'alternate'))
            return nodeReferencesName(node.test, names);
        if (node.type === 'LogicalExpression' && childKey === 'right') return nodeReferencesName(node.left, names);
        if (node.type === 'SwitchCase' && childKey === 'consequent') return true;

        return false;
    });

const preservationSurvivesControlFlow = (ancestors, names) =>
    !isUnderConditionalControlFlow(ancestors) || isGuardedByErrorPredicate(ancestors, names);

const handlerPreservesCaughtError = (node, names, side, reporters = defaultErrorReporters) => {
    let preserves = false;

    traverseNode(node, (child, _parent, _parentKey, ancestors) => {
        if (
            child.type === 'ThrowStatement' &&
            nodeReferencesName(child.argument, names) &&
            preservationSurvivesControlFlow(ancestors, names)
        ) {
            preserves = true;
        }
        if (
            child.type === 'CallExpression' &&
            isPreservingCall(child, names, side, ancestors, reporters) &&
            preservationSurvivesControlFlow(ancestors, names)
        ) {
            preserves = true;
        }
    });

    if (!preserves && handlerSurfacesCaughtError(node, names)) preserves = true;

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
        schema: [
            {
                type: 'object',
                properties: {
                    // `receiver.method` or a bare `method`. A project whose error
                    // path is not `app.reportError` names it here rather than
                    // being told its own convention is a swallow.
                    reporters: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
    },
    create(context) {
        const side = getErrorHandlingSide(context.filename || context.getFilename?.() || '');
        const reporters = context.options?.[0]?.reporters || defaultErrorReporters;
        const reportHandler = (node, params, body) => {
            const names = params.flatMap((param) => collectPatternNames(param));
            if (names.length === 0) {
                // Nothing was bound, so nothing can be routed. Still accepted when
                // the handler translates the failure into a throw, because the
                // failure keeps propagating rather than being continued past.
                if (handlerThrows(body)) return;

                context.report({ node, messageId: 'missingParam' });
                return;
            }

            const referencedName = names.find((name) => nodeReferencesName(body, [name]));
            if (!referencedName) {
                context.report({ node, messageId: 'unusedParam', data: { name: names[0] } });
                return;
            }

            if (handlerThrows(body)) return;

            if (!handlerPreservesCaughtError(body, collectDerivedErrorNames(body, names), side, reporters)) {
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

const boundaryTagPattern = /(^|\s)@boundary(\s|$)/;

/**
 * Is this `unknown` inside a function whose return type is a type predicate?
 *
 * Narrowing an untrusted value is the entire job of a guard, so `(value: unknown):
 * value is DomainField` is the correct signature. Any narrower input type would
 * defeat the guard it belongs to.
 */
const isWithinTypeGuardSignature = (node) => {
    let current = node.parent;
    while (current) {
        if (current.returnType?.typeAnnotation?.type === 'TSTypePredicate') return true;
        current = current.parent;
    }

    return false;
};

/**
 * Is this `unknown` inside the *parameter* of a catch clause?
 *
 * Range containment rather than a parent-chain shape check, so a destructured or
 * annotated binding qualifies too. The containment test matters: the catch BODY
 * also has the clause as an ancestor, and `unknown` there is not the language's
 * doing and still needs a reason.
 */
const isWithinCatchParameter = (node) => {
    let current = node.parent;
    while (current) {
        if (current.type === 'CatchClause') {
            return (
                current.param != null &&
                node.range[0] >= current.param.range[0] &&
                node.range[1] <= current.param.range[1]
            );
        }
        current = current.parent;
    }

    return false;
};

const createNoLooseUnknownRule = () => ({
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow `unknown` except where a value genuinely crosses a trust boundary.',
        },
        messages: {
            looseUnknown:
                '`unknown` hides a contract that should be typed. Define the explicit type, or, when the value really does arrive from outside (a parsed response, a provider payload, a caught error), document it with a `@boundary` comment saying where it comes from.',
        },
        schema: [],
    },
    create(context) {
        const sourceCode = getSourceCode(context);

        // A `@boundary` tag anywhere above the declaration marks a deliberate
        // trust boundary. Requiring the tag rather than allowing `unknown`
        // silently keeps the boundaries greppable and forces a written reason.
        const hasBoundaryTag = (node) => {
            if (!sourceCode) return false;

            const comments = sourceCode.getCommentsBefore?.(node) || [];
            if (comments.some((comment) => boundaryTagPattern.test(comment.value))) return true;

            // Walk to the enclosing declaration rather than a fixed few levels:
            // a nested position such as `{ query(v?: readonly unknown[]): Promise<unknown> }`
            // sits eight or more nodes below the parameter the tag documents.
            let current = node.parent;
            while (current && current.type !== 'Program') {
                const ancestorComments = sourceCode.getCommentsBefore?.(current) || [];
                if (ancestorComments.some((comment) => boundaryTagPattern.test(comment.value))) return true;
                current = current.parent;
            }

            return false;
        };

        return {
            TSUnknownKeyword(node) {
                // TypeScript itself types a catch binding as `unknown`, so banning
                // it there bans the language's own contract.
                if (isWithinCatchParameter(node)) return;
                if (isWithinTypeGuardSignature(node)) return;
                if (hasBoundaryTag(node)) return;

                context.report({ node, messageId: 'looseUnknown' });
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

// Error routes are deliberately absent: a `_messages/404` page renders a status
// message and carries no feature-specific rule, so requiring a feature pack for
// one would manufacture documentation to satisfy the linter. An error page that
// does carry a real rule can still add an anchor, and `valid-doc-anchor` keeps
// checking it.
const defaultDocAnchorDefinitions = [
    'defineController',
    'definePageRoute',
    'defineServerRoute',
    'defineServerRoutes',
];

const docsRootCache = new Map();
const directoryEntriesCache = new Map();

const getSourceCode = (context) => context.sourceCode || context.getSourceCode?.();

const getContextCwd = (context) => context.cwd || context.getCwd?.() || process.cwd();

const pathExists = (candidate) => {
    try {
        return fs.existsSync(candidate);
    } catch (_error) {
        return false;
    }
};

const readDirectoryEntries = (directory) => {
    if (directoryEntriesCache.has(directory)) return directoryEntriesCache.get(directory);

    let entries = [];
    try {
        entries = fs.readdirSync(directory);
    } catch (_error) {
        entries = [];
    }

    directoryEntriesCache.set(directory, entries);
    return entries;
};

/**
 * Collect every ancestor of a linted file that holds a `docs/` directory,
 * nearest first.
 *
 * All of them are candidates, not just the nearest: a monorepo app commonly has
 * its own `apps/<app>/docs/` alongside the repository-level corpus, and stopping
 * at the first match would make every anchor aimed at the shared corpus fail to
 * resolve.
 */
const findDocsRoots = (startDirectory) => {
    if (docsRootCache.has(startDirectory)) return docsRootCache.get(startDirectory);

    const resolved = [];
    let current = startDirectory;
    while (current) {
        if (pathExists(path.join(current, 'docs'))) resolved.push(current);

        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    docsRootCache.set(startDirectory, resolved);
    return resolved;
};

const resolveAnchorRoots = (context) => {
    const filename = context.filename || context.getFilename?.() || '';
    const fileDirectory = filename ? path.dirname(filename) : undefined;
    const cwd = getContextCwd(context);
    const roots = [];

    const addRoot = (root) => {
        if (root && !roots.includes(root)) roots.push(root);
    };

    if (fileDirectory) findDocsRoots(fileDirectory).forEach(addRoot);
    addRoot(cwd);
    addRoot(fileDirectory);

    return roots;
};

const resolvePathAnchor = (value, roots) => {
    if (path.isAbsolute(value)) return pathExists(value);

    return roots.some((root) => pathExists(path.resolve(root, value)));
};

const resolveAdrAnchor = (value, roots) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;

    const decisionDirectories = roots
        .map((root) => path.join(root, 'docs', 'decisions'))
        .filter((directory) => pathExists(directory));

    // Projects without a decisions corpus never fail this check, so the rule
    // stays silent instead of inventing a convention the app has not adopted.
    if (decisionDirectories.length === 0) return true;

    return decisionDirectories.some((directory) =>
        readDirectoryEntries(directory).some((entry) => entry.toLowerCase().startsWith(normalized)),
    );
};

const collectFileDocAnchors = (context) => {
    const sourceCode = getSourceCode(context);
    if (!sourceCode) return buildDocAnchorGroups([]);

    const entries = [];
    sourceCode.getAllComments().forEach((comment) => {
        if (comment.type !== 'Block') return;
        entries.push(...parseDocAnchorComment(comment.value, comment.loc?.start?.line || 1));
    });

    return buildDocAnchorGroups(entries);
};

const unwrapExpression = (node) => {
    let current = node;
    while (
        current &&
        (current.type === 'TSAsExpression' ||
            current.type === 'TSSatisfiesExpression' ||
            current.type === 'TSNonNullExpression')
    ) {
        current = current.expression;
    }

    return current;
};

const getDefinitionCalleeName = (node, definitions) => {
    const expression = unwrapExpression(node);
    if (expression?.type !== 'CallExpression') return null;

    const name = getCalleePropertyName(expression.callee);
    return name && definitions.includes(name) ? name : null;
};

const getSuperClassName = (node) => {
    const superClass = node?.superClass;
    if (!superClass) return null;
    if (superClass.type === 'Identifier') return superClass.name;
    // `extends Service<Config, Hooks, App, object>` parses the generic call as a
    // member or call expression depending on the parser path.
    if (superClass.type === 'CallExpression') return getCalleePropertyName(superClass.callee);
    if (superClass.type === 'MemberExpression') return getMemberPropertyName(superClass);

    return null;
};

/**
 * An exported class extending a Proteum service base owns business logic, so it
 * carries the same documentation obligation as a route or controller. Matching
 * on the base-class suffix covers both `extends Service` and app-specific bases
 * such as `extends UsersManagementService`.
 */
const isServiceClass = (node, pattern) => {
    if (node?.type !== 'ClassDeclaration') return false;

    const superClassName = getSuperClassName(node);
    return Boolean(superClassName && pattern.test(superClassName));
};

const globToRegExp = (glob) => {
    let pattern = '';

    for (let index = 0; index < glob.length; index += 1) {
        const character = glob[index];

        if (character === '*') {
            if (glob[index + 1] === '*') {
                // `**/` spans any number of directories; a trailing `**` spans
                // the rest of the path, separators included.
                if (glob[index + 2] === '/') {
                    pattern += '(?:[^/]*\/)*';
                    index += 2;
                    continue;
                }

                pattern += '.*';
                index += 1;
                continue;
            }

            pattern += '[^/]*';
            continue;
        }

        pattern += '.+^${}()|[]\\?'.includes(character) ? `\\${character}` : character;
    }

    return new RegExp(`(^|/)${pattern}$`);
};

const includeMatchers = new Map();

const matchesIncludeGlob = (filename, includes) => {
    if (!filename || includes.length === 0) return false;

    const normalized = filename.replace(/\\/g, '/');
    return includes.some((glob) => {
        if (!includeMatchers.has(glob)) includeMatchers.set(glob, globToRegExp(glob));
        return includeMatchers.get(glob).test(normalized);
    });
};

const createRequireDocAnchorRule = () => ({
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require Proteum definition files to anchor the documentation that governs them.',
        },
        messages: {
            missingAnchor:
                '`{{definition}}` files must carry a doc anchor. Add a leading block comment with `@docs <path to the feature pack>`, plus `@rule <one-line invariant>` when a fix or decision constrains this file.',
            missingTag:
                '`{{definition}}` files must carry a `@{{tag}}` doc anchor in a leading block comment.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    definitions: { type: 'array', items: { type: 'string' } },
                    exclude: { type: 'array', items: { type: 'string' } },
                    include: { type: 'array', items: { type: 'string' } },
                    requiredTags: { type: 'array', items: { enum: docAnchorTags } },
                    serviceBasePattern: { type: 'string' },
                },
                additionalProperties: false,
            },
        ],
    },
    create(context) {
        const options = context.options?.[0] || {};
        const definitions = options.definitions || defaultDocAnchorDefinitions;
        const requiredTags = options.requiredTags || ['docs'];
        const includes = options.include || [];
        const excludes = options.exclude || [];
        const serviceBasePattern = new RegExp(options.serviceBasePattern || 'Service$');
        const filename = context.filename || context.getFilename?.() || '';

        // Infrastructure carries no feature contract, so a project lists those
        // paths here rather than anchoring them to a pack that does not exist.
        // An excluded file may still declare anchors, and `valid-doc-anchor`
        // keeps checking them.
        const excluded = matchesIncludeGlob(filename, excludes);

        let reported = false;

        const reportMissing = (node, subject) => {
            // One report per file: a service class and an include glob can both
            // match, and repeating the same instruction adds no information.
            if (reported || excluded) return;

            const anchors = collectFileDocAnchors(context);
            if (anchors.entries.length === 0) {
                reported = true;
                context.report({ node, messageId: 'missingAnchor', data: { definition: subject } });
                return;
            }

            const missingTag = requiredTags.find((tag) => !hasDocAnchorTag(anchors, tag));
            if (missingTag) {
                reported = true;
                context.report({ node, messageId: 'missingTag', data: { definition: subject, tag: missingTag } });
            }
        };

        const checkClass = (node) => {
            if (!isServiceClass(node, serviceBasePattern)) return;
            reportMissing(node, getSuperClassName(node));
        };

        return {
            ExportDefaultDeclaration(node) {
                if (node.declaration?.type === 'ClassDeclaration') {
                    checkClass(node.declaration);
                    return;
                }

                const definition = getDefinitionCalleeName(node.declaration, definitions);
                if (definition) reportMissing(node, definition);
            },
            ExportNamedDeclaration(node) {
                if (node.declaration?.type === 'ClassDeclaration') checkClass(node.declaration);
            },
            'Program:exit'(node) {
                if (!matchesIncludeGlob(filename, includes)) return;
                reportMissing(node, path.basename(filename));
            },
        };
    },
});

const createValidDocAnchorRule = () => ({
    meta: {
        type: 'problem',
        docs: {
            description: 'Require doc anchors to point at documentation that still exists.',
        },
        messages: {
            unresolvedPath:
                'Doc anchor `@{{tag}} {{value}}` does not resolve to a file or directory. Update the anchor to the current documentation path, or remove it.',
            unresolvedAdr:
                'Doc anchor `@adr {{value}}` matches no decision record under `docs/decisions`. Use the current ADR identifier.',
            emptyRule:
                'Doc anchor `@rule` must state the invariant in full so an agent editing this file can apply it without opening the linked document.',
        },
        schema: [],
    },
    create(context) {
        return {
            'Program:exit'() {
                const anchors = collectFileDocAnchors(context);
                if (anchors.entries.length === 0) return;

                const roots = resolveAnchorRoots(context);
                anchors.entries.forEach((entry) => {
                    const loc = { line: entry.line, column: 0 };

                    if (entry.tag === 'rule') {
                        if (entry.value.length < minDocAnchorRuleLength) {
                            context.report({ loc, messageId: 'emptyRule' });
                        }
                        return;
                    }

                    if (isPathDocAnchorTag(entry.tag)) {
                        if (!resolvePathAnchor(entry.value, roots)) {
                            context.report({
                                loc,
                                messageId: 'unresolvedPath',
                                data: { tag: entry.tag, value: entry.value },
                            });
                        }
                        return;
                    }

                    if (entry.tag === 'adr' && !resolveAdrAnchor(entry.value, roots)) {
                        context.report({ loc, messageId: 'unresolvedAdr', data: { value: entry.value } });
                    }
                });
            },
        };
    },
});

const defaultTestFilePatterns = [
    '**/*.test.{ts,tsx,mts,cts}',
    '**/*.spec.{ts,tsx,mts,cts}',
    '**/*.node-test.{ts,tsx,mts,cts}',
    '**/tests/**/*.{ts,tsx,mts,cts}',
];

const createProteumEslintConfig = ({
    docAnchors = 'warn',
    errorReporters = defaultErrorReporters,
    excludeDocAnchors = [],
    includeDocAnchors = [],
    ignores = [],
    testFiles = defaultTestFilePatterns,
} = {}) => [
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
                    'no-loose-unknown': createNoLooseUnknownRule(),
                    'no-swallowed-caught-error': createSwallowedErrorRule(),
                    'require-doc-anchor': createRequireDocAnchorRule(),
                    'valid-doc-anchor': createValidDocAnchorRule(),
                },
            },
            react: reactPlugin,
            'react-hooks': reactHooksPlugin,
            'jsx-a11y': jsxA11yPlugin,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            'proteum/no-app-import': 'error',
            'proteum/no-swallowed-caught-error': ['error', { reporters: errorReporters }],
            // Missing anchors warn by default so adopting apps see the backlog
            // without a failing build; pass `docAnchors: 'error'` once backfilled.
            // Routes, controllers and service classes are covered automatically.
            // `includeDocAnchors` opts in extra paths, which is how a project
            // covers the feature-owning components without dragging in every
            // presentational primitive.
            'proteum/require-doc-anchor': [
                docAnchors,
                { exclude: excludeDocAnchors, include: includeDocAnchors },
            ],
            // A stale anchor is always an error: it only fires on files that
            // already opted in, and a pointer to a deleted document is worse
            // than no pointer at all.
            'proteum/valid-doc-anchor': docAnchors === 'off' ? 'off' : 'error',
            // Replaces the old bare `TSUnknownKeyword` selector. A selector has no
            // context, so it could not tell an internal contract that should be
            // typed from a value that genuinely arrives from outside.
            'proteum/no-loose-unknown': 'error',
            'no-restricted-syntax': [
                'error',
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
    {
        // A test fixture deliberately builds a shape the production types forbid,
        // usually through `as unknown as X` or a partial mock. That is a test
        // technique, not a trust boundary, so demanding a `@boundary` reason for
        // each one would add noise without documenting anything real.
        files: testFiles,
        rules: {
            'proteum/no-loose-unknown': 'off',
        },
    },
];

module.exports = {
    createProteumEslintConfig,
    defaultTestFilePatterns,
};
