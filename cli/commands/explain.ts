import path from 'path';

import cli from '..';
import Compiler from '../compiler';
import {
    readProteumManifest,
    type TProteumManifestDiagnostic,
    type TProteumManifest,
    type TProteumManifestController,
    type TProteumManifestLayout,
    type TProteumManifestRoute,
    type TProteumManifestService,
} from '../compiler/common/proteumManifest';

const explainSectionNames = ['app', 'conventions', 'env', 'services', 'controllers', 'routes', 'layouts', 'diagnostics'] as const;
const allowedExplainArgs = new Set(['json', 'all', ...explainSectionNames]);

type TExplainSectionName = (typeof explainSectionNames)[number];

const validateExplainArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedExplainArgs.has(arg));

    if (invalidArgs.length > 0) {
        throw new Error(
            `Unknown explain argument(s): ${invalidArgs.join(', ')}. Allowed values: ${[...allowedExplainArgs].join(', ')}.`,
        );
    }
};

const getSelectedSections = (): TExplainSectionName[] => {
    if (cli.args.all === true) return [...explainSectionNames];

    return explainSectionNames.filter((sectionName) => cli.args[sectionName] === true);
};

const pickManifestSections = (manifest: TProteumManifest, sectionNames: TExplainSectionName[]) => {
    if (sectionNames.length === 0) return manifest;

    const selected: Record<string, unknown> = {};

    for (const sectionName of sectionNames) {
        selected[sectionName] = manifest[sectionName];
    }

    return selected;
};

const normalizePath = (value: string) => value.replace(/\\/g, '/');
const formatLocation = (line?: number, column?: number) =>
    line && column ? `:${line}:${column}` : line ? `:${line}` : '';

const formatFilepath = (manifest: TProteumManifest, filepath: string) => {
    const normalizedFilepath = normalizePath(filepath);
    const normalizedAppRoot = normalizePath(manifest.app.root);
    const normalizedCoreRoot = normalizePath(manifest.app.coreRoot);

    if (normalizedFilepath === normalizedAppRoot) return '.';
    if (normalizedFilepath.startsWith(normalizedAppRoot + '/'))
        return normalizePath(path.relative(normalizedAppRoot, normalizedFilepath)) || '.';

    if (normalizedFilepath === normalizedCoreRoot) return 'node_modules/proteum';
    if (normalizedFilepath.startsWith(normalizedCoreRoot + '/'))
        return normalizePath(path.join('node_modules/proteum', path.relative(normalizedCoreRoot, normalizedFilepath)));

    return normalizedFilepath;
};

const formatService = (manifest: TProteumManifest, service: TProteumManifestService) => {
    if (service.kind === 'ref') {
        return `- ${service.registeredName} -> ref ${service.refTo} [${service.parent}]`;
    }

    const source = service.metasFilepath ? formatFilepath(manifest, service.metasFilepath) : 'unknown';
    return `- ${service.registeredName} -> ${service.id} (${service.metaName}) [${service.scope}] priority=${service.priority} source=${source}`;
};

const formatController = (manifest: TProteumManifest, controller: TProteumManifestController) =>
    `- ${controller.clientAccessor} -> POST ${controller.httpPath} [${controller.scope}] input=${controller.hasInput ? 'yes' : 'no'} source=${formatFilepath(manifest, controller.filepath)}${formatLocation(controller.sourceLocation.line, controller.sourceLocation.column)}#${controller.methodName}`;

const formatRouteTarget = (route: TProteumManifestRoute) => {
    if (route.kind === 'client-error') return route.code !== undefined ? String(route.code) : route.codeRaw || '?';
    return route.path || route.pathRaw || '?';
};

const formatRoute = (manifest: TProteumManifest, route: TProteumManifestRoute) => {
    const chunk = route.chunkId ? ` chunk=${route.chunkId}` : '';
    const setup = route.hasSetup ? ' setup=yes' : ' setup=no';
    const options = route.normalizedOptionKeys.length > 0 ? ` options=${route.normalizedOptionKeys.join(',')}` : '';
    const resolution = route.targetResolution !== 'literal' ? ` resolution=${route.targetResolution}` : '';

    return `- ${route.kind} ${route.methodName} ${formatRouteTarget(route)} [${route.scope}]${chunk}${setup}${options}${resolution} source=${formatFilepath(manifest, route.filepath)}${formatLocation(route.sourceLocation.line, route.sourceLocation.column)}`;
};

const formatLayout = (manifest: TProteumManifest, layout: TProteumManifestLayout) =>
    `- ${layout.chunkId || 'root'} depth=${layout.depth} [${layout.scope}] source=${formatFilepath(manifest, layout.filepath)}`;

const formatDiagnostic = (manifest: TProteumManifest, diagnostic: TProteumManifestDiagnostic) => {
    const related =
        diagnostic.relatedFilepaths && diagnostic.relatedFilepaths.length > 0
            ? ` related=${diagnostic.relatedFilepaths.map((filepath) => formatFilepath(manifest, filepath)).join(',')}`
            : '';

    return `- [${diagnostic.level}] ${diagnostic.code} ${diagnostic.message} source=${formatFilepath(manifest, diagnostic.filepath)}${formatLocation(diagnostic.sourceLocation?.line, diagnostic.sourceLocation?.column)}${related}`;
};

const printSection = (title: string, lines: string[]) => {
    if (lines.length === 0) return `${title}\n- none`;
    return `${title}\n${lines.join('\n')}`;
};

const renderSummary = (manifest: TProteumManifest) => {
    const errorsCount = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warningsCount = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;
    const lines = [
        `Proteum manifest: ${formatFilepath(manifest, path.join(manifest.app.root, '.proteum', 'manifest.json'))}`,
        `App: ${manifest.app.identity.name} (${manifest.app.identity.identifier})`,
        `Env keys: ${manifest.env.loadedTopLevelKeys.join(', ') || 'none'}`,
        `Services: ${manifest.services.app.length} app, ${manifest.services.routerPlugins.length} router plugins`,
        `Controllers: ${manifest.controllers.length}`,
        `Routes: ${manifest.routes.client.length} client, ${manifest.routes.server.length} server`,
        `Layouts: ${manifest.layouts.length}`,
        `Diagnostics: ${errorsCount} errors, ${warningsCount} warnings`,
        'Use `proteum explain --json` for the full machine-readable manifest or pass section flags like `routes` and `services`.',
    ];

    return lines.join('\n');
};

const renderHuman = (manifest: TProteumManifest, sectionNames: TExplainSectionName[]) => {
    if (sectionNames.length === 0) return renderSummary(manifest);

    const sections: string[] = [];

    for (const sectionName of sectionNames) {
        if (sectionName === 'app') {
            sections.push(
                printSection('App', [
                    `- root=${formatFilepath(manifest, manifest.app.root)}`,
                    `- coreRoot=${formatFilepath(manifest, manifest.app.coreRoot)}`,
                    `- identity=${formatFilepath(manifest, manifest.app.identityFilepath)}`,
                    `- name=${manifest.app.identity.name}`,
                    `- identifier=${manifest.app.identity.identifier}`,
                    `- title=${manifest.app.identity.fullTitle || manifest.app.identity.title || manifest.app.identity.name}`,
                ]),
            );
            continue;
        }

        if (sectionName === 'conventions') {
            sections.push(
                printSection('Conventions', [
                    `- routeSetupOptionKeys=${manifest.conventions.routeSetupOptionKeys.join(', ')}`,
                    `- reservedRouteSetupKeys=${manifest.conventions.reservedRouteSetupKeys.join(', ')}`,
                ]),
            );
            continue;
        }

        if (sectionName === 'env') {
            sections.push(
                printSection('Env', [
                    `- source=${formatFilepath(manifest, manifest.env.sourceFilepath)}`,
                    `- loadedTopLevelKeys=${manifest.env.loadedTopLevelKeys.join(', ') || 'none'}`,
                    `- requiredTopLevelKeys=${manifest.env.requiredTopLevelKeys.join(', ')}`,
                ]),
            );
            continue;
        }

        if (sectionName === 'services') {
            sections.push(
                printSection('App Services', manifest.services.app.map((service) => formatService(manifest, service))),
                printSection(
                    'Router Plugins',
                    manifest.services.routerPlugins.map((service) => formatService(manifest, service)),
                ),
            );
            continue;
        }

        if (sectionName === 'controllers') {
            sections.push(printSection('Controllers', manifest.controllers.map((controller) => formatController(manifest, controller))));
            continue;
        }

        if (sectionName === 'routes') {
            sections.push(
                printSection('Client Routes', manifest.routes.client.map((route) => formatRoute(manifest, route))),
                printSection('Server Routes', manifest.routes.server.map((route) => formatRoute(manifest, route))),
            );
            continue;
        }

        if (sectionName === 'layouts') {
            sections.push(printSection('Layouts', manifest.layouts.map((layout) => formatLayout(manifest, layout))));
            continue;
        }

        if (sectionName === 'diagnostics') {
            sections.push(printSection('Diagnostics', manifest.diagnostics.map((diagnostic) => formatDiagnostic(manifest, diagnostic))));
        }
    }

    return sections.join('\n\n');
};

export const run = async (): Promise<void> => {
    validateExplainArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const selectedSections = getSelectedSections();

    if (cli.args.json === true) {
        console.log(JSON.stringify(pickManifestSections(manifest, selectedSections), null, 2));
        return;
    }

    console.log(renderHuman(manifest, selectedSections));
};
