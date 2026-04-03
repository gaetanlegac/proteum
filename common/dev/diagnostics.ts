import type {
    TProteumManifest,
    TProteumManifestCommand,
    TProteumManifestConnectedProject,
    TProteumManifestController,
    TProteumManifestDiagnostic,
    TProteumManifestLayout,
    TProteumManifestRoute,
    TProteumManifestService,
} from './proteumManifest';

export const explainSectionNames = ['app', 'conventions', 'env', 'connected', 'services', 'controllers', 'commands', 'routes', 'layouts', 'diagnostics'] as const;

export type TExplainSectionName = (typeof explainSectionNames)[number];
export type THumanTextBlock = {
    title: string;
    items: string[];
    empty?: string;
};
export type TDoctorResponse = {
    summary: {
        errors: number;
        warnings: number;
        strictFailed: boolean;
    };
    diagnostics: TProteumManifestDiagnostic[];
};

const normalizePath = (value: string) => value.replace(/\\/g, '/');
const emptyBlock = 'none';

export const formatManifestLocation = (line?: number, column?: number) =>
    line && column ? `:${line}:${column}` : line ? `:${line}` : '';

export const formatManifestFilepath = (manifest: TProteumManifest, filepath: string) => {
    const normalizedFilepath = normalizePath(filepath);
    const normalizedAppRoot = normalizePath(manifest.app.root);
    const normalizedCoreRoot = normalizePath(manifest.app.coreRoot);

    if (normalizedFilepath === normalizedAppRoot) return '.';
    if (normalizedFilepath.startsWith(normalizedAppRoot + '/')) return normalizedFilepath.slice(normalizedAppRoot.length + 1) || '.';

    if (normalizedFilepath === normalizedCoreRoot) return 'node_modules/proteum';
    if (normalizedFilepath.startsWith(normalizedCoreRoot + '/'))
        return `node_modules/proteum/${normalizedFilepath.slice(normalizedCoreRoot.length + 1)}`;

    return normalizedFilepath;
};

const formatServiceItem = (manifest: TProteumManifest, service: TProteumManifestService) => {
    if (service.kind === 'ref') {
        return `${service.registeredName} -> ref ${service.refTo} [${service.parent}]`;
    }

    const source = service.sourceFilepath ? formatManifestFilepath(manifest, service.sourceFilepath) : 'unknown';
    return `${service.registeredName} -> ${service.className || 'unknown'} [${service.scope}] priority=${service.priority} parent=${service.parent} source=${source}`;
};

const formatConnectedProjectItem = (_manifest: TProteumManifest, connectedProject: TProteumManifestConnectedProject) =>
    `${connectedProject.namespace} -> ${connectedProject.identityIdentifier || connectedProject.packageName || 'unknown'} controllers=${connectedProject.controllerCount} internal=${connectedProject.urlInternal || 'missing'}${connectedProject.sourceKind ? ` source=${connectedProject.sourceKind}` : ''}${connectedProject.sourceValue ? ` sourceValue=${connectedProject.sourceValue}` : ' source=missing'}${connectedProject.typingMode ? ` typing=${connectedProject.typingMode}` : ''}${connectedProject.cachedContractFilepath ? ` contract=${formatManifestFilepath(_manifest, connectedProject.cachedContractFilepath)}` : ''}`;

const formatControllerItem = (manifest: TProteumManifest, controller: TProteumManifestController) =>
    `${controller.clientAccessor} -> POST ${controller.httpPath} [${controller.scope}] input=${controller.hasInput ? 'yes' : 'no'}${controller.connectedProjectNamespace ? ` connected=${controller.connectedProjectNamespace}` : ''} source=${formatManifestFilepath(manifest, controller.filepath)}${formatManifestLocation(controller.sourceLocation.line, controller.sourceLocation.column)}#${controller.methodName}`;

const formatCommandItem = (manifest: TProteumManifest, command: TProteumManifestCommand) =>
    `${command.path} -> ${command.className}.${command.methodName} [${command.scope}] source=${formatManifestFilepath(manifest, command.filepath)}${formatManifestLocation(command.sourceLocation.line, command.sourceLocation.column)}`;

const formatRouteTarget = (route: TProteumManifestRoute) => {
    if (route.kind === 'client-error') return route.code !== undefined ? String(route.code) : route.codeRaw || '?';
    return route.path || route.pathRaw || '?';
};

const formatRouteItem = (manifest: TProteumManifest, route: TProteumManifestRoute) => {
    const chunk = route.chunkId ? ` chunk=${route.chunkId}` : '';
    const setup = route.hasSetup ? ' setup=yes' : ' setup=no';
    const options = route.normalizedOptionKeys.length > 0 ? ` options=${route.normalizedOptionKeys.join(',')}` : '';
    const resolution = route.targetResolution !== 'literal' ? ` resolution=${route.targetResolution}` : '';

    return `${route.kind} ${route.methodName} ${formatRouteTarget(route)} [${route.scope}]${chunk}${setup}${options}${resolution} source=${formatManifestFilepath(manifest, route.filepath)}${formatManifestLocation(route.sourceLocation.line, route.sourceLocation.column)}`;
};

const formatLayoutItem = (manifest: TProteumManifest, layout: TProteumManifestLayout) =>
    `${layout.chunkId || 'root'} depth=${layout.depth} [${layout.scope}] source=${formatManifestFilepath(manifest, layout.filepath)}`;

const formatDiagnosticItem = (manifest: TProteumManifest, diagnostic: TProteumManifestDiagnostic) => {
    const related =
        diagnostic.relatedFilepaths && diagnostic.relatedFilepaths.length > 0
            ? ` related=${diagnostic.relatedFilepaths.map((filepath) => formatManifestFilepath(manifest, filepath)).join(',')}`
            : '';
    const fixHint = diagnostic.fixHint ? ` fix=${diagnostic.fixHint}` : '';

    return `[${diagnostic.level}] ${diagnostic.code} ${diagnostic.message} source=${formatManifestFilepath(manifest, diagnostic.filepath)}${formatManifestLocation(diagnostic.sourceLocation?.line, diagnostic.sourceLocation?.column)}${related}${fixHint}`;
};

export const pickExplainManifestSections = (manifest: TProteumManifest, sectionNames: TExplainSectionName[]) => {
    if (sectionNames.length === 0) return manifest;

    const selected: Record<string, unknown> = {};

    for (const sectionName of sectionNames) {
        if (sectionName === 'connected') {
            selected.connectedProjects = manifest.connectedProjects;
            continue;
        }

        selected[sectionName] = manifest[sectionName as keyof TProteumManifest];
    }

    return selected as Partial<TProteumManifest>;
};

export const buildExplainSummaryItems = (manifest: TProteumManifest) => {
    const errorsCount = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warningsCount = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;
    const providedRequiredEnvVariables = manifest.env.requiredVariables.filter((variable) => variable.provided).length;

    return [
        `Proteum manifest: ${formatManifestFilepath(manifest, `${normalizePath(manifest.app.root)}/.proteum/manifest.json`)}`,
        `App: ${manifest.app.identity.name} (${manifest.app.identity.identifier})`,
        `Env vars: ${providedRequiredEnvVariables}/${manifest.env.requiredVariables.length} required provided`,
        `Connected projects: ${manifest.connectedProjects.length}`,
        `Services: ${manifest.services.app.length} app, ${manifest.services.routerPlugins.length} router plugins`,
        `Controllers: ${manifest.controllers.length}`,
        `Commands: ${manifest.commands.length}`,
        `Routes: ${manifest.routes.client.length} client, ${manifest.routes.server.length} server`,
        `Layouts: ${manifest.layouts.length}`,
        `Diagnostics: ${errorsCount} errors, ${warningsCount} warnings`,
        'Use `proteum explain --json` for the full machine-readable manifest or pass section flags like `routes` and `services`.',
    ];
};

export const buildExplainBlocks = (manifest: TProteumManifest, sectionNames: TExplainSectionName[]): THumanTextBlock[] => {
    const blocks: THumanTextBlock[] = [];

    for (const sectionName of sectionNames) {
        if (sectionName === 'app') {
            blocks.push({
                title: 'App',
                items: [
                    `root=${formatManifestFilepath(manifest, manifest.app.root)}`,
                    `coreRoot=${formatManifestFilepath(manifest, manifest.app.coreRoot)}`,
                    `identity=${formatManifestFilepath(manifest, manifest.app.identityFilepath)}`,
                    `setup=${formatManifestFilepath(manifest, manifest.app.setupFilepath)}`,
                    `name=${manifest.app.identity.name}`,
                    `identifier=${manifest.app.identity.identifier}`,
                    `title=${manifest.app.identity.fullTitle || manifest.app.identity.title || manifest.app.identity.name}`,
                    `transpile=${manifest.app.setup.transpile?.join(', ') || 'none'}`,
                    `connect=${Object.keys(manifest.app.setup.connect || {}).join(', ') || 'none'}`,
                ],
            });
            continue;
        }

        if (sectionName === 'conventions') {
            blocks.push({
                title: 'Conventions',
                items: [
                    `routeSetupOptionKeys=${manifest.conventions.routeSetupOptionKeys.join(', ')}`,
                    `reservedRouteSetupKeys=${manifest.conventions.reservedRouteSetupKeys.join(', ')}`,
                ],
            });
            continue;
        }

        if (sectionName === 'env') {
            blocks.push({
                title: 'Env',
                items: [
                    `source=${manifest.env.source}`,
                    `loadedVariableKeys=${manifest.env.loadedVariableKeys.join(', ') || 'none'}`,
                    ...manifest.env.requiredVariables.map(
                        (variable) =>
                            `${variable.key} possibleValues=${variable.possibleValues.join(' | ')} provided=${variable.provided ? 'yes' : 'no'}`,
                    ),
                    `resolved.name=${manifest.env.resolved.name}`,
                    `resolved.profile=${manifest.env.resolved.profile}`,
                    `resolved.routerPort=${manifest.env.resolved.routerPort}`,
                    `resolved.routerCurrentDomain=${manifest.env.resolved.routerCurrentDomain}`,
                    `resolved.routerInternalUrl=${manifest.env.resolved.routerInternalUrl}`,
                ],
            });
            continue;
        }

        if (sectionName === 'connected') {
            blocks.push({
                title: 'Connected Projects',
                items: manifest.connectedProjects.map((connectedProject) => formatConnectedProjectItem(manifest, connectedProject)),
            });
            continue;
        }

        if (sectionName === 'services') {
            blocks.push(
                {
                    title: 'App Services',
                    items: manifest.services.app.map((service) => formatServiceItem(manifest, service)),
                },
                {
                    title: 'Router Plugins',
                    items: manifest.services.routerPlugins.map((service) => formatServiceItem(manifest, service)),
                },
            );
            continue;
        }

        if (sectionName === 'controllers') {
            blocks.push({
                title: 'Controllers',
                items: manifest.controllers.map((controller) => formatControllerItem(manifest, controller)),
            });
            continue;
        }

        if (sectionName === 'commands') {
            blocks.push({
                title: 'Commands',
                items: manifest.commands.map((command) => formatCommandItem(manifest, command)),
            });
            continue;
        }

        if (sectionName === 'routes') {
            blocks.push(
                {
                    title: 'Client Routes',
                    items: manifest.routes.client.map((route) => formatRouteItem(manifest, route)),
                },
                {
                    title: 'Server Routes',
                    items: manifest.routes.server.map((route) => formatRouteItem(manifest, route)),
                },
            );
            continue;
        }

        if (sectionName === 'layouts') {
            blocks.push({
                title: 'Layouts',
                items: manifest.layouts.map((layout) => formatLayoutItem(manifest, layout)),
            });
            continue;
        }

        if (sectionName === 'diagnostics') {
            blocks.push({
                title: 'Diagnostics',
                items: manifest.diagnostics.map((diagnostic) => formatDiagnosticItem(manifest, diagnostic)),
            });
        }
    }

    return blocks;
};

export const renderHumanBlock = (block: THumanTextBlock) => {
    if (block.items.length === 0) return `${block.title}\n- ${block.empty || emptyBlock}`;
    return `${block.title}\n${block.items.map((item) => `- ${item}`).join('\n')}`;
};

export const renderExplainHuman = (manifest: TProteumManifest, sectionNames: TExplainSectionName[]) => {
    if (sectionNames.length === 0) return buildExplainSummaryItems(manifest).join('\n');
    return buildExplainBlocks(manifest, sectionNames).map(renderHumanBlock).join('\n\n');
};

export const buildDoctorResponse = (manifest: TProteumManifest, strict = false): TDoctorResponse => {
    const errors = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error');
    const warnings = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning');

    return {
        summary: {
            errors: errors.length,
            warnings: warnings.length,
            strictFailed: strict === true && manifest.diagnostics.length > 0,
        },
        diagnostics: manifest.diagnostics,
    };
};

export const buildDoctorBlocksFromDiagnostics = (
    manifest: TProteumManifest,
    diagnostics: TProteumManifestDiagnostic[],
): THumanTextBlock[] => {
    const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error');
    const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning');

    return [
        {
            title: 'Errors',
            items: errors.map((diagnostic) => {
                const related =
                    diagnostic.relatedFilepaths && diagnostic.relatedFilepaths.length > 0
                        ? ` related=${diagnostic.relatedFilepaths.map((filepath) => formatManifestFilepath(manifest, filepath)).join(',')}`
                        : '';
                const fixHint = diagnostic.fixHint ? ` fix=${diagnostic.fixHint}` : '';

                return `${diagnostic.code} ${diagnostic.message} source=${formatManifestFilepath(manifest, diagnostic.filepath)}${formatManifestLocation(diagnostic.sourceLocation?.line, diagnostic.sourceLocation?.column)}${related}${fixHint}`;
            }),
        },
        {
            title: 'Warnings',
            items: warnings.map((diagnostic) => {
                const related =
                    diagnostic.relatedFilepaths && diagnostic.relatedFilepaths.length > 0
                        ? ` related=${diagnostic.relatedFilepaths.map((filepath) => formatManifestFilepath(manifest, filepath)).join(',')}`
                        : '';
                const fixHint = diagnostic.fixHint ? ` fix=${diagnostic.fixHint}` : '';

                return `${diagnostic.code} ${diagnostic.message} source=${formatManifestFilepath(manifest, diagnostic.filepath)}${formatManifestLocation(diagnostic.sourceLocation?.line, diagnostic.sourceLocation?.column)}${related}${fixHint}`;
            }),
        },
    ];
};

export const buildDoctorBlocks = (manifest: TProteumManifest) => buildDoctorBlocksFromDiagnostics(manifest, manifest.diagnostics);

export const renderDoctorResponseHuman = ({
    manifest,
    response,
    title,
    emptyMessage,
}: {
    manifest: TProteumManifest;
    response: TDoctorResponse;
    title: string;
    emptyMessage?: string;
}) => {
    if (response.diagnostics.length === 0) return `${title}\n- ${emptyMessage || 'No manifest diagnostics were found.'}`;

    return [
        title,
        `- ${response.summary.errors} errors`,
        `- ${response.summary.warnings} warnings`,
        '',
        ...buildDoctorBlocksFromDiagnostics(manifest, response.diagnostics).map(renderHumanBlock),
    ].join('\n');
};

export const renderDoctorHuman = (manifest: TProteumManifest, strict = false) =>
    renderDoctorResponseHuman({
        emptyMessage: 'No manifest diagnostics were found.',
        manifest,
        response: buildDoctorResponse(manifest, strict),
        title: 'Proteum doctor',
    });
