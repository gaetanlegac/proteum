/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import * as types from '@babel/types'
import type { NodePath, PluginObj } from '@babel/core';
import generate from '@babel/generator';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

// Core
import cli from '@cli';
import { App, TAppSide } from '../../../../app';

/*----------------------------------
- WEBPACK RULE
----------------------------------*/

type TOptions = {
    side: TAppSide,
    app: App,
    debug?: boolean
}

/**
 * Extended source type: now includes "models"
 * so we can differentiate how we rewrite references.
 */
type TImportSource = 'container' | 'services' | 'models' | 'request';

module.exports = (options: TOptions) => (
    [Plugin, options]
)

type TImportedIndex = {
    local: string,
    imported: string,                // The original “imported” name
    references: NodePath<types.Node>[],                   // reference paths
    source: TImportSource            // container | application | models
}

type TRoutesIndex = {
    byFile: Map<string, Set<string>>,
    all: Set<string>,
    initialized: boolean
}

const routesIndexByAppRoot = new Map<string, TRoutesIndex>();

function isRouteDecoratorExpression(expression: types.Expression): boolean {
    return (
        // Handles the case of @Route without parameters
        (types.isIdentifier(expression) && expression.name === 'Route')
        ||
        // Handles the case of @Route() with parameters
        (
            types.isCallExpression(expression)
            &&
            types.isIdentifier(expression.callee)
            &&
            expression.callee.name === 'Route'
        )
    );
}

function getRoutePathFromDecoratorExpression(expression: types.Expression): string | undefined {
    if (
        !types.isCallExpression(expression)
        ||
        !types.isIdentifier(expression.callee)
        ||
        expression.callee.name !== 'Route'
    )
        return;

    const firstArg = expression.arguments[0];
    if (!types.isStringLiteral(firstArg))
        return;

    return firstArg.value;
}

function extractRoutePathsFromCode(code: string, filename: string): Set<string> {
    const routePaths = new Set<string>();

    let ast: ReturnType<typeof parse> | undefined;
    try {
        ast = parse(code, {
            sourceType: 'module',
            sourceFilename: filename,
            plugins: [
                'typescript',
                'decorators-legacy',
                'jsx',
                'classProperties',
                'classPrivateProperties',
                'classPrivateMethods',
                'dynamicImport',
                'importMeta',
                'optionalChaining',
                'nullishCoalescingOperator',
                'topLevelAwait',
            ],
        });
    } catch {
        return routePaths;
    }

    traverse(ast, {
        ClassMethod(path) {
            const { node } = path;
            if (!node.decorators || node.key.type !== 'Identifier')
                return;

            for (const decorator of node.decorators) {
                if (!isRouteDecoratorExpression(decorator.expression))
                    continue;

                const routePath = getRoutePathFromDecoratorExpression(decorator.expression);
                if (routePath)
                    routePaths.add(routePath);
            }
        }
    });

    return routePaths;
}

function listTsFiles(dirPath: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...listTsFiles(fullPath));
            continue;
        }

        const isTs = fullPath.endsWith('.ts') || fullPath.endsWith('.tsx');
        if (!isTs || fullPath.endsWith('.d.ts'))
            continue;

        files.push(fullPath);
    }
    return files;
}

function initializeRoutesIndex(appRoot: string, index: TRoutesIndex) {
    const servicesDir = path.join(appRoot, 'server', 'services');
    const files = listTsFiles(servicesDir);

    for (const file of files) {
        let code: string;
        try {
            code = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }

        const routes = extractRoutePathsFromCode(code, file);
        index.byFile.set(file, routes);
    }

    index.all.clear();
    for (const routes of index.byFile.values()) {
        for (const route of routes)
            index.all.add(route);
    }
    index.initialized = true;
}

function getRoutesIndex(appRoot: string): TRoutesIndex {
    let index = routesIndexByAppRoot.get(appRoot);
    if (!index) {
        index = {
            byFile: new Map(),
            all: new Set(),
            initialized: false
        };
        routesIndexByAppRoot.set(appRoot, index);
    }

    if (!index.initialized) {
        initializeRoutesIndex(appRoot, index);
    }

    return index;
}

function updateRoutesIndexForFile(index: TRoutesIndex, filename: string, routePaths: Set<string>) {
    index.byFile.set(filename, routePaths);

    index.all.clear();
    for (const routes of index.byFile.values()) {
        for (const route of routes)
            index.all.add(route);
    }
}

/*----------------------------------
- PLUGIN
----------------------------------*/
function Plugin(babel, { app, side, debug }: TOptions) {

    const t = babel.types as typeof types;

    /*
        Transforms:
          import { MyService, Environment } from '@app';
          import { MyModel } from '@models';
          ...
          MyService.method();
          Environment.name;
          MyModel.someCall();
  
        To:
          import container from '<path>/server/app/container';
          ...
          container.Environment.name;
          this.app.MyService.method();
          this.app.Models.client.MyModel.someCall();
  
        Processed files:
          @/server/services
    */

    const plugin: PluginObj<{

        debug: boolean,

        filename: string,
        processFile: boolean,

        // Count how many total imports we transform
        importedCount: number,
        routeMethods: string[],
        routePaths: Set<string>,
        routesIndex: TRoutesIndex,
        contextGuardedClassMethods: WeakSet<types.ClassMethod>,

        // For every local identifier, store info about how it should be rewritten
        imported: {
            [localName: string]: TImportedIndex
        }
    }> = {

        pre(state) {
            this.filename = state.opts.filename as string;
            this.processFile = this.filename.startsWith(cli.paths.appRoot + '/server/services');

            this.imported = {};
            
            this.importedCount = 0;
            this.debug = debug || false;

            this.routeMethods = [];
            this.routePaths = new Set();

            this.routesIndex = getRoutesIndex(app.paths.root);
            this.contextGuardedClassMethods = new WeakSet();
        },

        visitor: {

            // Detect decored methods before other plugins remove decorators
            Program(path) {

                if (!this.processFile) return;

                // Traverse the AST within the Program node
                path.traverse({
                    ClassMethod: (subPath) => {
                        const { node } = subPath;
                        if (!node.decorators || node.key.type !== 'Identifier') return;

                        for (const decorator of node.decorators) {

                            const isRoute = isRouteDecoratorExpression(decorator.expression);

                            if (!isRoute) continue;

                            const methodName = node.key.name;
                            this.routeMethods.push( methodName );

                            const routePath = getRoutePathFromDecoratorExpression(decorator.expression);
                            if (routePath)
                                this.routePaths.add(routePath);
                        }
                    }
                });

                updateRoutesIndexForFile(this.routesIndex, this.filename, this.routePaths);
            },

            /**
             * Detect import statements from '@app' or '@models'
             */
            ImportDeclaration(path) {
                if (!this.processFile) return;

                const source = path.node.source.value;
                if (source !== '@app' && source !== '@models' && source !== '@request') {
                    return;
                }

                // For '@app' and '@models', gather imported symbols
                for (const specifier of path.node.specifiers) {
                    if (specifier.type !== 'ImportSpecifier') continue;
                    if (specifier.imported.type !== 'Identifier') continue;

                    this.importedCount++;

                    let importSource: TImportSource;
                    switch (source) {
                        case '@app':
                            // Distinguish whether it's a container service or an application service
                            if (app.containerServices.includes(specifier.imported.name)) {
                                importSource = 'container';
                            } else {
                                importSource = 'services';
                            }
                            break;
                        case '@request':
                            importSource = 'request';
                            break;
                        case '@models':
                            // source === '@models'
                            importSource = 'models';
                            break;
                        default:
                            throw new Error(`Unknown import source: ${source}`);
                    }

                    this.imported[specifier.local.name] = {
                        local: specifier.local.name,
                        imported: specifier.imported.name,
                        references: path.scope.bindings[specifier.local.name].referencePaths,
                        source: importSource
                    };
                }

                // Remove the original import line(s) and replace with any needed new import
                // For @app imports, we might import "container" if needed
                // For @models, we don’t import anything
                const replaceWith: any[] = [];

                // If this line had container references, add a default import for container
                // Example: import container from '<root>/server/app/container'
                if (source === '@app') {
                    replaceWith.push(
                        t.importDeclaration(
                            [t.importDefaultSpecifier(t.identifier('container'))],
                            t.stringLiteral(
                                cli.paths.core.root + '/server/app/container'
                            )
                        )
                    );
                }

                // Replace the original import statement with our new import(s) if any
                // or remove it entirely if no container references exist.
                path.replaceWithMultiple(replaceWith);
            },

            CallExpression(path) {
                if (!this.processFile)
                    return;

                const classMethodPath = path.findParent(p => p.isClassMethod()) as NodePath<types.ClassMethod> | null;
                if (!classMethodPath)
                    return;

                // Ignore constructors
                if (classMethodPath.node.kind === 'constructor')
                    return;

                const callee = path.node.callee;
                if (!t.isMemberExpression(callee) && !(t as any).isOptionalMemberExpression?.(callee))
                    return;

                // Build member chain segments: this.app.<Service>.<...>
                const segments: string[] = [];
                let current: any = callee;
                while (t.isMemberExpression(current) || (t as any).isOptionalMemberExpression?.(current)) {
                    const prop = current.property;
                    if (t.isIdentifier(prop)) {
                        segments.unshift(prop.name);
                    } else if (t.isStringLiteral(prop)) {
                        segments.unshift(prop.value);
                    } else {
                        return;
                    }
                    current = current.object;
                }

                if (!t.isThisExpression(current))
                    return;

                // Expect: this.app.<Service>.<method>
                if (segments.length < 3 || segments[0] !== 'app')
                    return;

                const serviceLocalName = segments[1];
                const importedRef = this.imported[serviceLocalName];
                if (!importedRef || importedRef.source !== 'services')
                    return;

                const routePath = [
                    importedRef.imported || serviceLocalName,
                    ...segments.slice(2)
                ].join('/');

                if (!this.routesIndex.all.has(routePath))
                    return;

                // Ensure the parent function checks that `context` exists
                if (!this.contextGuardedClassMethods.has(classMethodPath.node)) {
                    const guard = t.ifStatement(
                        t.binaryExpression(
                            '===',
                            t.unaryExpression('typeof', t.identifier('context')),
                            t.stringLiteral('undefined')
                        ),
                        t.blockStatement([
                            t.throwStatement(
                                t.newExpression(t.identifier('Error'), [
                                    t.stringLiteral('context variable should be passed in this function')
                                ])
                            )
                        ])
                    );
                    classMethodPath.get('body').unshiftContainer('body', guard);
                    this.contextGuardedClassMethods.add(classMethodPath.node);
                }

                // Ensure call arguments: second argument is `context`
                const args = path.node.arguments;
                if (args.length === 0) {
                    args.push(t.identifier('undefined'), t.identifier('context'));
                } else if (args.length === 1) {
                    args.push(t.identifier('context'));
                } else {
                    args[1] = t.identifier('context') as any;
                }
            },

            // This visitor fires for every class method.
            ClassMethod(path) {

                // Must be a server service
                if (!this.processFile || path.replaced) return;

                // Must have a method name
                if (path.node.key.type !== 'Identifier') return;

                // Init context
                const methodName = path.node.key.name;
                let params = path.node.params;

                // Prefix references
                path.traverse({ Identifier: (subPath) => {

                    const { node } = subPath;
                    const name = node.name;
                    const ref = this.imported[name];
                    if (!ref || !ref.references) {
                        return;
                    }

                    // Find a specific binding that hasn't been replaced yet
                    const foundBinding = ref.references.find(binding => {
                        return subPath.getPathLocation() === binding.getPathLocation();
                    });

                    if (!foundBinding || foundBinding.replaced)
                        return;

                    // Mark as replaced to avoid loops
                    foundBinding.replaced = true;

                    // Based on the source, replace the identifier with the proper MemberExpression
                    if (ref.source === 'container') {
                        // container.[identifier]
                        // e.g. container.Environment
                        subPath.replaceWith(
                            t.memberExpression(
                                t.identifier('container'),
                                subPath.node
                            )
                        );
                    }
                    else if (ref.source === 'services') {
                        // this.app.[identifier]
                        // e.g. this.app.MyService
                        subPath.replaceWith(
                            t.memberExpression(
                                t.memberExpression(
                                    t.thisExpression(),
                                    t.identifier('app')
                                ),
                                subPath.node
                            )
                        );
                    }
                    else if (ref.source === 'models') {
                        // this.app.Models.client.[identifier]
                        // e.g. this.app.Models.client.MyModel
                        subPath.replaceWith(
                            t.memberExpression(
                                t.memberExpression(
                                    t.memberExpression(
                                        t.memberExpression(
                                            t.thisExpression(),
                                            t.identifier('app')
                                        ),
                                        t.identifier('Models')
                                    ),
                                    t.identifier('client')
                                ),
                                subPath.node
                            )
                        );
                    }
                    else if (ref.source === 'request') {
                        // this.app.Models.client.[identifier]
                        // e.g. this.app.Models.client.MyModel
                        subPath.replaceWith(
                            t.memberExpression(
                                t.identifier('context'),
                                subPath.node
                            )
                        );
                    }

                } });

                if (
                    this.routeMethods.includes(methodName) 
                    && 
                    path.node.params.length < 2
                ) {

                    // Expose router context variable via the second parameter
                    params = [
                        path.node.params[0] || t.objectPattern([]),
                        t.identifier('context'),
                    ];

                    // Apply changes
                    path.replaceWith(
                        t.classMethod(
                            path.node.kind,
                            path.node.key,
                            params,
                            path.node.body,
                            false,
                            false,
                            false,
                            path.node.async
                        )
                    );
                }

                //console.log("ROUTE METHOD", this.filename, methodName, generate(path.node).code);
            }
        }
    };

    return plugin;
}
