import fs from 'fs-extra';
import path from 'path';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as types from '@babel/types';

const findFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findFiles(filepath));
            continue;
        }

        if (dirent.isFile() && /\.(tsx?|jsx?)$/.test(filepath)) files.push(filepath);
    }

    return files;
};

const ensureRouterImport = (programPath: NodePath<types.Program>) => {
    const hasRouterImport = programPath.node.body.some(
        (statement) =>
            statement.type === 'ImportDeclaration' &&
            statement.source.value === '@/client/router' &&
            statement.specifiers.some(
                (specifier) => specifier.type === 'ImportDefaultSpecifier' && specifier.local.name === 'Router',
            ),
    );

    if (!hasRouterImport) {
        programPath.unshiftContainer(
            'body',
            types.importDeclaration(
                [types.importDefaultSpecifier(types.identifier('Router'))],
                types.stringLiteral('@/client/router'),
            ),
        );
    }
};

const ensureBlockBody = (
    functionPath: NodePath<types.FunctionExpression | types.ArrowFunctionExpression | types.FunctionDeclaration>,
) => {
    if (functionPath.isArrowFunctionExpression() && functionPath.node.body.type !== 'BlockStatement') {
        functionPath.node.body = types.blockStatement([types.returnStatement(functionPath.node.body)]);
    }

    return functionPath.get('body') as NodePath<types.BlockStatement>;
};

const ensureObjectPatternParam = (
    functionPath: NodePath<types.FunctionExpression | types.ArrowFunctionExpression | types.FunctionDeclaration>,
) => {
    if (!functionPath.node.params.length) {
        functionPath.node.params = [types.objectPattern([])];
    }

    const firstParam = functionPath.node.params[0];
    if (firstParam.type === 'ObjectPattern') return firstParam;

    return null;
};

const findObjectPatternParam = (
    functionNode: types.FunctionExpression | types.ArrowFunctionExpression | types.FunctionDeclaration,
) => {
    const firstParam = functionNode.params[0];

    if (!firstParam || firstParam.type !== 'ObjectPattern') return null;

    return firstParam;
};

const getReturnedObjectExpression = (
    functionNode: types.FunctionExpression | types.ArrowFunctionExpression | types.FunctionDeclaration,
) => {
    if (functionNode.body.type === 'ObjectExpression') return functionNode.body;

    if (functionNode.body.type !== 'BlockStatement') return null;

    for (const statement of functionNode.body.body) {
        if (statement.type === 'ReturnStatement' && statement.argument?.type === 'ObjectExpression')
            return statement.argument;
    }

    return null;
};

const objectPatternHasProperty = (pattern: types.ObjectPattern, localName: string) =>
    pattern.properties.some(
        (property) =>
            property.type === 'ObjectProperty' &&
            property.value.type === 'Identifier' &&
            property.value.name === localName,
    );

const addObjectPatternProperty = (pattern: types.ObjectPattern, keyName: string, localName: string = keyName) => {
    if (objectPatternHasProperty(pattern, localName)) return;

    pattern.properties.push(
        types.objectProperty(types.identifier(keyName), types.identifier(localName), false, keyName === localName),
    );
};

const getObjectPropertyKeyName = (property: types.ObjectProperty) => {
    if (property.key.type === 'Identifier') return property.key.name;

    if (property.key.type === 'StringLiteral') return property.key.value;

    return null;
};

const pushUniqueObjectProperty = (
    properties: (types.ObjectProperty | types.SpreadElement)[],
    property: types.ObjectProperty,
) => {
    const nextKey = getObjectPropertyKeyName(property);
    if (!nextKey) {
        properties.push(property);
        return;
    }

    const existingIndex = properties.findIndex(
        (existingProperty) =>
            existingProperty.type === 'ObjectProperty' && getObjectPropertyKeyName(existingProperty) === nextKey,
    );

    if (existingIndex >= 0) {
        properties[existingIndex] = property;
        return;
    }

    properties.push(property);
};

const getObjectPatternPropertyLocalName = (property: types.ObjectProperty) => {
    if (property.value.type === 'Identifier') return property.value.name;

    if (property.value.type === 'AssignmentPattern' && property.value.left.type === 'Identifier')
        return property.value.left.name;

    return null;
};

const pushUniqueObjectPatternProperty = (properties: types.ObjectProperty[], property: types.ObjectProperty) => {
    const nextLocalName = getObjectPatternPropertyLocalName(property);
    const nextKeyName = getObjectPropertyKeyName(property);

    const existingIndex = properties.findIndex(
        (existingProperty) =>
            (nextLocalName && getObjectPatternPropertyLocalName(existingProperty) === nextLocalName) ||
            (nextKeyName && getObjectPropertyKeyName(existingProperty) === nextKeyName),
    );

    if (existingIndex >= 0) {
        properties[existingIndex] = property;
        return;
    }

    properties.push(property);
};

const unwrapFetchExpression = (init: types.Expression | null | undefined) => {
    const wrappers: Array<(expression: types.Expression) => types.Expression> = [];
    let current = init || null;

    while (current) {
        if (current.type === 'ParenthesizedExpression') {
            wrappers.push((expression) => types.parenthesizedExpression(expression));
            current = current.expression;
            continue;
        }

        if (current.type === 'TSAsExpression') {
            const typeAnnotation = current.typeAnnotation;
            wrappers.push((expression) => types.tsAsExpression(expression, typeAnnotation));
            current = current.expression;
            continue;
        }

        if (current.type === 'TSTypeAssertion') {
            const typeAnnotation = current.typeAnnotation;
            wrappers.push((expression) => types.tsTypeAssertion(typeAnnotation, expression));
            current = current.expression;
            continue;
        }

        if (current.type === 'TSNonNullExpression') {
            wrappers.push((expression) => types.tsNonNullExpression(expression));
            current = current.expression;
            continue;
        }

        break;
    }

    if (
        !current ||
        current.type !== 'CallExpression' ||
        current.callee.type !== 'MemberExpression' ||
        current.callee.object.type !== 'Identifier' ||
        current.callee.object.name !== 'api' ||
        current.callee.property.type !== 'Identifier' ||
        current.callee.property.name !== 'fetch' ||
        current.arguments[0]?.type !== 'ObjectExpression'
    )
        return null;

    return {
        callExpression: current,
        wrapExpression(expression: types.Expression) {
            return wrappers.reduceRight((acc, applyWrapper) => applyWrapper(acc), expression);
        },
    };
};

const removeUnusedUseContextImport = (programPath: NodePath<types.Program>) => {
    let useContextReferenced = false;

    traverse(programPath.node, {
        noScope: true,
        Identifier(path) {
            if (path.node.name !== 'useContext') return;

            if (path.parent.type === 'ImportDefaultSpecifier') return;

            useContextReferenced = true;
            path.stop();
        },
    });

    if (useContextReferenced) return;

    for (const statementPath of programPath.get('body')) {
        if (!statementPath.isImportDeclaration()) continue;

        if (statementPath.node.source.value !== '@/client/context') continue;

        const nextSpecifiers = statementPath.node.specifiers.filter(
            (specifier) => specifier.type !== 'ImportDefaultSpecifier' || specifier.local.name !== 'useContext',
        );

        if (!nextSpecifiers.length) statementPath.remove();
        else statementPath.node.specifiers = nextSpecifiers;

        break;
    }
};

const prefixOptionsObject = (options: types.ObjectExpression) => {
    const properties: (types.ObjectProperty | types.SpreadElement)[] = [];

    for (const property of options.properties) {
        if (property.type !== 'ObjectProperty') {
            properties.push(property);
            continue;
        }

        if (property.key.type === 'Identifier') {
            properties.push(
                types.objectProperty(types.identifier(`_${property.key.name}`), property.value, false, false),
            );
            continue;
        }

        if (property.key.type === 'StringLiteral') {
            properties.push(types.objectProperty(types.stringLiteral(`_${property.key.value}`), property.value));
            continue;
        }

        properties.push(property);
    }

    return types.objectExpression(properties);
};

const repoRoots = process.argv.slice(2);
if (!repoRoots.length) throw new Error('Usage: ts-node scripts/refactor-client-pages.ts <repo-root> [repo-root...]');

for (const repoRoot of repoRoots) {
    const pagesRoot = path.join(repoRoot, 'client', 'pages');
    const files = findFiles(pagesRoot);
    let changedFiles = 0;

    for (const filepath of files) {
        const code = fs.readFileSync(filepath, 'utf8');
        if (
            !code.includes('Router.page(') &&
            !code.includes('api.fetch(') &&
            !code.includes('@app') &&
            !code.includes('"@app"')
        )
            continue;

        const ast = parse(code, {
            sourceType: 'module',
            errorRecovery: true,
            plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
        });

        const importedServices = new Set<string>();
        let hasAppImport = false;
        let routeCallPath: NodePath<types.CallExpression> | null = null;
        let renderFunctionPath: NodePath<
            types.FunctionExpression | types.ArrowFunctionExpression | types.FunctionDeclaration
        > | null = null;

        traverse(ast, {
            noScope: true,
            ImportDeclaration(path) {
                if (path.node.source.value !== '@app') return;

                hasAppImport = true;

                for (const specifier of path.node.specifiers) {
                    if (
                        specifier.type === 'ImportSpecifier' &&
                        specifier.imported.type === 'Identifier' &&
                        specifier.imported.name !== 'Router'
                    )
                        importedServices.add(specifier.local.name);
                }

                path.remove();
            },
            CallExpression(path) {
                if (routeCallPath) return;

                const callee = path.node.callee;
                if (
                    callee.type === 'MemberExpression' &&
                    callee.object.type === 'Identifier' &&
                    callee.object.name === 'Router' &&
                    callee.property.type === 'Identifier' &&
                    callee.property.name === 'page'
                ) {
                    routeCallPath = path;

                    const renderArg = path.get('arguments')[path.node.arguments.length - 1];
                    if (
                        renderArg &&
                        (renderArg.isArrowFunctionExpression() ||
                            renderArg.isFunctionExpression() ||
                            renderArg.isFunctionDeclaration())
                    )
                        renderFunctionPath = renderArg as NodePath<
                            types.FunctionExpression | types.ArrowFunctionExpression | types.FunctionDeclaration
                        >;
                }
            },
        });

        if (!routeCallPath || !renderFunctionPath) {
            if (!hasAppImport) continue;
        }

        let changed = hasAppImport;

        traverse(ast, {
            noScope: true,
            Program(programPath) {
                if (hasAppImport) ensureRouterImport(programPath);
            },
        });

        if (renderFunctionPath) {
            ensureBlockBody(renderFunctionPath);
            const renderParam = ensureObjectPatternParam(renderFunctionPath);
            if (!renderParam) continue;

            const fetcherProperties: types.ObjectProperty[] = [];
            const extraRenderProperties: Array<{ key: string; local: string }> = [];
            const setupContextNames = new Set<string>();
            let setupNeeded = false;

            renderFunctionPath.traverse({
                noScope: true,
                VariableDeclarator(path) {
                    const fetchExpression = unwrapFetchExpression(path.node.init);
                    if (!fetchExpression) return;

                    const declarationPath = path.findParent((parentPath) => parentPath.isVariableDeclaration());
                    if (!declarationPath?.isVariableDeclaration()) return;

                    setupNeeded = true;
                    changed = true;

                    for (const property of fetchExpression.callExpression.arguments[0].properties) {
                        if (property.type === 'ObjectProperty') fetcherProperties.push(property);
                    }

                    if (path.node.id.type === 'ObjectPattern') {
                        for (const property of path.node.id.properties) {
                            if (property.type !== 'ObjectProperty' || property.key.type !== 'Identifier') continue;

                            if (property.value.type === 'Identifier')
                                extraRenderProperties.push({ key: property.key.name, local: property.value.name });
                            else if (
                                property.value.type === 'AssignmentPattern' &&
                                property.value.left.type === 'Identifier'
                            )
                                extraRenderProperties.push({ key: property.key.name, local: property.value.left.name });
                        }

                        declarationPath.remove();
                        return;
                    }

                    if (path.node.id.type === 'Identifier') {
                        const objectProperties = fetchExpression.callExpression.arguments[0].properties
                            .filter(
                                (property): property is types.ObjectProperty =>
                                    property.type === 'ObjectProperty' && property.key.type === 'Identifier',
                            )
                            .map((property) => {
                                extraRenderProperties.push({ key: property.key.name, local: property.key.name });
                                return types.objectProperty(
                                    types.identifier(property.key.name),
                                    types.identifier(property.key.name),
                                    false,
                                    true,
                                );
                            });

                        declarationPath.replaceWith(
                            types.variableDeclaration('const', [
                                types.variableDeclarator(
                                    types.identifier(path.node.id.name),
                                    fetchExpression.wrapExpression(types.objectExpression(objectProperties)),
                                ),
                            ]),
                        );
                    }
                },
                VariableDeclaration(path) {
                    const declaration = path.node.declarations[0];
                    if (
                        !declaration ||
                        declaration.id.type !== 'ObjectPattern' ||
                        declaration.init?.type !== 'CallExpression' ||
                        declaration.init.callee.type !== 'Identifier' ||
                        declaration.init.callee.name !== 'useContext'
                    )
                        return;

                    const names = declaration.id.properties
                        .filter(
                            (property): property is types.ObjectProperty =>
                                property.type === 'ObjectProperty' && property.key.type === 'Identifier',
                        )
                        .map((property) => property.key.name);

                    if (!names.length) return;

                    for (const name of names) {
                        setupContextNames.add(name);
                        extraRenderProperties.push({ key: name, local: name });
                    }

                    path.remove();
                },
            });

            for (const { key, local } of extraRenderProperties) addObjectPatternProperty(renderParam, key, local);

            for (const name of [...importedServices].sort((a, b) => a.localeCompare(b)))
                addObjectPatternProperty(renderParam, name);

            if (routeCallPath) {
                const args = routeCallPath.node.arguments;
                const pathArg = args[0];
                const lastArg = args[args.length - 1];
                const maybeSetupArg =
                    args.length >= 3 &&
                    (args[1].type === 'ArrowFunctionExpression' || args[1].type === 'FunctionExpression')
                        ? args[1]
                        : null;
                const maybeOptionsArg = args.length >= 3 && args[1].type === 'ObjectExpression' ? args[1] : null;

                if (setupNeeded || maybeOptionsArg || maybeSetupArg) {
                    const setupProperties: (types.ObjectProperty | types.SpreadElement)[] = [];
                    const setupParamProperties: types.ObjectProperty[] = [];
                    const existingSetupDataKeys = new Set<string>();

                    if (maybeSetupArg) {
                        const existingReturnedObject = getReturnedObjectExpression(maybeSetupArg);
                        if (existingReturnedObject) {
                            for (const property of existingReturnedObject.properties) {
                                if (property.type !== 'ObjectProperty') continue;

                                const propertyKey = getObjectPropertyKeyName(property);
                                if (!propertyKey || propertyKey.startsWith('_')) continue;

                                existingSetupDataKeys.add(propertyKey);
                            }
                        }
                    }

                    const fetcherKeys = new Set(
                        fetcherProperties
                            .map((property) => getObjectPropertyKeyName(property))
                            .filter((key): key is string => Boolean(key)),
                    );

                    for (const property of renderParam.properties) {
                        if (property.type !== 'ObjectProperty') continue;

                        const propertyKey = getObjectPropertyKeyName(property);
                        if (propertyKey && fetcherKeys.has(propertyKey)) continue;

                        if (propertyKey && existingSetupDataKeys.has(propertyKey)) continue;

                        pushUniqueObjectPatternProperty(setupParamProperties, types.cloneNode(property, true));
                    }

                    if (maybeOptionsArg) setupProperties.push(...prefixOptionsObject(maybeOptionsArg).properties);

                    if (maybeSetupArg) {
                        const existingSetupParam = findObjectPatternParam(maybeSetupArg);
                        if (existingSetupParam) {
                            for (const property of existingSetupParam.properties) {
                                if (property.type !== 'ObjectProperty') continue;

                                const propertyKey = getObjectPropertyKeyName(property);
                                if (propertyKey && existingSetupDataKeys.has(propertyKey)) continue;

                                if (property.type === 'ObjectProperty')
                                    pushUniqueObjectPatternProperty(
                                        setupParamProperties,
                                        types.cloneNode(property, true),
                                    );
                            }
                        }

                        const returnedObject = getReturnedObjectExpression(maybeSetupArg);
                        if (returnedObject) {
                            for (const property of returnedObject.properties) {
                                if (property.type === 'ObjectProperty')
                                    pushUniqueObjectProperty(setupProperties, property);
                                else setupProperties.push(property);
                            }
                        }
                    }

                    for (const property of fetcherProperties) pushUniqueObjectProperty(setupProperties, property);

                    const setupParam = types.objectPattern(setupParamProperties);
                    for (const name of [...new Set([...importedServices, ...setupContextNames])].sort((a, b) =>
                        a.localeCompare(b),
                    ))
                        addObjectPatternProperty(setupParam, name);

                    const setupFunction = types.arrowFunctionExpression(
                        [setupParam],
                        types.objectExpression(setupProperties),
                    );

                    routeCallPath.node.arguments = [pathArg, setupFunction, lastArg];
                    changed = true;
                } else {
                    routeCallPath.node.arguments = [pathArg, lastArg];
                }
            }
        }

        traverse(ast, {
            noScope: true,
            Program(programPath) {
                removeUnusedUseContextImport(programPath);
            },
        });

        if (!changed) continue;

        fs.writeFileSync(filepath, generate(ast, {}, code).code);
        changedFiles++;
    }

    console.log(`[refactor-client-pages] ${repoRoot}: changed ${changedFiles} files`);
}
