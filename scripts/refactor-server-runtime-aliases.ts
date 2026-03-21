import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'child_process';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as types from '@babel/types';

type TRuntimeImportSource = '@app' | '@request' | '@models';

type TRuntimeBinding = { local: string; imported: string; source: TRuntimeImportSource };

type TClassContext = { hasApp: boolean; hasRequest: boolean };

const fallbackBindings = new Map<string, TRuntimeBinding>([
    ['Models', { local: 'Models', imported: 'Models', source: '@app' }],
    ['Disks', { local: 'Disks', imported: 'Disks', source: '@app' }],
    ['Router', { local: 'Router', imported: 'Router', source: '@app' }],
    ['Environment', { local: 'Environment', imported: 'Environment', source: '@app' }],
    ['Identity', { local: 'Identity', imported: 'Identity', source: '@app' }],
    ['auth', { local: 'auth', imported: 'auth', source: '@request' }],
    ['context', { local: 'context', imported: 'context', source: '@request' }],
]);

const parseCode = (code: string, filename: string) =>
    parse(code, {
        sourceType: 'module',
        sourceFilename: filename,
        plugins: [
            'typescript',
            'jsx',
            'decorators-legacy',
            'classProperties',
            'classPrivateProperties',
            'classPrivateMethods',
        ],
    });

const findFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findFiles(filepath));
            continue;
        }

        if (dirent.isFile() && /\.(tsx?|jsx?)$/.test(filepath) && !filepath.endsWith('.d.ts')) files.push(filepath);
    }

    return files;
};

const lowerFirst = (value: string) => (value.length ? value[0].toLowerCase() + value.substring(1) : value);

const getOriginalFileContent = (repoRoot: string, filepath: string) => {
    const relativeFilepath = path.relative(repoRoot, filepath).replace(/\\/g, '/');

    try {
        return execFileSync('git', ['-C', repoRoot, 'show', `HEAD:${relativeFilepath}`], { encoding: 'utf8' });
    } catch {
        return null;
    }
};

const extractRuntimeBindings = (code: string, filename: string) => {
    const ast = parseCode(code, filename);
    const runtimeBindings = new Map<string, TRuntimeBinding>();

    traverse(ast, {
        ImportDeclaration(importPath) {
            const source = importPath.node.source.value;
            if (source !== '@app' && source !== '@request' && source !== '@models') return;

            for (const specifier of importPath.node.specifiers) {
                if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') continue;

                runtimeBindings.set(specifier.local.name, {
                    local: specifier.local.name,
                    imported: specifier.imported.name,
                    source,
                });
            }
        },
    });

    return runtimeBindings;
};

const getClassContext = (path: NodePath) => {
    const classPath = path.findParent((parentPath) => parentPath.isClass()) as NodePath<types.Class> | null;
    if (!classPath) return null;

    const classNode = classPath.node;
    let hasApp = false;
    let hasRequest = false;

    if (
        types.isIdentifier(classNode.superClass) &&
        (classNode.superClass.name === 'Service' ||
            classNode.superClass.name === 'Controller' ||
            classNode.superClass.name.endsWith('Service') ||
            classNode.superClass.name.endsWith('Controller'))
    ) {
        hasApp = true;
        hasRequest = true;
    }

    if (classNode.superClass) {
        hasApp = true;
        hasRequest = true;
    }

    for (const member of classNode.body.body) {
        if (
            (types.isClassProperty(member) || types.isClassAccessorProperty?.(member)) &&
            types.isIdentifier(member.key)
        ) {
            if (member.key.name === 'app') hasApp = true;
            if (member.key.name === 'request') hasRequest = true;
        }

        if (types.isClassMethod(member) && types.isIdentifier(member.key)) {
            if (member.kind === 'get' && member.key.name === 'request') hasRequest = true;

            if (member.kind === 'constructor') {
                for (const param of member.params) {
                    if (types.isTSParameterProperty(param)) {
                        const parameter = param.parameter;
                        const identifier = types.isIdentifier(parameter)
                            ? parameter
                            : types.isAssignmentPattern(parameter) && types.isIdentifier(parameter.left)
                              ? parameter.left
                              : null;

                        if (!identifier) continue;

                        if (identifier.name === 'app') hasApp = true;
                        if (identifier.name === 'request') hasRequest = true;
                    } else if (types.isIdentifier(param)) {
                        if (param.name === 'app') hasApp = true;
                        if (param.name === 'request') hasRequest = true;
                    }
                }
            }
        }
    }

    traverse(classPath.node, {
        noScope: true,
        MemberExpression(memberPath) {
            if (!types.isThisExpression(memberPath.node.object)) return;
            if (!types.isIdentifier(memberPath.node.property)) return;

            if (memberPath.node.property.name === 'app') hasApp = true;
            if (memberPath.node.property.name === 'request') hasRequest = true;
        },
    });

    if (!hasApp && !hasRequest) return null;

    return { hasApp, hasRequest } satisfies TClassContext;
};

const isInTypePosition = (path: NodePath<types.Identifier>) => {
    let current: NodePath | null = path;

    while (current?.parentPath) {
        const parent = current.parentPath;

        if (
            (parent.isTSAsExpression() ||
                parent.isTSSatisfiesExpression() ||
                parent.isTSNonNullExpression() ||
                parent.isTSInstantiationExpression()) &&
            current.key === 'expression'
        ) {
            current = parent;
            continue;
        }

        if (parent.node.type.startsWith('TS')) return true;

        if (
            parent.isExpression() ||
            parent.isStatement() ||
            parent.isProgram() ||
            parent.isClassBody() ||
            parent.isClassMethod() ||
            parent.isClassProperty() ||
            parent.isObjectProperty()
        )
            return false;

        current = parent;
    }

    return false;
};

const isSafeImportBinding = (bindingPath: NodePath) => {
    if (
        !bindingPath.isImportSpecifier() &&
        !bindingPath.isImportNamespaceSpecifier() &&
        !bindingPath.isImportDefaultSpecifier()
    )
        return false;

    const importDeclaration = bindingPath.parentPath;
    if (!importDeclaration?.isImportDeclaration()) return false;

    if (importDeclaration.node.importKind === 'type') return true;
    if (importDeclaration.node.source.value === '@models/types') return true;

    return false;
};

const buildReplacementExpression = (binding: TRuntimeBinding, classContext: TClassContext | null) => {
    if (!classContext) return null;

    if (binding.source === '@request') {
        if (!classContext.hasRequest) return null;

        if (binding.imported === 'context')
            return types.memberExpression(types.thisExpression(), types.identifier('request'));

        return types.memberExpression(
            types.memberExpression(types.thisExpression(), types.identifier('request')),
            types.identifier(binding.imported),
        );
    }

    if (!classContext.hasApp) return null;

    if (binding.source === '@app') {
        if (binding.imported === 'Environment')
            return types.memberExpression(
                types.memberExpression(types.thisExpression(), types.identifier('app')),
                types.identifier('env'),
            );

        if (binding.imported === 'Identity')
            return types.memberExpression(
                types.memberExpression(types.thisExpression(), types.identifier('app')),
                types.identifier('identity'),
            );

        return types.memberExpression(
            types.memberExpression(types.thisExpression(), types.identifier('app')),
            types.identifier(binding.imported),
        );
    }

    return types.memberExpression(
        types.memberExpression(
            types.memberExpression(
                types.memberExpression(types.thisExpression(), types.identifier('app')),
                types.identifier('Models'),
            ),
            types.identifier('client'),
        ),
        types.identifier(lowerFirst(binding.imported)),
    );
};

const repoRoots = process.argv.slice(2);
if (!repoRoots.length)
    throw new Error('Usage: ts-node scripts/refactor-server-runtime-aliases.ts <repo-root> [repo-root...]');

for (const repoRoot of repoRoots) {
    const serviceRoot = path.join(repoRoot, 'server', 'services');
    const files = findFiles(serviceRoot).filter((filepath) => !filepath.endsWith('.controller.ts'));

    let changedFiles = 0;
    let replacementCount = 0;
    const skipped: string[] = [];

    for (const filepath of files) {
        const originalCode = getOriginalFileContent(repoRoot, filepath);
        if (!originalCode) continue;

        const runtimeBindings = extractRuntimeBindings(originalCode, filepath);
        if (!runtimeBindings.size) continue;

        const code = fs.readFileSync(filepath, 'utf8');
        const ast = parseCode(code, filepath);
        let fileChanged = false;

        traverse(ast, {
            MemberExpression(memberPath) {
                if (!types.isMemberExpression(memberPath.node.object)) return;
                if (!types.isThisExpression(memberPath.node.object.object)) return;
                if (!types.isIdentifier(memberPath.node.object.property, { name: 'app' })) return;
                if (!types.isIdentifier(memberPath.node.property)) return;

                if (memberPath.node.property.name === 'Environment') {
                    memberPath.node.property = types.identifier('env');
                    fileChanged = true;
                }

                if (memberPath.node.property.name === 'Identity') {
                    memberPath.node.property = types.identifier('identity');
                    fileChanged = true;
                }
            },
            Identifier(identifierPath) {
                const binding =
                    runtimeBindings.get(identifierPath.node.name) || fallbackBindings.get(identifierPath.node.name);
                if (!binding) return;
                if (!identifierPath.isReferencedIdentifier()) return;
                if (isInTypePosition(identifierPath)) return;

                const currentBinding = identifierPath.scope.getBinding(identifierPath.node.name);
                if (currentBinding && !isSafeImportBinding(currentBinding.path)) return;

                const classContext = getClassContext(identifierPath);
                const replacement = buildReplacementExpression(binding, classContext);
                if (!replacement) {
                    const location = identifierPath.node.loc?.start;
                    skipped.push(
                        `${path.relative(repoRoot, filepath)}:${location?.line ?? 0}:${identifierPath.node.name}`,
                    );
                    return;
                }

                if (
                    identifierPath.parentPath?.isObjectProperty() &&
                    identifierPath.parentPath.node.shorthand &&
                    identifierPath.parentKey === 'value'
                ) {
                    identifierPath.parentPath.node.shorthand = false;
                }

                identifierPath.replaceWith(types.cloneNode(replacement, true));
                fileChanged = true;
                replacementCount += 1;
            },
        });

        if (!fileChanged) continue;

        const output = generate(ast, { retainLines: false, decoratorsBeforeExport: true }, code).code;

        fs.writeFileSync(filepath, output + '\n');
        changedFiles += 1;
    }

    console.info(`[runtime-aliases] ${repoRoot}: changed ${changedFiles} files, ${replacementCount} replacements`);

    if (skipped.length) {
        console.info('[runtime-aliases] skipped references:');
        for (const item of skipped.slice(0, 50)) console.info(' -', item);

        if (skipped.length > 50) console.info(` - ... ${skipped.length - 50} more`);
    }
}
