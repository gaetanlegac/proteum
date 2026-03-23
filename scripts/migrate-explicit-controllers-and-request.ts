import fs from 'fs-extra';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

type TControllerRouteMap = Map<string, string>;

const parserPlugins = [
    'typescript',
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
] as const;

const parseModule = (filepath: string, code: string) =>
    parse(code, {
        sourceType: 'module',
        sourceFilename: filepath,
        plugins: [...parserPlugins],
    });

const generateModule = (ast: ReturnType<typeof parse>) =>
    generate(ast, {
        retainLines: false,
        decoratorsBeforeExport: true,
        jsescOption: { minimal: true },
    }).code + '\n';

const ensureRelativeImport = (value: string) =>
    value.startsWith('.') ? value : value.startsWith('/') ? value : './' + value;

const stripTsExtension = (filepath: string) => filepath.replace(/\.(tsx?|jsx?)$/, '');

const resolveImportFile = (fromDir: string, source: string) => {
    const candidates = [
        path.resolve(fromDir, source),
        path.resolve(fromDir, source + '.ts'),
        path.resolve(fromDir, source + '.tsx'),
        path.resolve(fromDir, source + '.js'),
        path.resolve(fromDir, source + '.jsx'),
        path.resolve(fromDir, source, 'index.ts'),
        path.resolve(fromDir, source, 'index.tsx'),
        path.resolve(fromDir, source, 'index.js'),
        path.resolve(fromDir, source, 'index.jsx'),
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
};

const parseControllerRoutes = (repoRoot: string): TControllerRouteMap => {
    const generatedPath = path.join(repoRoot, '.proteum', 'server', 'controllers.ts');
    const code = fs.readFileSync(generatedPath, 'utf8');
    const importRegex = /import\s+(Controller\d+)\s+from\s+"(@\/server\/services\/[^"]+)";/g;
    const routeRegex =
        /\{\s*path:\s*"([^"]+)",\s*Controller:\s*(Controller\d+),\s*method:\s*"([^"]+)"\s*,?\s*\}/g;

    const controllerImportById = new Map<string, string>();
    const routeBaseByImportPath = new Map<string, string>();

    for (const match of code.matchAll(importRegex)) {
        controllerImportById.set(match[1], match[2]);
    }

    for (const match of code.matchAll(routeRegex)) {
        const httpPath = match[1];
        const controllerId = match[2];
        const importPath = controllerImportById.get(controllerId);

        if (!importPath) continue;

        const segments = httpPath.replace(/^\/api\//, '').split('/').filter(Boolean);
        const routeBasePath = segments.slice(0, -1).join('/');

        if (!routeBasePath) continue;
        if (!routeBaseByImportPath.has(importPath)) routeBaseByImportPath.set(importPath, routeBasePath);
    }

    return routeBaseByImportPath;
};

const rewriteRelativeImports = (code: string, fromFilepath: string, toFilepath: string) => {
    const ast = parseModule(fromFilepath, code);

    traverse(ast, {
        ImportDeclaration(importPath) {
            const source = importPath.node.source.value;
            if (typeof source !== 'string' || !source.startsWith('.')) return;

            const resolved = resolveImportFile(path.dirname(fromFilepath), source);
            if (!resolved) return;

            const relative = stripTsExtension(path.relative(path.dirname(toFilepath), resolved)).replace(/\\/g, '/');
            importPath.node.source = t.stringLiteral(ensureRelativeImport(relative));
        },
    });

    return generateModule(ast);
};

const isThisMember = (node: t.Node | null | undefined, propertyName: string): node is t.MemberExpression =>
    !!node &&
    t.isMemberExpression(node) &&
    t.isThisExpression(node.object) &&
    !node.computed &&
    t.isIdentifier(node.property, { name: propertyName });

const getMemberRoot = (node: t.Expression | t.PrivateName): t.Expression | t.PrivateName => {
    let current: t.Expression | t.PrivateName = node;

    while (t.isMemberExpression(current) || t.isOptionalMemberExpression(current)) {
        current = current.object;
    }

    return current;
};

const collectPatternNames = (pattern: t.LVal, names: Set<string>) => {
    if (t.isIdentifier(pattern)) {
        names.add(pattern.name);
        return;
    }

    if (t.isObjectPattern(pattern)) {
        for (const property of pattern.properties) {
            if (t.isRestElement(property)) {
                collectPatternNames(property.argument, names);
                continue;
            }

            if (t.isObjectProperty(property)) {
                collectPatternNames(property.value as t.LVal, names);
            }
        }
        return;
    }

    if (t.isArrayPattern(pattern)) {
        for (const element of pattern.elements) {
            if (!element) continue;
            if (t.isRestElement(element)) {
                collectPatternNames(element.argument, names);
                continue;
            }
            collectPatternNames(element, names);
        }
    }
};

const isServiceLikeBinding = (init: t.Expression | null | undefined) => {
    if (!init) return false;
    if (isThisMember(init, 'services')) return true;
    if (isThisMember(init, 'app')) return true;

    if (t.isMemberExpression(init) || t.isOptionalMemberExpression(init)) {
        const root = getMemberRoot(init);
        return isThisMember(root, 'services') || isThisMember(root, 'app') || isThisMember(root, 'parent');
    }

    return false;
};

const hasExplicitRequestArgument = (args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>) =>
    args.some(
        (arg) =>
            t.isIdentifier(arg, { name: 'request' }) ||
            (t.isMemberExpression(arg) &&
                isThisMember(arg.object, 'request') &&
                !arg.computed &&
                t.isIdentifier(arg.property)),
    );

const appendRequestArgument = (
    callPath: { node: t.CallExpression | t.OptionalCallExpression },
    requestExpression: t.Expression,
) => {
    if (hasExplicitRequestArgument(callPath.node.arguments)) return;
    callPath.node.arguments.push(requestExpression);
};

const transformControllerFile = (filepath: string) => {
    const code = fs.readFileSync(filepath, 'utf8');
    const ast = parseModule(filepath, code);
    const serviceBindings = new Set<string>();
    let changed = false;

    traverse(ast, {
        VariableDeclarator(variablePath) {
            if (!isServiceLikeBinding(variablePath.node.init as t.Expression | null | undefined)) return;
            collectPatternNames(variablePath.node.id, serviceBindings);
        },
        CallExpression(callPath) {
            const callee = callPath.node.callee;
            if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return;

            const root = getMemberRoot(callee);
            const isDirectServiceCall =
                isThisMember(root, 'services') || isThisMember(root, 'app') || isThisMember(root, 'parent');
            const isBoundServiceCall = t.isIdentifier(root) && serviceBindings.has(root.name);

            if (!isDirectServiceCall && !isBoundServiceCall) return;

            appendRequestArgument(callPath as { node: t.CallExpression }, t.memberExpression(t.thisExpression(), t.identifier('request')));
            changed = true;
        },
        OptionalCallExpression(callPath) {
            const callee = callPath.node.callee;
            if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return;

            const root = getMemberRoot(callee);
            const isDirectServiceCall =
                isThisMember(root, 'services') || isThisMember(root, 'app') || isThisMember(root, 'parent');
            const isBoundServiceCall = t.isIdentifier(root) && serviceBindings.has(root.name);

            if (!isDirectServiceCall && !isBoundServiceCall) return;

            appendRequestArgument(
                callPath as { node: t.OptionalCallExpression },
                t.memberExpression(t.thisExpression(), t.identifier('request')),
            );
            changed = true;
        },
    });

    if (!changed) return;
    fs.writeFileSync(filepath, generateModule(ast));
};

const ensureTypeImport = (ast: ReturnType<typeof parse>) => {
    let hasTypeImport = false;
    let serviceImport: t.ImportDeclaration | null = null;

    for (const statement of ast.program.body) {
        if (!t.isImportDeclaration(statement)) continue;
        if (statement.source.value !== '@server/app/service') continue;

        serviceImport = statement;
        for (const specifier of statement.specifiers) {
            if (
                t.isImportSpecifier(specifier) &&
                t.isIdentifier(specifier.imported, { name: 'TServiceRequestContext' })
            ) {
                hasTypeImport = true;
            }
        }
    }

    if (hasTypeImport) return;

    if (serviceImport) {
        serviceImport.specifiers.push(
            t.importSpecifier(t.identifier('TServiceRequestContext'), t.identifier('TServiceRequestContext')),
        );
        return;
    }

    const importDeclaration = t.importDeclaration(
        [t.importSpecifier(t.identifier('TServiceRequestContext'), t.identifier('TServiceRequestContext'))],
        t.stringLiteral('@server/app/service'),
    );
    importDeclaration.importKind = 'type';
    ast.program.body.unshift(importDeclaration);
};

const usesAmbientRequest = (methodPath: any) => {
    let found = false;

    methodPath.traverse({
        MemberExpression(memberPath: any) {
            if (isThisMember(memberPath.node, 'request')) {
                found = true;
                memberPath.stop();
            }
        },
        OptionalMemberExpression(memberPath: any) {
            if (isThisMember(memberPath.node, 'request')) {
                found = true;
                memberPath.stop();
            }
        },
    });

    return found;
};

const transformServiceFile = (filepath: string) => {
    const code = fs.readFileSync(filepath, 'utf8');
    const ast = parseModule(filepath, code);
    let changed = false;

    traverse(ast, {
        ClassMethod(methodPath) {
            if (!methodPath.node.body) return;
            if (!usesAmbientRequest(methodPath)) return;

            const hasRequestParam = methodPath.node.params.some(
                (param) => t.isIdentifier(param) && param.name === 'request',
            );
            if (!hasRequestParam) {
                const requestParam = t.identifier('request');
                requestParam.typeAnnotation = t.tsTypeAnnotation(t.tsTypeReference(t.identifier('TServiceRequestContext')));
                methodPath.node.params.push(requestParam);
            }

            methodPath.traverse({
                MemberExpression(memberPath) {
                    if (!isThisMember(memberPath.node, 'request')) return;
                    memberPath.replaceWith(t.identifier('request'));
                },
                OptionalMemberExpression(memberPath) {
                    if (!isThisMember(memberPath.node, 'request')) return;
                    memberPath.replaceWith(t.identifier('request'));
                },
                CallExpression(callPath) {
                    const callee = callPath.node.callee;
                    if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return;

                    const root = getMemberRoot(callee);
                    if (!isThisMember(root, 'app') && !isThisMember(root, 'services') && !isThisMember(root, 'parent')) {
                        return;
                    }

                    appendRequestArgument(callPath as { node: t.CallExpression }, t.identifier('request'));
                },
                OptionalCallExpression(callPath) {
                    const callee = callPath.node.callee;
                    if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return;

                    const root = getMemberRoot(callee);
                    if (!isThisMember(root, 'app') && !isThisMember(root, 'services') && !isThisMember(root, 'parent')) {
                        return;
                    }

                    appendRequestArgument(callPath as { node: t.OptionalCallExpression }, t.identifier('request'));
                },
            });

            changed = true;
        },
    });

    if (!changed) return;

    ensureTypeImport(ast);
    fs.writeFileSync(filepath, generateModule(ast));
};

const findFiles = (dir: string, predicate: (filepath: string) => boolean, results: string[] = []) => {
    if (!fs.existsSync(dir)) return results;

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            findFiles(filepath, predicate, results);
            continue;
        }

        if (dirent.isFile() && predicate(filepath)) {
            results.push(filepath);
        }
    }

    return results;
};

const moveControllers = (repoRoot: string) => {
    const routeMap = parseControllerRoutes(repoRoot);

    for (const [importPath, routeBasePath] of routeMap) {
        const sourceFile = path.join(repoRoot, importPath.replace('@/', '') + '.ts');
        const targetFile = path.join(repoRoot, 'server', 'controllers', ...routeBasePath.split('/')) + '.ts';

        if (!fs.existsSync(sourceFile)) continue;

        const content = fs.readFileSync(sourceFile, 'utf8');
        const rewritten = rewriteRelativeImports(content, sourceFile, targetFile);

        fs.ensureDirSync(path.dirname(targetFile));
        fs.writeFileSync(targetFile, rewritten);
        fs.removeSync(sourceFile);
        transformControllerFile(targetFile);
    }
};

const migrateServiceRequestUsage = (repoRoot: string) => {
    const serviceFiles = findFiles(
        path.join(repoRoot, 'server', 'services'),
        (filepath) =>
            /\.(ts|tsx)$/.test(filepath) &&
            !filepath.endsWith('.controller.ts') &&
            !filepath.includes(`${path.sep}router${path.sep}request.ts`),
    );

    for (const filepath of serviceFiles) {
        const content = fs.readFileSync(filepath, 'utf8');
        if (!content.includes('this.request')) continue;
        if (content.includes('extends RequestService')) continue;

        transformServiceFile(filepath);
    }
};

const migrateRepo = (repoRoot: string) => {
    moveControllers(repoRoot);
    migrateServiceRequestUsage(repoRoot);
};

const repoRoots = process.argv.slice(2);

if (!repoRoots.length) {
    throw new Error('Usage: ts-node scripts/migrate-explicit-controllers-and-request.ts <repo-root> [repo-root...]');
}

for (const repoRoot of repoRoots) {
    migrateRepo(path.resolve(repoRoot));
}
