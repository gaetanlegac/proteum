import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const ROOT = '/Users/gaetan/Desktop/Projets';
const UNIQUE_ROOT = path.join(ROOT, 'unique.domains/website');
const CROSSPATH_ROOT = path.join(ROOT, 'crosspath/platform');

const TARGET_CONTEXT_NAMES = new Set([
    'Investor',
    'Crm',
    'Prospect',
    'Headhunters',
    'Founder',
    'Domains',
    'Navigation',
    'Router',
    'Users',
    'Plans',
    'Auth',
    'Admin',
]);

type TLogConfig = { filepath: string; baseDir: string };

const LOGS: TLogConfig[] = [
    { filepath: '/tmp/unique-client-after-page-contract.log', baseDir: path.join(UNIQUE_ROOT, 'client') },
    { filepath: '/tmp/unique-server-after-page-contract.log', baseDir: path.join(UNIQUE_ROOT, 'server') },
    { filepath: '/tmp/crosspath-client-after-page-contract.log', baseDir: path.join(CROSSPATH_ROOT, 'client') },
    { filepath: '/tmp/crosspath-server-after-page-contract.log', baseDir: path.join(CROSSPATH_ROOT, 'server') },
];

const assertReplace = (filepath: string, source: string, searchValue: string, replaceValue: string) => {
    if (!source.includes(searchValue)) throw new Error(`Could not find expected content in ${filepath}: ${searchValue}`);

    return source.replace(searchValue, replaceValue);
};

const ensureContextBinding = (source: string, bindingName: string) => {
    if (
        source.includes(`const { ${bindingName} } = context;`) ||
        source.includes(`const { ${bindingName} } = useContext();`)
    ) {
        return source;
    }

    return source.replace(
        '  const context = useContext();',
        `  const context = useContext();\n  const { ${bindingName} } = context;`,
    );
};

const ensureContextHookBinding = (source: string, bindingName: string, anchor: string) => {
    if (
        source.includes(`const { ${bindingName} } = useContext();`) ||
        source.includes(`const { ${bindingName} } = context;`)
    ) {
        return source;
    }

    return source.replace(anchor, `  const { ${bindingName} } = useContext();\n${anchor}`);
};

const writeIfChanged = (filepath: string, nextContent: string) => {
    const currentContent = fs.readFileSync(filepath, 'utf8');
    if (currentContent === nextContent) return false;

    fs.writeFileSync(filepath, nextContent);
    console.info(`updated ${filepath}`);
    return true;
};

const applyLiteralReplacement = (filepath: string, updater: (source: string) => string) => {
    const currentContent = fs.readFileSync(filepath, 'utf8');
    const nextContent = updater(currentContent);
    if (nextContent !== currentContent) {
        fs.writeFileSync(filepath, nextContent);
        console.info(`updated ${filepath}`);
    }
};

const patchCentralFiles = () => {
    applyLiteralReplacement(path.join(CROSSPATH_ROOT, 'client/components/legacy/Button.tsx'), (source) =>
        source.includes('export type TLinkProps = React.JSX.HTMLAttributes<HTMLAnchorElement> & { link: string };')
            ? source
            : assertReplace(
                  path.join(CROSSPATH_ROOT, 'client/components/legacy/Button.tsx'),
                  source,
                  'export type TLinkProps = React.JSX.HTMLAttributes<HTMLAnchorElement>;',
                  'export type TLinkProps = React.JSX.HTMLAttributes<HTMLAnchorElement> & { link: string };',
              ),
    );

    applyLiteralReplacement(path.join(CROSSPATH_ROOT, 'client/pages/_messages/401.tsx'), (source) =>
        source.includes('      Router.go(loginPage);')
            ? source
            : assertReplace(
                  path.join(CROSSPATH_ROOT, 'client/pages/_messages/401.tsx'),
                  source,
                  '      page?.go(loginPage);',
                  '      Router.go(loginPage);',
              ),
    );

    applyLiteralReplacement(path.join(UNIQUE_ROOT, 'client/pages/_messages/ErrorScreen.tsx'), (source) =>
        source
            .replace(
                '{ ArrowRight, Home, LifeBuoy, LogIn, RefreshCw } from "lucide-preact";',
                '{ ArrowRight, Home, LifeBuoy, LogIn, RefreshCw, type LucideIcon } from "lucide-preact";',
            )
            .replace(
                'type TLucideIcon = React.ComponentType<{ size?: number | string; className?: string }>;',
                'type TLucideIcon = LucideIcon;',
            ),
    );

    applyLiteralReplacement(path.join(UNIQUE_ROOT, 'client/pages/Investor/database/DatabasePage.tsx'), (source) =>
        source.includes('const { page: serverPage, user, Router, Investor, Domains } = useContext();')
            ? source
            : assertReplace(
                  path.join(UNIQUE_ROOT, 'client/pages/Investor/database/DatabasePage.tsx'),
                  source,
                  '  const { page: serverPage, user, Router } = useContext();',
                  '  const { page: serverPage, user, Router, Investor, Domains } = useContext();',
              ),
    );

    applyLiteralReplacement(path.join(UNIQUE_ROOT, 'client/pages/Investor/insights/index.tsx'), (source) =>
        source.includes('  const { Investor } = useAppContext();\n  const [byGroupBy, setByGroupBy]')
            ? source
            : assertReplace(
                  path.join(UNIQUE_ROOT, 'client/pages/Investor/insights/index.tsx'),
                  source,
                  `}) => {
  const [byGroupBy, setByGroupBy] = React.useState<InsightsRadarLensState>(() =>
    emptyRadarLensState(),
  );
`,
                  `}) => {
  const { Investor } = useAppContext();
  const [byGroupBy, setByGroupBy] = React.useState<InsightsRadarLensState>(() =>
    emptyRadarLensState(),
  );
`,
              ),
    );

    applyLiteralReplacement(
        path.join(UNIQUE_ROOT, 'client/pages/Investor/layout/components/user-settings/sections/GeneralSettingsSection.tsx'),
        (source) =>
            ensureContextBinding(
                source.replace(
                    'type UpdateProfileResponse = Awaited<ReturnType<typeof Users.updateProfile>>;',
                    `type UpdateProfileResponse = {
  ok?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};`,
                ),
                'Users',
            ),
    );

    applyLiteralReplacement(
        path.join(UNIQUE_ROOT, 'client/pages/Investor/layout/components/user-settings/sections/PlanSettingsSection.tsx'),
        (source) =>
            ensureContextBinding(
                source.replace('type PlansById = Awaited<ReturnType<typeof Plans.getPlans>>;', 'type PlansById = Record<string, any>;'),
                'Plans',
            ),
    );

    applyLiteralReplacement(
        path.join(UNIQUE_ROOT, 'client/pages/Investor/layout/components/user-settings/sections/SecuritySettingsSection.tsx'),
        (source) =>
            ensureContextHookBinding(
                source
                    .replace(
                        '// App\n\nimport Icon from "@/client/components/Icon";',
                        '// App\n\nimport Icon from "@/client/components/Icon";\nimport useContext from "@/client/context";',
                    )
                    .replace(
                        'type SecuritySummary = Awaited<ReturnType<typeof Auth.getSecuritySummary>>;',
                        `type SecuritySummary = {
  authMethod?: string | null;
  hasPassword?: boolean;
  lastLogin?: string | Date | null;
  lastLoginIP?: string | null;
  connectedProviders?: Array<{ provider?: string | null; email?: string | null }>;
  trustedDevices?: Array<{ deviceName?: string | null; userAgent?: string | null; lastSeen?: string | Date | null }>;
};`,
                    ),
                'Auth',
                '  const [state, setState] = React.useState<LoadState>("idle");',
            ),
    );

    applyLiteralReplacement(path.join(UNIQUE_ROOT, 'server/services/Domains/search/search.controller.ts'), (source) =>
        source.includes('    public async GetLandingSeoCachedSearches() {')
            ? source
            : assertReplace(
                  path.join(UNIQUE_ROOT, 'server/services/Domains/search/search.controller.ts'),
                  source,
                  `    public async GetLandingSeoCachedSearch() {
        const { Domains } = this.services;
        const data = this.input(schema.object({ "searchHash": schema.string() }));
        return Domains.search.GetLandingSeoCachedSearch(data);
    }
`,
                  `    public async GetLandingSeoCachedSearches() {
        const { Domains } = this.services;
        return Domains.search.GetLandingSeoCachedSearches();
    }

    public async GetLandingSeoCachedSearch() {
        const { Domains } = this.services;
        const data = this.input(schema.object({ "searchHash": schema.string() }));
        return Domains.search.GetLandingSeoCachedSearch(data);
    }
`,
              ),
    );

    applyLiteralReplacement(path.join(UNIQUE_ROOT, 'client/pages/Founder/setup/index.tsx'), (source) =>
        source.includes('    const mutate = async (promise: PromiseLike<FounderSetupMutationResponse>) => {')
            ? source
            : assertReplace(
                  path.join(UNIQUE_ROOT, 'client/pages/Founder/setup/index.tsx'),
                  source,
                  '    const mutate = async (promise: Promise<FounderSetupMutationResponse>) => {',
                  '    const mutate = async (promise: PromiseLike<FounderSetupMutationResponse>) => {',
              ),
    );

    for (const relativePath of [
        'client/components/crm/shared/LeadsTable.tsx',
        'client/components/crm/bizdev/dealPartners/DealPartnersTablePanel.tsx',
        'client/pages/crm/bizdev/tabs/PartnersTab.tsx',
        'client/pages/crm/bizdev/tabs/CsmsTab.tsx',
    ]) {
        applyLiteralReplacement(path.join(CROSSPATH_ROOT, relativePath), (source) =>
            source
                .replaceAll('Array<Promise<unknown>>', 'Array<PromiseLike<unknown>>')
                .replaceAll('Promise<void>[]', 'PromiseLike<void>[]'),
        );
    }
};

const parseMissingContextNames = () => {
    const files = new Map<string, Set<string>>();
    const pattern =
        /^(.+?)\(\d+,\d+\): error TS2304: Cannot find name '(Investor|Crm|Prospect|Headhunters|Founder|Domains|Navigation|Router|Users|Plans|Auth|Admin)'\.$/gm;

    for (const log of LOGS) {
        if (!fs.existsSync(log.filepath)) continue;

        const content = fs.readFileSync(log.filepath, 'utf8');
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(content)) !== null) {
            const relativePath = match[1];
            const identifier = match[2];
            const absolutePath = path.resolve(log.baseDir, relativePath);

            if (!fs.existsSync(absolutePath) || absolutePath.includes('/.generated/')) continue;

            let names = files.get(absolutePath);
            if (!names) {
                names = new Set<string>();
                files.set(absolutePath, names);
            }

            names.add(identifier);
        }
    }

    return files;
};

const findChildContainingPosition = (node: ts.Node, position: number): ts.Node | undefined => {
    let matchedChild: ts.Node | undefined;

    node.forEachChild((child) => {
        if (position >= child.getFullStart() && position < child.getEnd()) matchedChild = child;
    });

    return matchedChild;
};

const findEnclosingFunction = (sourceFile: ts.SourceFile, position: number) => {
    let current: ts.Node = sourceFile;
    const functions: Array<
        | ts.FunctionDeclaration
        | ts.FunctionExpression
        | ts.ArrowFunction
        | ts.MethodDeclaration
        | ts.GetAccessorDeclaration
        | ts.SetAccessorDeclaration
        | ts.ConstructorDeclaration
    > = [];

    while (true) {
        const next = findChildContainingPosition(current, position);
        if (!next) return functions[0];

        if (
            ts.isFunctionDeclaration(next) ||
            ts.isFunctionExpression(next) ||
            ts.isArrowFunction(next) ||
            ts.isMethodDeclaration(next) ||
            ts.isGetAccessorDeclaration(next) ||
            ts.isSetAccessorDeclaration(next) ||
            ts.isConstructorDeclaration(next)
        ) {
            functions.push(next);
        }

        current = next;
    }
};

const getContextHookName = (sourceFile: ts.SourceFile) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (statement.moduleSpecifier.text !== '@/client/context') continue;
        if (!statement.importClause?.name) continue;

        return statement.importClause.name.text;
    }

    return null;
};

const ensureContextImport = (filepath: string, source: string, sourceFile: ts.SourceFile) => {
    const existing = getContextHookName(sourceFile);
    if (existing) return { source, hookName: existing };

    const hookName = 'useAppContext';
    const importStatement = `import ${hookName} from "@/client/context";\n`;

    let insertPos = 0;
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) break;
        insertPos = statement.getEnd() + 1;
    }

    const nextSource = source.slice(0, insertPos) + importStatement + source.slice(insertPos);
    console.info(`added context import in ${filepath}`);

    return { source: nextSource, hookName };
};

const findExistingContextBinding = (
    functionBody: ts.Block,
    hookName: string,
): ts.VariableDeclaration | undefined => {
    for (const statement of functionBody.statements) {
        if (!ts.isVariableStatement(statement)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isObjectBindingPattern(declaration.name)) continue;
            if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
            if (!ts.isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== hookName)
                continue;

            return declaration;
        }
    }

    return undefined;
};

const isContextBindingDeclaration = (declaration: ts.VariableDeclaration, hookName: string) => {
    if (!ts.isObjectBindingPattern(declaration.name)) return false;
    if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) return false;
    if (!ts.isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== hookName)
        return false;

    return declaration.name.elements.every((element) => {
        const identifier = element.propertyName || element.name;
        return ts.isIdentifier(identifier) && TARGET_CONTEXT_NAMES.has(identifier.text);
    });
};

const removeNestedContextBindings = (source: string, parentFunction: ts.Node, hookName: string) => {
    const removals: Array<{ start: number; end: number }> = [];

    const visit = (node: ts.Node) => {
        if (node !== parentFunction && ts.isBlock(node) && node.parent) {
            const functionParent = node.parent;
            if (
                ts.isFunctionDeclaration(functionParent) ||
                ts.isFunctionExpression(functionParent) ||
                ts.isArrowFunction(functionParent) ||
                ts.isMethodDeclaration(functionParent) ||
                ts.isGetAccessorDeclaration(functionParent) ||
                ts.isSetAccessorDeclaration(functionParent) ||
                ts.isConstructorDeclaration(functionParent)
            ) {
                for (const statement of node.statements) {
                    if (!ts.isVariableStatement(statement)) continue;

                    const allContextBindings =
                        statement.declarationList.declarations.length > 0 &&
                        statement.declarationList.declarations.every((declaration) =>
                            isContextBindingDeclaration(declaration, hookName),
                        );

                    if (allContextBindings) removals.push({ start: statement.getFullStart(), end: statement.getEnd() });
                }
            }
        }

        node.forEachChild(visit);
    };

    parentFunction.forEachChild(visit);

    return removals
        .sort((left, right) => right.start - left.start)
        .reduce((nextSource, removal) => nextSource.slice(0, removal.start) + nextSource.slice(removal.end), source);
};

const addContextBindings = (filepath: string, names: Set<string>) => {
    let source = fs.readFileSync(filepath, 'utf8');
    let sourceFile = ts.createSourceFile(filepath, source, ts.ScriptTarget.Latest, true, filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const importResult = ensureContextImport(filepath, source, sourceFile);
    source = importResult.source;
    sourceFile = ts.createSourceFile(filepath, source, ts.ScriptTarget.Latest, true, filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const hookName = importResult.hookName;

    const positions = [...names]
        .map((name) => source.indexOf(`${name}.`))
        .filter((position) => position >= 0)
        .sort((left, right) => left - right);

    if (positions.length === 0) return;

    const targetFunction = findEnclosingFunction(sourceFile, positions[0]);
    if (!targetFunction || !targetFunction.body || !ts.isBlock(targetFunction.body)) {
        console.warn(`could not find function body for ${filepath}`);
        return;
    }

    source = removeNestedContextBindings(source, targetFunction, hookName);
    sourceFile = ts.createSourceFile(filepath, source, ts.ScriptTarget.Latest, true, filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const refreshedTargetFunction = findEnclosingFunction(sourceFile, positions[0]);
    if (!refreshedTargetFunction || !refreshedTargetFunction.body || !ts.isBlock(refreshedTargetFunction.body)) {
        console.warn(`could not refresh function body for ${filepath}`);
        return;
    }

    const existingBinding = findExistingContextBinding(refreshedTargetFunction.body, hookName);

    if (existingBinding && ts.isObjectBindingPattern(existingBinding.name)) {
        const currentElements = existingBinding.name.elements.map((element) => element.getText(sourceFile));
        const mergedElements = [...currentElements];

        for (const name of names) {
            if (!TARGET_CONTEXT_NAMES.has(name)) continue;
            if (currentElements.some((element) => element === name || element.startsWith(name + ':'))) continue;
            mergedElements.push(name);
        }

        const start = existingBinding.name.getStart(sourceFile) + 1;
        const end = existingBinding.name.getEnd() - 1;
        source = source.slice(0, start) + ` ${mergedElements.join(', ')} ` + source.slice(end);
    } else {
        const functionLineStart = source.lastIndexOf('\n', refreshedTargetFunction.getStart(sourceFile) - 1) + 1;
        const functionIndent =
            source.slice(functionLineStart, refreshedTargetFunction.getStart(sourceFile)).match(/^\s*/)?.[0] || '';
        const statementIndent = functionIndent + '  ';
        const insertPos = refreshedTargetFunction.body.getStart(sourceFile) + 1;
        const statement = `\n${statementIndent}const { ${[...names].join(', ')} } = ${hookName}();`;
        source = source.slice(0, insertPos) + statement + source.slice(insertPos);
    }

    writeIfChanged(filepath, source);
};

const patchAmbientContextUsages = () => {
    const files = parseMissingContextNames();

    for (const [filepath, names] of files) addContextBindings(filepath, names);
};

patchCentralFiles();
patchAmbientContextUsages();
