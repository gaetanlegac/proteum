import fs from 'fs';

import {
    formatManifestFilepath,
    formatManifestLocation,
    renderHumanBlock,
    type THumanTextBlock,
} from './diagnostics';
import type {
    TProteumManifest,
    TProteumManifestController,
    TProteumManifestDiagnostic,
} from './proteumManifest';

export type TConnectProjectController = {
    clientAccessor: string;
    filepath: string;
    hasInput: boolean;
    httpPath: string;
    methodName: string;
};

export type TConnectProjectReport = {
    namespace: string;
    identityIdentifier?: string;
    identityName?: string;
    sourceKind?: string;
    sourceValue?: string;
    sourceConfigured: boolean;
    cachedContractFilepath?: string;
    cachedContractExists: boolean;
    typingMode?: string;
    urlInternalConfigured: boolean;
    urlInternal?: string;
    controllerCount: number;
    controllers?: TConnectProjectController[];
};

export type TConnectResponse = {
    app: {
        identifier: string;
        name: string;
        root: string;
    };
    summary: {
        connectedProjects: number;
        errors: number;
        importedControllers: number;
        strictFailed: boolean;
        warnings: number;
    };
    projects: TConnectProjectReport[];
    diagnostics: TProteumManifestDiagnostic[];
};

const createDiagnostic = ({
    code,
    filepath,
    level = 'error',
    message,
}: {
    code: string;
    filepath: string;
    level?: TProteumManifestDiagnostic['level'];
    message: string;
}): TProteumManifestDiagnostic => ({
    code,
    filepath,
    level,
    message,
});

const sortDiagnostics = (diagnostics: TProteumManifestDiagnostic[]) =>
    [...diagnostics].sort((left, right) => {
        if (left.level !== right.level) return left.level === 'error' ? -1 : 1;
        if (left.filepath !== right.filepath) return left.filepath.localeCompare(right.filepath);
        return left.code.localeCompare(right.code);
    });

const toControllerSummary = (controller: TProteumManifestController): TConnectProjectController => ({
    clientAccessor: controller.clientAccessor,
    filepath: controller.filepath,
    hasInput: controller.hasInput,
    httpPath: controller.httpPath,
    methodName: controller.methodName,
});

const formatControllerItem = (manifest: TProteumManifest, controller: TConnectProjectController) =>
    `${controller.clientAccessor} -> POST ${controller.httpPath} input=${controller.hasInput ? 'yes' : 'no'} source=${formatManifestFilepath(manifest, controller.filepath)}#${controller.methodName}`;

const formatProjectItem = (manifest: TProteumManifest, project: TConnectProjectReport) =>
    `${project.namespace} -> ${project.identityIdentifier || project.identityName || 'unknown'} controllers=${project.controllerCount} sourceConfigured=${project.sourceConfigured ? 'yes' : 'no'} internal=${project.urlInternal || 'missing'} configured=${project.urlInternalConfigured ? 'yes' : 'no'}${project.sourceKind ? ` source=${project.sourceKind}` : ''}${project.sourceValue ? ` sourceValue=${project.sourceValue}` : ''}${project.typingMode ? ` typing=${project.typingMode}` : ''}${project.cachedContractFilepath ? ` contract=${formatManifestFilepath(manifest, project.cachedContractFilepath)}` : ''}${project.cachedContractFilepath ? ` cache=${project.cachedContractExists ? 'present' : 'missing'}` : ''}`;

export const buildConnectResponse = (
    manifest: TProteumManifest,
    options: { includeControllers?: boolean; strict?: boolean } = {},
): TConnectResponse => {
    const diagnostics: TProteumManifestDiagnostic[] = [];
    const projects: TConnectProjectReport[] = manifest.connectedProjects.map((project) => {
        const controllers = manifest.controllers
            .filter((controller) => controller.connectedProjectNamespace === project.namespace)
            .sort((left, right) => left.clientAccessor.localeCompare(right.clientAccessor));
        const sourceConfigured = typeof project.sourceValue === 'string' && project.sourceValue.trim() !== '';
        const urlInternalConfigured = typeof project.urlInternal === 'string' && project.urlInternal.trim() !== '';
        const cachedContractExists = project.cachedContractFilepath ? fs.existsSync(project.cachedContractFilepath) : false;

        if (!sourceConfigured) {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.source-missing',
                    filepath: manifest.app.setupFilepath,
                    message: `Connected project "${project.namespace}" requires connect.${project.namespace}.source in proteum.config.ts during generation.`,
                }),
            );
        }

        if (sourceConfigured && !project.sourceKind) {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.contract-unresolved',
                    filepath: manifest.app.setupFilepath,
                    message: `Connected project "${project.namespace}" does not have a resolved contract source in the manifest.`,
                }),
            );
        }

        if (!project.cachedContractFilepath) {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.contract-cache-missing',
                    filepath: manifest.app.setupFilepath,
                    message: `Connected project "${project.namespace}" has no cached contract filepath in the manifest.`,
                }),
            );
        } else if (!cachedContractExists) {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.contract-cache-missing-on-disk',
                    filepath: project.cachedContractFilepath,
                    message: `Cached connected contract "${project.cachedContractFilepath}" is missing from disk.`,
                }),
            );
        }

        if (!urlInternalConfigured) {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.url-internal-missing',
                    filepath: manifest.app.setupFilepath,
                    message: `Connected project "${project.namespace}" requires connect.${project.namespace}.urlInternal in proteum.config.ts for runtime calls.`,
                }),
            );
        }

        if (project.controllerCount === 0) {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.controllers-empty',
                    filepath: manifest.app.setupFilepath,
                    level: 'warning',
                    message: `Connected project "${project.namespace}" imported zero controllers.`,
                }),
            );
        }

        if (project.sourceKind === 'file' && project.typingMode !== 'local-typed') {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.typing-mode-unexpected',
                    filepath: manifest.app.setupFilepath,
                    level: 'warning',
                    message: `Connected project "${project.namespace}" uses a file source but typing mode is "${project.typingMode || 'unknown'}".`,
                }),
            );
        }

        if (project.sourceKind && project.sourceKind !== 'file' && project.typingMode === 'local-typed') {
            diagnostics.push(
                createDiagnostic({
                    code: 'connect.typing-mode-unexpected',
                    filepath: manifest.app.setupFilepath,
                    level: 'warning',
                    message: `Connected project "${project.namespace}" is non-local but typing mode is "${project.typingMode}".`,
                }),
            );
        }

        return {
            namespace: project.namespace,
            identityIdentifier: project.identityIdentifier,
            identityName: project.identityName,
            sourceKind: project.sourceKind,
            sourceValue: project.sourceValue,
            sourceConfigured,
            cachedContractFilepath: project.cachedContractFilepath,
            cachedContractExists,
            typingMode: project.typingMode,
            urlInternalConfigured,
            urlInternal: project.urlInternal,
            controllerCount: project.controllerCount,
            ...(options.includeControllers === true ? { controllers: controllers.map(toControllerSummary) } : {}),
        };
    });

    const sortedDiagnostics = sortDiagnostics(diagnostics);
    const errors = sortedDiagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warnings = sortedDiagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;

    return {
        app: {
            identifier: manifest.app.identity.identifier,
            name: manifest.app.identity.name,
            root: manifest.app.root,
        },
        summary: {
            connectedProjects: projects.length,
            errors,
            importedControllers: projects.reduce((count, project) => count + project.controllerCount, 0),
            strictFailed: options.strict === true && sortedDiagnostics.length > 0,
            warnings,
        },
        projects,
        diagnostics: sortedDiagnostics,
    };
};

export const renderConnectHuman = (manifest: TProteumManifest, response: TConnectResponse) => {
    const blocks: THumanTextBlock[] = [
        {
            title: 'Proteum Connect',
            items: [
                `app=${response.app.name} (${response.app.identifier})`,
                `root=${formatManifestFilepath(manifest, response.app.root)}`,
                `connectedProjects=${response.summary.connectedProjects}`,
                `importedControllers=${response.summary.importedControllers}`,
                `diagnostics=${response.summary.errors} errors, ${response.summary.warnings} warnings`,
            ],
        },
        {
            title: 'Connected Projects',
            items: response.projects.map((project) => formatProjectItem(manifest, project)),
            empty: 'No connected projects are configured.',
        },
    ];

    const controllerItems = response.projects.flatMap((project) =>
        (project.controllers || []).map((controller) => formatControllerItem(manifest, controller)),
    );

    if (controllerItems.length > 0) {
        blocks.push({
            title: 'Imported Controllers',
            items: controllerItems,
        });
    }

    blocks.push({
        title: 'Diagnostics',
        items: response.diagnostics.map(
            (diagnostic) =>
                `[${diagnostic.level}] ${diagnostic.code} ${diagnostic.message} source=${formatManifestFilepath(manifest, diagnostic.filepath)}${formatManifestLocation(diagnostic.sourceLocation?.line, diagnostic.sourceLocation?.column)}`,
        ),
        empty: 'No connect diagnostics were found.',
    });

    return blocks.map((block) => renderHumanBlock(block)).join('\n\n');
};
