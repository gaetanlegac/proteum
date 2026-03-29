import fs from 'fs-extra';
import path from 'path';
import slugify from 'slugify';
import { UsageError } from 'clipanion';

import cli from '..';
import { loadApplicationIdentityConfig } from '../../common/applicationConfigLoader';
import { ensureProjectAgentSymlinks } from '../utils/agents';
import { runProcess } from '../utils/runProcess';
import {
    createClientTsconfigTemplate,
    createCommandTemplate,
    createControllerTemplate,
    createEslintConfigTemplate,
    createEnvTemplate,
    createGitignoreTemplate,
    createIdentityTemplate,
    createInitSummary,
    createPackageJsonTemplate,
    createPageTemplate,
    createProteumConfigTemplate,
    createRouteTemplate,
    createRouterConfigTemplate,
    createServerIndexTemplate,
    createServerTsconfigTemplate,
    createServiceConfigTemplate,
    createServiceTemplate,
} from './templates';
import type { TScaffoldFilePlan, TScaffoldInitConfig, TScaffoldKind, TScaffoldResult } from './types';

type TCreatePlan = {
    files: TScaffoldFilePlan[];
    nextSteps: string[];
    notes: string[];
    postWrite?: () => { updated: string[]; notes: string[] };
};

type TIdentityConfig = {
    identifier: string;
    name: string;
};

const createEmptyResult = ({ dryRun }: { dryRun: boolean }): TScaffoldResult => ({
    dryRun,
    created: [],
    updated: [],
    skipped: [],
    notes: [],
    nextSteps: [],
});

const isJson = () => cli.args.json === true;
const isDryRun = () => cli.args.dryRun === true;
const isForce = () => cli.args.force === true;

const ensureStringArg = (name: string) => {
    const value = cli.args[name];
    if (typeof value === 'string') return value.trim();
    return '';
};

const ensureBooleanArg = (name: string) => cli.args[name] === true;

const toPosix = (value: string) => value.replace(/\\/g, '/');

const stripKnownExtension = (value: string) => value.replace(/\.(tsx|ts|jsx|js)$/i, '');

const splitSegments = (value: string) =>
    toPosix(value)
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);

const stripPrefix = (value: string, prefix: string) => {
    const normalizedValue = toPosix(value);
    const normalizedPrefix = toPosix(prefix);
    return normalizedValue.startsWith(`${normalizedPrefix}/`) ? normalizedValue.substring(normalizedPrefix.length + 1) : normalizedValue;
};

const stripTrailingIndex = (segments: string[]) => (segments[segments.length - 1] === 'index' ? segments.slice(0, -1) : segments);

const findLastMatchingIndex = (lines: string[], matcher: RegExp) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (matcher.test(lines[index])) return index;
    }

    return -1;
};

const toWords = (value: string) =>
    value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .map((part) => part.trim())
        .filter(Boolean);

const toPascal = (value: string) =>
    toWords(value)
        .map((part) => part.charAt(0).toUpperCase() + part.substring(1))
        .join('');

const toCamel = (value: string) => {
    const pascal = toPascal(value);
    return pascal ? pascal.charAt(0).toLowerCase() + pascal.substring(1) : '';
};

const toSentence = (value: string) =>
    toWords(value)
        .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.substring(1).toLowerCase() : part.toLowerCase()))
        .join(' ');

const toSlug = (value: string) =>
    slugify(value, {
        lower: true,
        strict: true,
        trim: true,
    });

const normalizePageSegments = (rawTarget: string) => {
    const trimmed = stripKnownExtension(stripPrefix(rawTarget.trim(), 'client/pages'));
    return stripTrailingIndex(splitSegments(trimmed));
};

const normalizeSourceFileSegments = (rawTarget: string, prefix: string) => {
    const trimmed = stripKnownExtension(stripPrefix(rawTarget.trim(), prefix));
    return splitSegments(trimmed);
};

const defaultRouteFromSegments = (segments: string[]) => {
    if (segments.length === 0) return '/';
    return `/${segments.map((segment) => toSlug(segment) || segment.toLowerCase()).join('/')}`;
};

const resolveRootServiceLeaf = (segments: string[]) => segments[segments.length - 1];

const readIdentityConfig = (appRoot: string): TIdentityConfig => {
    const identityFilepath = path.join(appRoot, 'identity.config.ts');
    if (!fs.existsSync(identityFilepath)) {
        throw new UsageError(`Missing identity.config.ts in ${appRoot}. Run \`proteum init\` first or target a Proteum app root.`);
    }

    const parsed = loadApplicationIdentityConfig(appRoot);
    const identifier = typeof parsed.identifier === 'string' ? parsed.identifier.trim() : '';
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';

    if (!identifier) throw new UsageError(`identity.config.ts in ${appRoot} is missing a valid "identifier" field.`);

    return {
        identifier,
        name: name || identifier,
    };
};

const assertProteumAppRoot = (appRoot: string) => {
    const expectedEntries = ['package.json', 'identity.config.ts', 'proteum.config.ts', 'client', 'server'];
    const missing = expectedEntries.filter((entry) => !fs.existsSync(path.join(appRoot, entry)));
    if (missing.length > 0) {
        throw new UsageError(
            `This command expects a Proteum app root. Missing: ${missing.join(', ')} in ${appRoot}.`,
        );
    }
};

const ensureDirectory = (filepath: string, rootDir: string, result: TScaffoldResult) => {
    const directory = path.dirname(filepath);
    if (directory === rootDir) return;
    fs.ensureDirSync(directory);
};

const writeFilePlan = ({ rootDir, filePlan, result }: { rootDir: string; filePlan: TScaffoldFilePlan; result: TScaffoldResult }) => {
    const absolutePath = path.join(rootDir, filePlan.relativePath);
    const relativePath = toPosix(filePlan.relativePath);
    const exists = fs.existsSync(absolutePath);

    if (exists && !isForce()) {
        throw new UsageError(`Refusing to overwrite existing file without --force: ${relativePath}`);
    }

    if (result.dryRun) {
        result.created.push(relativePath);
        return;
    }

    fs.ensureDirSync(rootDir);
    ensureDirectory(absolutePath, rootDir, result);
    fs.writeFileSync(absolutePath, filePlan.content, 'utf8');

    if (exists) result.updated.push(relativePath);
    else result.created.push(relativePath);
};

const maybeWriteFilePlans = ({ rootDir, filePlans, result }: { rootDir: string; filePlans: TScaffoldFilePlan[]; result: TScaffoldResult }) => {
    for (const filePlan of filePlans) writeFilePlan({ rootDir, filePlan, result });
};

const printResult = (result: TScaffoldResult, extra: unknown = null) => {
    if (isJson()) {
        const payload = extra && typeof extra === 'object' ? { ...result, ...(extra as object) } : result;
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }

    const lines: string[] = [];
    const actionLabel = result.dryRun ? 'Planned files' : 'Created files';

    if (result.created.length > 0) {
        lines.push(`${actionLabel}:`);
        lines.push(...result.created.map((entry) => `- ${entry}`));
    }

    if (result.updated.length > 0) {
        lines.push('Updated files:');
        lines.push(...result.updated.map((entry) => `- ${entry}`));
    }

    if (result.notes.length > 0) {
        lines.push('Notes:');
        lines.push(...result.notes.map((entry) => `- ${entry}`));
    }

    if (result.nextSteps.length > 0) {
        lines.push('Next steps:');
        lines.push(...result.nextSteps.map((entry) => `- ${entry}`));
    }

    process.stdout.write(`${lines.join('\n')}\n`);
};

const shouldUseLocalCoreDependency = () => !toPosix(cli.paths.core.root).includes('/node_modules/');

const resolveProteumDependency = () => {
    const override = ensureStringArg('proteumVersion');
    if (override) return override;
    if (shouldUseLocalCoreDependency()) return `file:${cli.paths.core.root}`;
    return `^${String(cli.packageJson.version || '')}`;
};

const createPagePlan = (target: string): TCreatePlan => {
    const pageSegments = normalizePageSegments(target);
    const routePath = ensureStringArg('route') || defaultRouteFromSegments(pageSegments);
    const relativePath =
        pageSegments.length === 0 ? path.join('client', 'pages', 'index.tsx') : path.join('client', 'pages', ...pageSegments, 'index.tsx');
    const heading = toSentence(pageSegments[pageSegments.length - 1] || 'Home');

    return {
        files: [
            {
                relativePath,
                content: createPageTemplate({
                    routePath,
                    heading,
                    message: 'This page was generated by Proteum create.',
                }),
            },
        ],
        notes: ['Review the generated route path and SSR setup values before committing.'],
        nextSteps: ['Run `npx proteum refresh`.', 'Run `npx proteum explain --routes` to verify discovery.'],
    };
};

const createControllerPlan = ({ appIdentifier, target }: { appIdentifier: string; target: string }): TCreatePlan => {
    const segments = normalizeSourceFileSegments(target, 'server/controllers');
    if (segments.length === 0) throw new UsageError('Create controller requires a target path, for example `Founder/projects`.');

    const relativePath = path.join('server', 'controllers', ...segments) + '.ts';
    const className = `${segments.map(toPascal).join('')}Controller`;
    const methodName = ensureStringArg('method') || 'run';

    return {
        files: [
            {
                relativePath,
                content: createControllerTemplate({
                    appIdentifier,
                    className,
                    methodName,
                }),
            },
        ],
        notes: ['Wire the generated controller method into a real service call before exposing it to production traffic.'],
        nextSteps: ['Run `npx proteum refresh`.', 'Run `npx proteum explain --controllers` to verify discovery.'],
    };
};

const createCommandPlan = ({ target }: { target: string }): TCreatePlan => {
    const segments = normalizeSourceFileSegments(target, 'commands');
    if (segments.length === 0) throw new UsageError('Create command requires a target path, for example `diagnostics`.');

    const relativePath = path.join('commands', ...segments) + '.ts';
    const className = `${segments.map(toPascal).join('')}Commands`;
    const methodName = ensureStringArg('method') || 'run';

    return {
        files: [
            {
                relativePath,
                content: createCommandTemplate({
                    className,
                    methodName,
                }),
            },
        ],
        notes: ['Commands are dev-only internal entrypoints and should not replace normal controllers or routes.'],
        nextSteps: ['Run `npx proteum refresh`.', 'Run `npx proteum explain --commands` to verify discovery.'],
    };
};

const createRoutePlan = ({ target }: { target: string }): TCreatePlan => {
    const segments = normalizeSourceFileSegments(target, 'server/routes');
    if (segments.length === 0) throw new UsageError('Create route requires a target path, for example `webhooks/stripe`.');

    const httpMethod = (ensureStringArg('httpMethod') || 'get').toLowerCase();
    const routePath = ensureStringArg('route') || defaultRouteFromSegments(segments);
    const relativePath = path.join('server', 'routes', ...segments) + '.ts';

    return {
        files: [
            {
                relativePath,
                content: createRouteTemplate({
                    httpMethod,
                    routePath,
                }),
            },
        ],
        notes: ['Prefer controllers for normal app APIs; use manual routes only for explicit HTTP semantics.'],
        nextSteps: ['Run `npx proteum refresh`.', 'Run `npx proteum explain --routes` to verify discovery.'],
    };
};

const insertImportLine = ({
    content,
    importLine,
    matcher,
    fallbackMatcher,
}: {
    content: string;
    importLine: string;
    matcher: RegExp;
    fallbackMatcher: RegExp;
}) => {
    if (content.includes(importLine)) return content;

    const lines = content.split('\n');
    const preferredIndex = findLastMatchingIndex(lines, matcher);
    const fallbackIndex = findLastMatchingIndex(lines, fallbackMatcher);
    const classIndex = lines.findIndex((line) => line.includes('export default class '));
    const insertIndex = preferredIndex >= 0 ? preferredIndex + 1 : fallbackIndex >= 0 ? fallbackIndex + 1 : Math.max(classIndex, 0);

    lines.splice(insertIndex, 0, importLine);
    return lines.join('\n');
};

const insertClassProperty = ({
    content,
    propertyLine,
}: {
    content: string;
    propertyLine: string;
}) => {
    if (content.includes(propertyLine.trim())) return content;

    const lines = content.split('\n');
    const classIndex = lines.findIndex((line) => line.includes('export default class ') && line.includes('extends Application'));
    if (classIndex < 0) throw new UsageError('Could not locate the app Application class in server/index.ts.');

    const closingIndex = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim() === '}');
    const candidateIndex = (() => {
        for (let index = closingIndex - 1; index > classIndex; index -= 1) {
            if (/^\s+public .*= new .*;\s*$/.test(lines[index])) return index + 1;
        }
        for (let index = classIndex + 1; index < closingIndex; index += 1) {
            if (/^\s+public .*[;!]\s*$/.test(lines[index])) return index + 1;
        }
        return classIndex + 1;
    })();

    lines.splice(candidateIndex, 0, propertyLine);
    return lines.join('\n');
};

const registerRootService = ({
    appRoot,
    servicePath,
    serviceImportName,
    configFileBase,
    configNamespace,
    configExportName,
    propertyName,
}: {
    appRoot: string;
    servicePath: string;
    serviceImportName: string;
    configFileBase: string;
    configNamespace: string;
    configExportName: string;
    propertyName: string;
}) => {
    const serverIndexFilepath = path.join(appRoot, 'server', 'index.ts');
    if (!fs.existsSync(serverIndexFilepath)) {
        return {
            updated: [] as string[],
            notes: ['Could not auto-register the new service because server/index.ts is missing.'],
        };
    }

    const serviceImportLine = `import ${serviceImportName} from ${JSON.stringify(`@/server/services/${toPosix(servicePath)}`)};`;
    const configImportLine = `import * as ${configNamespace} from ${JSON.stringify(`@/server/config/${configFileBase}`)};`;
    const propertyLine = `    public ${propertyName} = new ${serviceImportName}(this, ${configNamespace}.${configExportName}, this);`;

    let content = fs.readFileSync(serverIndexFilepath, 'utf8');
    const initialContent = content;

    content = insertImportLine({
        content,
        importLine: serviceImportLine,
        matcher: /^import .* from ['"]@\/server\/services\//,
        fallbackMatcher: /^import .* from ['"]@server\//,
    });
    content = insertImportLine({
        content,
        importLine: configImportLine,
        matcher: /^import \* as .* from ['"]@\/server\/config\//,
        fallbackMatcher: /^import .* from ['"]@\/server\/services\//,
    });
    content = insertClassProperty({ content, propertyLine });

    if (content === initialContent) {
        return {
            updated: [] as string[],
            notes: ['The new service already appears to be registered in server/index.ts.'],
        };
    }

    if (!isDryRun()) fs.writeFileSync(serverIndexFilepath, content, 'utf8');

    return {
        updated: ['server/index.ts'],
        notes: ['Auto-registered the new root service in server/index.ts.'],
    };
};

const createServicePlan = ({
    appIdentifier,
    appRoot,
    target,
}: {
    appIdentifier: string;
    appRoot: string;
    target: string;
}): TCreatePlan => {
    const segments = normalizeSourceFileSegments(target, 'server/services');
    if (segments.length === 0) throw new UsageError('Create service requires a target path, for example `Analytics` or `Conversion/Plans`.');

    const leaf = resolveRootServiceLeaf(segments);
    const serviceImportName = toPascal(leaf);
    const className = `${serviceImportName}Service`;
    const configFileBase = toCamel(leaf) || leaf.toLowerCase();
    const configNamespace = `${configFileBase}Config`;
    const configExportName = `${configFileBase}Config`;
    const relativeServiceDir = path.join('server', 'services', ...segments);
    const relativeServiceFilepath = path.join(relativeServiceDir, 'index.ts');
    const relativeConfigFilepath = path.join('server', 'config', `${configFileBase}.ts`);
    const propertyName = serviceImportName;

    return {
        files: [
            {
                relativePath: relativeServiceFilepath,
                content: createServiceTemplate({
                    appIdentifier,
                    className,
                }),
            },
            {
                relativePath: relativeConfigFilepath,
                content: createServiceConfigTemplate({
                    configExportName,
                    serviceImportPath: `@/server/services/${toPosix(segments.join('/'))}`,
                    serviceImportName,
                }),
            },
        ],
        notes: ['Root services must be explicitly registered in server/index.ts and use typed config from server/config/*.ts.'],
        nextSteps: ['Run `npx proteum refresh`.', 'Run `npx proteum explain --services` to verify discovery.'],
        postWrite: () =>
            registerRootService({
                appRoot,
                servicePath: segments.join('/'),
                serviceImportName,
                configFileBase,
                configNamespace,
                configExportName,
                propertyName,
            }),
    };
};

const buildCreatePlan = ({ appRoot, appIdentifier, kind, target }: { appRoot: string; appIdentifier: string; kind: TScaffoldKind; target: string }) => {
    switch (kind) {
        case 'page':
            return createPagePlan(target);
        case 'controller':
            return createControllerPlan({ appIdentifier, target });
        case 'command':
            return createCommandPlan({ target });
        case 'route':
            return createRoutePlan({ target });
        case 'service':
            return createServicePlan({ appIdentifier, appRoot, target });
        default:
            throw new UsageError(`Unsupported scaffold kind: ${kind}.`);
    }
};

export const runCreateScaffold = async () => {
    const appRoot = cli.paths.appRoot;
    assertProteumAppRoot(appRoot);

    const rawKind = ensureStringArg('kind');
    const rawTarget = ensureStringArg('target');
    const allowedKinds: TScaffoldKind[] = ['page', 'controller', 'command', 'route', 'service'];

    if (!allowedKinds.includes(rawKind as TScaffoldKind)) {
        throw new UsageError(`Unknown scaffold kind "${rawKind}". Allowed values: ${allowedKinds.join(', ')}.`);
    }

    if (!rawTarget) throw new UsageError('Create requires a target path, for example `proteum create page landing/faq`.');

    const { identifier } = readIdentityConfig(appRoot);
    const plan = buildCreatePlan({
        appRoot,
        appIdentifier: identifier,
        kind: rawKind as TScaffoldKind,
        target: rawTarget,
    });
    const result = createEmptyResult({ dryRun: isDryRun() });

    maybeWriteFilePlans({ rootDir: appRoot, filePlans: plan.files, result });

    if (plan.postWrite) {
        const postWriteResult = plan.postWrite();
        result.updated.push(...postWriteResult.updated);
        result.notes.push(...postWriteResult.notes);
    }

    result.notes.push(...plan.notes);
    result.nextSteps.push(...plan.nextSteps);
    printResult(result);
};

const toDefaultIdentifier = (name: string) => {
    const identifier = toPascal(name);
    return identifier || 'ProteumApp';
};

const toDefaultDirectory = (name: string) => {
    const slug = toSlug(name);
    return slug || 'proteum-app';
};

const resolveInitConfig = async (): Promise<TScaffoldInitConfig> => {
    let directory = ensureStringArg('directory');
    let name = ensureStringArg('name');
    let description = ensureStringArg('description');
    let identifier = ensureStringArg('identifier');
    const rawPort = ensureStringArg('port');
    let port = rawPort ? Number(rawPort) : 3000;

    if (!directory && name) directory = toDefaultDirectory(name);
    if (!name && directory) name = toSentence(directory.replace(/[-_]/g, ' '));
    if (!name) name = 'Proteum App';
    if (!directory) directory = toDefaultDirectory(name);
    if (!description) description = `${name} built with Proteum.`;
    if (!identifier) identifier = toDefaultIdentifier(name);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new UsageError(`Invalid --port "${rawPort}". Expected an integer between 1 and 65535.`);
    }

    const url = ensureStringArg('url') || `http://localhost:${port}`;

    return {
        directory,
        name,
        identifier,
        description,
        port,
        url,
        install: ensureBooleanArg('install'),
        proteumDependency: resolveProteumDependency(),
    };
};

const assertInitTarget = ({ appRoot }: { appRoot: string }) => {
    if (!fs.existsSync(appRoot)) return;
    const entries = fs.readdirSync(appRoot);
    if (entries.length === 0) return;
    if (isForce()) return;

    throw new UsageError(
        `Refusing to scaffold into non-empty directory without --force: ${appRoot}`,
    );
};

const createInitFilePlans = (config: TScaffoldInitConfig): TScaffoldFilePlan[] => [
    {
        relativePath: 'package.json',
        content: createPackageJsonTemplate({
            packageName: toSlug(config.name) || 'proteum-app',
            appDescription: config.description,
            proteumDependency: config.proteumDependency,
            preactDependency: String(cli.packageJson.dependencies?.preact || '^10.27.1'),
        }),
    },
    {
        relativePath: 'identity.config.ts',
        content: createIdentityTemplate({
            appName: config.name,
            appIdentifier: config.identifier,
            appDescription: config.description,
        }),
    },
    {
        relativePath: 'proteum.config.ts',
        content: createProteumConfigTemplate(),
    },
    {
        relativePath: '.env',
        content: createEnvTemplate({
            port: config.port,
            url: config.url,
        }),
    },
    {
        relativePath: '.gitignore',
        content: createGitignoreTemplate(),
    },
    {
        relativePath: 'eslint.config.mjs',
        content: createEslintConfigTemplate(),
    },
    {
        relativePath: path.join('client', 'tsconfig.json'),
        content: createClientTsconfigTemplate(),
    },
    {
        relativePath: path.join('server', 'tsconfig.json'),
        content: createServerTsconfigTemplate(),
    },
    {
        relativePath: path.join('server', 'config', 'app.ts'),
        content: createRouterConfigTemplate(),
    },
    {
        relativePath: path.join('server', 'index.ts'),
        content: createServerIndexTemplate({
            appIdentifier: config.identifier,
        }),
    },
    {
        relativePath: path.join('client', 'pages', 'index.tsx'),
        content: createPageTemplate({
            routePath: '/',
            heading: config.name,
            message: 'Proteum init generated this page. Replace it with your real entrypoint.',
        }),
    },
];

export const runInitScaffold = async () => {
    const config = await resolveInitConfig();
    const appRoot = path.resolve(cli.args.workdir as string, config.directory);
    assertInitTarget({ appRoot });

    const result = createEmptyResult({ dryRun: isDryRun() });
    const filePlans = createInitFilePlans(config);

    maybeWriteFilePlans({ rootDir: appRoot, filePlans, result });

    if (!result.dryRun) {
        fs.ensureDirSync(path.join(appRoot, 'client'));
        fs.ensureDirSync(path.join(appRoot, 'server'));
        ensureProjectAgentSymlinks({ appRoot, coreRoot: cli.paths.core.root });
    }

    if (config.install) {
        if (result.dryRun) result.notes.push('Install was requested, but dry-run mode does not execute npm install.');
        else {
            await runProcess('npm', ['install'], { cwd: appRoot });
            result.notes.push('Installed app dependencies with npm install.');
        }
    }

    result.notes.push(
        shouldUseLocalCoreDependency()
            ? 'This scaffold targets the current local Proteum checkout through a file: dependency.'
            : `This scaffold targets Proteum ${config.proteumDependency}.`,
    );
    result.nextSteps.push(
        result.dryRun
            ? `Rerun \`proteum init ${JSON.stringify(config.directory)} --name ${JSON.stringify(config.name)}\` without \`--dry-run\` when you want to write the scaffold.`
            : config.install
              ? 'Run `npm run dev` in the new app directory.'
              : 'Run `npm install`, then `npm run dev` in the new app directory.',
    );
    result.nextSteps.push('Use `proteum create page|controller|command|route|service ...` to add app artifacts.');

    printResult(result, createInitSummary(result, config));
};
