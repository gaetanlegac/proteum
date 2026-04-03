import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import type { TDoctorResponse } from './diagnostics';
import type {
    TProteumManifest,
    TProteumManifestDiagnostic,
    TProteumManifestSourceLocation,
} from './proteumManifest';

const normalizeFilepath = (value: string) => value.replace(/\\/g, '/');

const buildGeneratedArtifactList = (manifest: TProteumManifest) => {
    const appRoot = manifest.app.root;
    const clientRouteModulesRoot = path.join(appRoot, '.proteum', 'client', 'route-modules');
    const serverRouteModulesRoot = path.join(appRoot, '.proteum', 'server', 'route-modules');
    const generated = new Set<string>([
        path.join(appRoot, 'proteum.connected.json'),
        path.join(appRoot, '.proteum', 'manifest.json'),
        path.join(appRoot, '.proteum', 'proteum.connected.d.ts'),
        path.join(appRoot, '.proteum', 'client', 'context.ts'),
        path.join(appRoot, '.proteum', 'client', 'controllers.ts'),
        path.join(appRoot, '.proteum', 'client', 'layouts.ts'),
        path.join(appRoot, '.proteum', 'client', 'models.ts'),
        path.join(appRoot, '.proteum', 'client', 'routes.ts'),
        path.join(appRoot, '.proteum', 'client', 'services.d.ts'),
        path.join(appRoot, '.proteum', 'common', 'controllers.ts'),
        path.join(appRoot, '.proteum', 'common', 'models.ts'),
        path.join(appRoot, '.proteum', 'common', 'services.d.ts'),
        path.join(appRoot, '.proteum', 'server', 'commands.app.d.ts'),
        path.join(appRoot, '.proteum', 'server', 'commands.d.ts'),
        path.join(appRoot, '.proteum', 'server', 'commands.ts'),
        path.join(appRoot, '.proteum', 'server', 'controllers.ts'),
        path.join(appRoot, '.proteum', 'server', 'models.ts'),
        path.join(appRoot, '.proteum', 'server', 'routes.ts'),
        path.join(appRoot, '.proteum', 'server', 'services.d.ts'),
    ]);

    for (const route of manifest.routes.client) {
        const sourceExtension = path.extname(route.filepath);
        const chunkFilepath = route.chunkFilepath
            ? `${route.chunkFilepath}${sourceExtension && route.chunkFilepath.endsWith(sourceExtension) ? '' : sourceExtension}`
            : undefined;

        if (chunkFilepath) generated.add(path.join(clientRouteModulesRoot, chunkFilepath));

        const relativeSource = path.relative(appRoot, route.filepath);
        generated.add(path.join(serverRouteModulesRoot, relativeSource));
    }

    for (const route of manifest.routes.server) {
        const relativeSource = path.relative(appRoot, route.filepath);
        generated.add(path.join(serverRouteModulesRoot, relativeSource));
    }

    return [...generated];
};

const createContractDiagnostic = ({
    code,
    filepath,
    level = 'error',
    message,
    sourceLocation,
    fixHint,
    relatedFilepaths,
}: {
    code: string;
    filepath: string;
    level?: TProteumManifestDiagnostic['level'];
    message: string;
    sourceLocation?: TProteumManifestSourceLocation;
    fixHint?: string;
    relatedFilepaths?: string[];
}): TProteumManifestDiagnostic => ({
    code,
    filepath,
    level,
    message,
    ...(sourceLocation ? { sourceLocation } : {}),
    ...(fixHint ? { fixHint } : {}),
    ...(relatedFilepaths && relatedFilepaths.length > 0 ? { relatedFilepaths } : {}),
});

const parseSourceFile = (filepath: string, code: string) =>
    ts.createSourceFile(
        filepath,
        code,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

const getNodeLocation = (sourceFile: ts.SourceFile, node: ts.Node): TProteumManifestSourceLocation => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: line + 1, column: character + 1 };
};

const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node);

const unwrapExpression = (node: ts.Node): ts.Node => {
    let current = node;
    while (
        ts.isAsExpression(current.parent) ||
        ts.isTypeAssertionExpression(current.parent) ||
        ts.isParenthesizedExpression(current.parent)
    ) {
        current = current.parent;
    }

    return current;
};

const getFunctionContainer = (node: ts.Node) => {
    let current = node.parent;

    while (current) {
        if (isFunctionLike(current)) return current;
        current = current.parent;
    }

    return undefined;
};

const getFunctionName = (node: ts.FunctionLikeDeclaration) => {
    if ('name' in node && node.name && ts.isIdentifier(node.name)) return node.name.text;

    if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
    if (node.parent && ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;

    return undefined;
};

const isRouterRenderCallback = (node: ts.FunctionLikeDeclaration) => {
    const unwrappedNode = unwrapExpression(node);
    const parent = unwrappedNode.parent;
    if (!ts.isCallExpression(parent)) return false;
    if (!ts.isPropertyAccessExpression(parent.expression)) return false;
    if (!ts.isIdentifier(parent.expression.expression) || parent.expression.expression.text !== 'Router') return false;

    const methodName = parent.expression.name.text;
    if (methodName !== 'page' && methodName !== 'error') return false;

    const functionArguments = parent.arguments.filter((argument) => isFunctionLike(unwrapExpression(argument)));
    const lastFunctionArgument = functionArguments[functionArguments.length - 1];

    return lastFunctionArgument === unwrappedNode;
};

const isValidHookContainer = (node: ts.FunctionLikeDeclaration) => {
    if (isRouterRenderCallback(node)) return true;

    const functionName = getFunctionName(node);
    if (!functionName) return false;
    if (functionName.startsWith('use')) return true;

    const firstCharacter = functionName[0];
    return firstCharacter === firstCharacter.toUpperCase();
};

const resolveClientRelatedFilepath = ({
    appRoot,
    filepath,
    moduleSpecifier,
}: {
    appRoot: string;
    filepath: string;
    moduleSpecifier: string;
}) => {
    if (moduleSpecifier === '@/client/context' || moduleSpecifier === '@generated/client/context') {
        return path.join(appRoot, '.proteum', 'client', 'context.ts');
    }

    if (moduleSpecifier.startsWith('@/client/')) {
        return path.join(appRoot, moduleSpecifier.slice(2));
    }

    if (moduleSpecifier.startsWith('@generated/client/')) {
        return path.join(appRoot, '.proteum', 'client', moduleSpecifier.slice('@generated/client/'.length));
    }

    if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
        return path.resolve(path.dirname(filepath), moduleSpecifier);
    }

    return undefined;
};

const isSsrRuntimeFile = (manifest: TProteumManifest, filepath: string) => {
    const relativeFilepath = normalizeFilepath(path.relative(manifest.app.root, filepath));
    return relativeFilepath.startsWith('server/') || relativeFilepath.startsWith('commands/') || relativeFilepath.includes('.ssr.');
};

const addUniqueDiagnostic = (diagnostics: TProteumManifestDiagnostic[], diagnostic: TProteumManifestDiagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.filepath}:${diagnostic.sourceLocation?.line || 0}:${diagnostic.sourceLocation?.column || 0}:${diagnostic.message}`;
    if (
        diagnostics.some(
            (existing) =>
                `${existing.code}:${existing.filepath}:${existing.sourceLocation?.line || 0}:${existing.sourceLocation?.column || 0}:${existing.message}` ===
                key,
        )
    ) {
        return;
    }

    diagnostics.push(diagnostic);
};

const buildHookContractDiagnostics = (manifest: TProteumManifest, sourceFilepaths: string[]) => {
    const diagnostics: TProteumManifestDiagnostic[] = [];

    for (const filepath of sourceFilepaths) {
        if (!fs.existsSync(filepath)) continue;
        if (!filepath.endsWith('.ts') && !filepath.endsWith('.tsx')) continue;

        const code = fs.readFileSync(filepath, 'utf8');
        const sourceFile = parseSourceFile(filepath, code);
        const imports = new Map<
            string,
            { kind: 'client-hook' | 'router-context'; relatedFilepath?: string; moduleSpecifier: string }
        >();

        for (const statement of sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
            if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

            const moduleSpecifier = statement.moduleSpecifier.text;
            const relatedFilepath = resolveClientRelatedFilepath({
                appRoot: manifest.app.root,
                filepath,
                moduleSpecifier,
            });
            const normalizedRelatedFilepath = relatedFilepath ? normalizeFilepath(relatedFilepath) : undefined;
            const normalizedAppRoot = normalizeFilepath(manifest.app.root);
            const isKnownClientHookModule =
                moduleSpecifier === '@/client/context' ||
                moduleSpecifier === '@generated/client/context' ||
                moduleSpecifier.startsWith('@/client/') ||
                moduleSpecifier.startsWith('@generated/client/') ||
                normalizedRelatedFilepath?.startsWith(`${normalizedAppRoot}/client/`) === true ||
                normalizedRelatedFilepath?.startsWith(`${normalizedAppRoot}/.proteum/client/`) === true;
            if (!isKnownClientHookModule) continue;

            const isRouterContextImport =
                moduleSpecifier === '@/client/context' ||
                moduleSpecifier === '@generated/client/context' ||
                moduleSpecifier.endsWith('/client/context');

            if (statement.importClause.name) {
                imports.set(statement.importClause.name.text, {
                    kind: isRouterContextImport ? 'router-context' : 'client-hook',
                    relatedFilepath,
                    moduleSpecifier,
                });
            }

            if (!statement.importClause.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
            for (const element of statement.importClause.namedBindings.elements) {
                const localName = element.name.text;
                const importedName = element.propertyName?.text || localName;
                if (!importedName.startsWith('use') && !isRouterContextImport) continue;

                imports.set(localName, {
                    kind: isRouterContextImport ? 'router-context' : 'client-hook',
                    relatedFilepath,
                    moduleSpecifier,
                });
            }
        }

        if (imports.size === 0) continue;

        const ssrRuntimeFile = isSsrRuntimeFile(manifest, filepath);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                const importedHook = imports.get(node.expression.text);
                if (importedHook) {
                    const sourceLocation = getNodeLocation(sourceFile, node.expression);
                    const relatedFilepaths = importedHook.relatedFilepath ? [importedHook.relatedFilepath] : [];

                    if (ssrRuntimeFile) {
                        addUniqueDiagnostic(
                            diagnostics,
                            createContractDiagnostic({
                                code: 'runtime/client-only-hook-in-ssr',
                                filepath,
                                message: `Client hook "${node.expression.text}" is referenced from SSR-only or server-side runtime code.`,
                                sourceLocation,
                                fixHint:
                                    'Move the hook usage to a client-owned component or split the file so SSR code passes plain data instead of calling client hooks.',
                                relatedFilepaths,
                            }),
                        );
                    } else {
                        const container = getFunctionContainer(node);
                        if (!container || !isValidHookContainer(container)) {
                            addUniqueDiagnostic(
                                diagnostics,
                                createContractDiagnostic({
                                    code:
                                        importedHook.kind === 'router-context'
                                            ? 'runtime/router-context-outside-router'
                                            : 'runtime/provider-hook-outside-provider',
                                    filepath,
                                    message:
                                        importedHook.kind === 'router-context'
                                            ? `Router context hook "${node.expression.text}" is called outside Router-owned render execution.`
                                            : `Provider-dependent hook "${node.expression.text}" is called outside a valid provider/render boundary.`,
                                    sourceLocation,
                                    fixHint:
                                        importedHook.kind === 'router-context'
                                            ? 'Call the hook only inside a Router.page render callback, a component rendered under App, or a custom hook used from that tree.'
                                            : 'Move the hook back under the provider-managed React tree or pass the required values as explicit props or SSR data.',
                                    relatedFilepaths,
                                }),
                            );
                        }
                    }
                }
            }

            ts.forEachChild(node, visit);
        };

        ts.forEachChild(sourceFile, visit);
    }

    return diagnostics;
};

const findConnectNamespaceLocation = (setupFilepath: string, namespace: string): TProteumManifestSourceLocation | undefined => {
    if (!fs.existsSync(setupFilepath)) return undefined;

    const sourceFile = parseSourceFile(setupFilepath, fs.readFileSync(setupFilepath, 'utf8'));
    let fallbackLocation: TProteumManifestSourceLocation | undefined;
    let namespaceLocation: TProteumManifestSourceLocation | undefined;

    const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node)) {
            const name =
                ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)
                    ? node.name.text
                    : undefined;

            if (name === 'connect' && !fallbackLocation) fallbackLocation = getNodeLocation(sourceFile, node.name);
            if (name === namespace && !namespaceLocation) namespaceLocation = getNodeLocation(sourceFile, node.name);
        }

        if (!namespaceLocation) ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return namespaceLocation || fallbackLocation;
};

const buildConnectedBoundaryDiagnostics = (manifest: TProteumManifest) => {
    const diagnostics: TProteumManifestDiagnostic[] = [];

    for (const project of manifest.connectedProjects) {
        const issues: string[] = [];
        let hasErrorIssue = false;

        if (!project.sourceValue) {
            issues.push(`connect.${project.namespace}.source is missing`);
            hasErrorIssue = true;
        }
        if (!project.sourceKind && project.sourceValue) {
            issues.push('the source could not be resolved into a connected contract');
            hasErrorIssue = true;
        }
        if (!project.cachedContractFilepath) {
            issues.push('no cached connected contract filepath was generated');
            hasErrorIssue = true;
        }
        if (project.cachedContractFilepath && !fs.existsSync(project.cachedContractFilepath))
            {
                issues.push('the cached connected contract file is missing on disk');
                hasErrorIssue = true;
            }
        if (!project.urlInternal) {
            issues.push(`connect.${project.namespace}.urlInternal is missing`);
            hasErrorIssue = true;
        }
        if (project.controllerCount === 0) {
            issues.push('zero connected controllers were imported');
        }

        if (project.sourceKind === 'file' && project.typingMode !== 'local-typed') {
            issues.push(`file-based sources should resolve to local-typed mode, got "${project.typingMode || 'unknown'}"`);
        }

        if (project.sourceKind && project.sourceKind !== 'file' && project.typingMode === 'local-typed') {
            issues.push(`non-file connected sources should not report local-typed mode`);
        }

        if (issues.length === 0) continue;

        addUniqueDiagnostic(
            diagnostics,
            createContractDiagnostic({
                code: 'runtime/connected-boundary-mismatch',
                filepath: manifest.app.setupFilepath,
                level: hasErrorIssue ? 'error' : 'warning',
                message: `Connected namespace "${project.namespace}" has a framework boundary mismatch: ${issues.join('; ')}.`,
                sourceLocation: findConnectNamespaceLocation(manifest.app.setupFilepath, project.namespace) || { line: 1, column: 1 },
                fixHint: `Update connect.${project.namespace} in proteum.config.ts, refresh the connected contract, then re-check both the consumer and producer runtime surfaces.`,
                relatedFilepaths: project.cachedContractFilepath ? [project.cachedContractFilepath] : [],
            }),
        );
    }

    return diagnostics;
};

export const buildContractsDoctorResponse = (manifest: TProteumManifest, strict = false): TDoctorResponse => {
    const diagnostics: TProteumManifestDiagnostic[] = [];
    const sourceFilepaths = new Set<string>([
        manifest.app.identityFilepath,
        manifest.app.setupFilepath,
        ...manifest.controllers.map((controller) => controller.filepath),
        ...manifest.connectedProjects.flatMap((connectedProject) =>
            connectedProject.cachedContractFilepath ? [connectedProject.cachedContractFilepath] : [],
        ),
        ...manifest.commands.map((command) => command.filepath),
        ...manifest.routes.client.map((route) => route.filepath),
        ...manifest.routes.server.map((route) => route.filepath),
        ...manifest.layouts.map((layout) => layout.filepath),
        ...manifest.services.app.flatMap((service) => (service.sourceFilepath ? [service.sourceFilepath] : [])),
        ...manifest.services.routerPlugins.flatMap((service) => (service.sourceFilepath ? [service.sourceFilepath] : [])),
    ]);

    for (const filepath of sourceFilepaths) {
        if (fs.existsSync(filepath)) continue;

        diagnostics.push(
            createContractDiagnostic({
                code: 'contract.source-missing',
                filepath,
                message: `Referenced source file "${filepath}" is missing from disk.`,
            }),
        );
    }

    for (const filepath of buildGeneratedArtifactList(manifest)) {
        if (fs.existsSync(filepath)) continue;

        diagnostics.push(
            createContractDiagnostic({
                code: 'contract.generated-missing',
                filepath,
                message: `Expected generated artifact "${filepath}" is missing.`,
            }),
        );
    }

    diagnostics.push(
        ...buildHookContractDiagnostics(
            manifest,
            [...sourceFilepaths].filter((filepath) =>
                normalizeFilepath(path.resolve(filepath)).startsWith(`${normalizeFilepath(path.resolve(manifest.app.root))}/`),
            ),
        ),
    );
    diagnostics.push(...buildConnectedBoundaryDiagnostics(manifest));

    const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error');
    const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning');

    return {
        diagnostics,
        summary: {
            errors: errors.length,
            strictFailed: strict === true && diagnostics.length > 0,
            warnings: warnings.length,
        },
    };
};
