/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs-extra';
import path from 'path';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as types from '@babel/types';

/*----------------------------------
- TYPES
----------------------------------*/

type TRouteMethod = { methodName: string; routePath: string; schemaSource?: string; schemaImports: string[] };

type TServiceRoot = { alias: string; id: string; dir: string };

type TImportBinding = { source: '@app' | '@models' | '@request'; imported: string };

/*----------------------------------
- HELPERS
----------------------------------*/

const lowerFirst = (value: string) => (value.length ? value[0].toLowerCase() + value.substring(1) : value);

const findFiles = (dir: string, predicate: (filepath: string) => boolean): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findFiles(filepath, predicate));
            continue;
        }

        if (dirent.isFile() && predicate(filepath)) files.push(filepath);
    }

    return files;
};

const findNearestServiceRoot = (serviceRoots: TServiceRoot[], filepath: string) => {
    const normalizedFilepath = filepath.replace(/\\/g, '/');

    return serviceRoots
        .filter((serviceRoot) => normalizedFilepath.startsWith(serviceRoot.dir.replace(/\\/g, '/') + '/'))
        .sort((a, b) => b.dir.length - a.dir.length)[0];
};

const getRelativeServiceSegments = (serviceRootDir: string, filepath: string) => {
    const relativePath = path.relative(serviceRootDir, filepath).replace(/\\/g, '/');
    const segments = relativePath.split('/');
    const filename = segments.pop() as string;
    const basename = filename.replace(/\.(tsx?|jsx?)$/, '');

    if (basename !== 'index') segments.push(basename);

    return segments.filter(Boolean);
};

const getControllerSegments = (relativePath: string) => {
    const segments = relativePath
        .replace(/\.controller\.ts$/, '')
        .split('/')
        .filter(Boolean);

    if (segments.length > 1 && segments[segments.length - 1] === segments[segments.length - 2]) {
        segments.pop();
    }

    return segments;
};

const getControllerBasePath = (serviceRoot: TServiceRoot, controllerFilepath: string) => {
    const segments = getControllerSegments(path.relative(serviceRoot.dir, controllerFilepath).replace(/\\/g, '/'));

    if (segments[0]?.toLowerCase() === serviceRoot.alias.toLowerCase()) {
        segments.shift();
    }

    return [serviceRoot.alias, ...segments].filter(Boolean).join('/');
};

const findServiceAliases = (repoRoot: string) => {
    const serviceAliasById = new Map<string, string>();
    const configFiles = findFiles(path.join(repoRoot, 'server', 'config'), (filepath) => filepath.endsWith('.ts'));

    for (const configFile of configFiles) {
        const content = fs.readFileSync(configFile, 'utf8');
        const regex = /app\.setup\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;

        for (let match = regex.exec(content); match; match = regex.exec(content))
            serviceAliasById.set(match[2], match[1]);
    }

    return serviceAliasById;
};

const findServiceRoots = (repoRoot: string) => {
    const aliasById = findServiceAliases(repoRoot);
    const serviceJsonFiles = findFiles(
        path.join(repoRoot, 'server', 'services'),
        (filepath) => path.basename(filepath) === 'service.json',
    );

    return serviceJsonFiles
        .map<TServiceRoot | null>((serviceJsonFile) => {
            const metas = fs.readJsonSync(serviceJsonFile) as { id?: string };
            if (!metas.id) return null;

            const alias = aliasById.get(metas.id);
            if (!alias) return null;

            return { alias, id: metas.id, dir: path.dirname(serviceJsonFile) };
        })
        .filter((serviceRoot): serviceRoot is TServiceRoot => !!serviceRoot);
};

const getRouteDecoratorMeta = (decorator: types.Decorator) => {
    if (decorator.expression.type !== 'CallExpression') return null;

    const callee = decorator.expression.callee;
    if (callee.type !== 'Identifier' || callee.name !== 'Route') return null;

    const [firstArg, secondArg] = decorator.expression.arguments;
    let routePath: string | undefined;
    let schemaExpression: types.Expression | undefined;

    if (!firstArg) return null;

    if (types.isStringLiteral(firstArg)) {
        routePath = firstArg.value;
        if (secondArg && types.isExpression(secondArg)) schemaExpression = secondArg;
    } else if (types.isObjectExpression(firstArg)) {
        for (const property of firstArg.properties) {
            if (property.type !== 'ObjectProperty' || property.key.type !== 'Identifier') continue;

            if (property.key.name === 'path' && property.value.type === 'StringLiteral')
                routePath = property.value.value;
            else if (property.key.name === 'schema' && types.isExpression(property.value))
                schemaExpression = property.value;
        }
    }

    if (!routePath) return null;

    return { routePath, schemaExpression };
};

const ensureNamedExport = (programPath: NodePath<types.Program>, identifierName: string) => {
    let alreadyExported = false;

    for (const statement of programPath.node.body) {
        if (
            statement.type === 'ExportNamedDeclaration' &&
            statement.specifiers.some(
                (specifier) =>
                    specifier.type === 'ExportSpecifier' &&
                    specifier.exported.type === 'Identifier' &&
                    specifier.exported.name === identifierName,
            )
        ) {
            alreadyExported = true;
            break;
        }
    }

    if (alreadyExported) return;

    const binding = programPath.scope.getBinding(identifierName);
    if (!binding) return;

    const declarationPath = binding.path.parentPath;
    if (!declarationPath) return;

    if (declarationPath.isExportNamedDeclaration()) return;

    if (
        declarationPath.isVariableDeclaration() ||
        declarationPath.isFunctionDeclaration() ||
        declarationPath.isClassDeclaration()
    ) {
        declarationPath.replaceWith(types.exportNamedDeclaration(declarationPath.node, []));
        return;
    }

    programPath.pushContainer(
        'body',
        types.exportNamedDeclaration(undefined, [
            types.exportSpecifier(types.identifier(identifierName), types.identifier(identifierName)),
        ]),
    );
};

const buildMemberExpression = (...segments: string[]) => {
    let expression: types.Expression = segments[0] === 'this' ? types.thisExpression() : types.identifier(segments[0]);

    for (const segment of segments.slice(1)) expression = types.memberExpression(expression, types.identifier(segment));

    return expression;
};

const replaceReferencedIdentifier = (identifierPath: NodePath<types.Identifier>, binding: TImportBinding) => {
    if (!identifierPath.isReferencedIdentifier()) return;

    if (binding.source === '@app') {
        identifierPath.replaceWith(
            types.memberExpression(
                types.memberExpression(types.thisExpression(), types.identifier('services')),
                types.identifier(binding.imported),
            ),
        );
        return;
    }

    if (binding.source === '@models') {
        identifierPath.replaceWith(
            types.memberExpression(
                types.memberExpression(types.thisExpression(), types.identifier('models')),
                types.identifier(lowerFirst(binding.imported)),
            ),
        );
        return;
    }

    const requestPathByImport: Record<string, string[]> = {
        auth: ['this', 'request', 'auth'],
        request: ['this', 'request', 'request'],
        response: ['this', 'request', 'response'],
        user: ['this', 'request', 'user'],
        context: ['this', 'request', 'context'],
    };

    const memberSegments = requestPathByImport[binding.imported];
    if (!memberSegments) return;

    identifierPath.replaceWith(buildMemberExpression(...memberSegments));
};

const getControllerClassName = (serviceClassName: string, filepath: string) => {
    const rawBasename = path.basename(filepath, path.extname(filepath));
    const baseName =
        serviceClassName || (rawBasename === 'index' ? path.basename(path.dirname(filepath)) : rawBasename);
    return baseName.endsWith('Controller') ? baseName : `${baseName}Controller`;
};

/*----------------------------------
- TRANSFORM
----------------------------------*/

const migrateServiceFile = (filepath: string, serviceRoots: TServiceRoot[]) => {
    const code = fs.readFileSync(filepath, 'utf8');
    if (!/@Route\(|from ['"]@app['"]|from ['"]@models['"]|from ['"]@request['"]/.test(code)) return false;

    const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });

    const importBindings = new Map<string, TImportBinding>();
    const schemaExports = new Set<string>();
    const routeMethods: TRouteMethod[] = [];
    let fileChanged = false;

    const serviceRoot = findNearestServiceRoot(serviceRoots, filepath);

    let serviceClassName = '';

    traverse(ast, {
        ImportDeclaration(path) {
            const source = path.node.source.value;

            if (source === '@server/app/service') {
                const beforeLength = path.node.specifiers.length;
                path.node.specifiers = path.node.specifiers.filter(
                    (specifier) =>
                        !(
                            specifier.type === 'ImportSpecifier' &&
                            specifier.imported.type === 'Identifier' &&
                            specifier.imported.name === 'Route'
                        ),
                );

                if (path.node.specifiers.length !== beforeLength) fileChanged = true;

                if (!path.node.specifiers.length) path.remove();

                return;
            }

            if (source !== '@app' && source !== '@models' && source !== '@request') return;

            for (const specifier of path.node.specifiers) {
                if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') continue;

                importBindings.set(specifier.local.name, {
                    source: source as TImportBinding['source'],
                    imported: specifier.imported.name,
                });
            }

            path.remove();
            fileChanged = true;
        },

        ExportDefaultDeclaration(path) {
            const declaration = path.node.declaration;

            if (declaration.type === 'ClassDeclaration' && declaration.id?.name) serviceClassName = declaration.id.name;
        },

        ClassMethod(path) {
            if (path.node.key.type !== 'Identifier' || !path.node.decorators?.length) return;

            const nextDecorators: types.Decorator[] = [];

            for (const decorator of path.node.decorators) {
                const routeMeta = getRouteDecoratorMeta(decorator);
                if (!routeMeta) {
                    nextDecorators.push(decorator);
                    continue;
                }

                const schemaImports: string[] = [];
                const methodName = path.node.key.name;
                const schemaExpression = routeMeta.schemaExpression;
                const schemaSource = schemaExpression ? generate(schemaExpression).code : undefined;

                if (schemaExpression?.type === 'Identifier') {
                    schemaExports.add(schemaExpression.name);
                    schemaImports.push(schemaExpression.name);
                }

                routeMethods.push({ methodName, routePath: routeMeta.routePath, schemaSource, schemaImports });

                fileChanged = true;
            }

            path.node.decorators = nextDecorators.length ? nextDecorators : undefined;

            path.traverse({
                Identifier(identifierPath) {
                    const binding = importBindings.get(identifierPath.node.name);
                    if (!binding) return;

                    if (identifierPath.scope.getBinding(identifierPath.node.name)?.path.isImportSpecifier() !== true)
                        return;

                    replaceReferencedIdentifier(identifierPath, binding);
                    fileChanged = true;
                },
            });
        },
    });

    if (!fileChanged) return false;

    traverse(ast, {
        Program(programPath) {
            for (const schemaExport of schemaExports) ensureNamedExport(programPath, schemaExport);
        },
    });

    fs.writeFileSync(filepath, generate(ast, { decoratorsBeforeExport: true }, code).code);

    if (!routeMethods.length) return true;

    if (!serviceRoot) throw new Error(`Unable to find the parent service root for ${filepath}`);

    const serviceSegments = getRelativeServiceSegments(serviceRoot.dir, filepath);
    const serviceAccessPath = [serviceRoot.alias, ...serviceSegments].join('.');

    const controllerBasename =
        path.basename(filepath, path.extname(filepath)) === 'index'
            ? `${path.basename(path.dirname(filepath))}.controller.ts`
            : `${path.basename(filepath, path.extname(filepath))}.controller.ts`;
    const controllerFilepath = path.join(path.dirname(filepath), controllerBasename);
    const relativeServiceImportPath = './' + path.basename(filepath, path.extname(filepath));
    const schemaImports = [...new Set(routeMethods.flatMap((routeMethod) => routeMethod.schemaImports))];
    const controllerClassName = getControllerClassName(serviceClassName, filepath);
    const needsSchemaHelperImport = routeMethods.some((routeMethod) => routeMethod.schemaSource?.includes('schema.'));
    const defaultControllerPath = getControllerBasePath(serviceRoot, controllerFilepath);
    const routeBasePaths = new Set<string>();

    for (const routeMethod of routeMethods) {
        const routeSegments = routeMethod.routePath.split('/').filter(Boolean);
        const routeMethodName = routeSegments.pop();

        if (routeMethodName !== routeMethod.methodName) {
            throw new Error(
                `Unable to migrate ${filepath}#${routeMethod.methodName}: route path ${JSON.stringify(routeMethod.routePath)} renames the method. ` +
                    'Rename the method or split the controller manually.',
            );
        }

        routeBasePaths.add(routeSegments.join('/'));
    }

    if (routeBasePaths.size > 1) {
        throw new Error(
            `Unable to migrate ${filepath}: methods use multiple route bases (${[...routeBasePaths].join(', ')}). ` +
                'Split the service into multiple controllers before migration.',
        );
    }

    const controllerPath = [...routeBasePaths][0] || '';
    const controllerPathExport =
        controllerPath && controllerPath !== defaultControllerPath
            ? `export const controllerPath = ${JSON.stringify(controllerPath)};\n\n`
            : '';

    const methodBlocks = routeMethods
        .map((routeMethod) => {
            const inputLine = routeMethod.schemaSource
                ? `        const data = this.input(${routeMethod.schemaSource});\n`
                : '';
            const callArgs = routeMethod.schemaSource ? 'data' : '';

            return `    public async ${routeMethod.methodName}() {
        const { ${serviceRoot.alias} } = this.services;
${inputLine}
        return ${serviceAccessPath}.${routeMethod.methodName}(${callArgs});
    }`;
        })
        .join('\n\n');

    fs.writeFileSync(
        controllerFilepath,
        `import Controller${needsSchemaHelperImport ? ', { schema }' : ''} from '@server/app/controller';
${schemaImports.length ? `import { ${schemaImports.join(', ')} } from ${JSON.stringify(relativeServiceImportPath)};\n` : ''}
${controllerPathExport}
export default class ${controllerClassName} extends Controller {

${methodBlocks}
}
`,
    );

    return true;
};

/*----------------------------------
- RUN
----------------------------------*/

const repoRoots = process.argv.slice(2);
if (!repoRoots.length)
    throw new Error('Usage: ts-node scripts/refactor-server-controllers.ts <repo-root> [repo-root...]');

for (const repoRoot of repoRoots) {
    const serviceRoots = findServiceRoots(repoRoot);
    const serviceFiles = findFiles(
        path.join(repoRoot, 'server', 'services'),
        (filepath) => /\.(tsx?|jsx?)$/.test(filepath) && !filepath.endsWith('.controller.ts'),
    );

    let migratedFiles = 0;

    for (const serviceFile of serviceFiles) {
        if (migrateServiceFile(serviceFile, serviceRoots)) migratedFiles++;
    }

    console.log(`[refactor-server-controllers] ${repoRoot}: migrated ${migratedFiles} service files`);
}
