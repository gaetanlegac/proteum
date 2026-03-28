import fs from 'fs';
import path from 'path';

import type { TDoctorResponse } from './diagnostics';
import type {
    TProteumManifest,
    TProteumManifestDiagnostic,
} from './proteumManifest';

const buildGeneratedArtifactList = (manifest: TProteumManifest) => {
    const appRoot = manifest.app.root;
    const clientRouteModulesRoot = path.join(appRoot, '.proteum', 'client', 'route-modules');
    const serverRouteModulesRoot = path.join(appRoot, '.proteum', 'server', 'route-modules');
    const generated = new Set<string>([
        path.join(appRoot, '.proteum', 'manifest.json'),
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
    relatedFilepaths,
}: {
    code: string;
    filepath: string;
    level?: TProteumManifestDiagnostic['level'];
    message: string;
    relatedFilepaths?: string[];
}): TProteumManifestDiagnostic => ({
    code,
    filepath,
    level,
    message,
    ...(relatedFilepaths && relatedFilepaths.length > 0 ? { relatedFilepaths } : {}),
});

export const buildContractsDoctorResponse = (manifest: TProteumManifest, strict = false): TDoctorResponse => {
    const diagnostics: TProteumManifestDiagnostic[] = [];
    const sourceFilepaths = new Set<string>([
        manifest.app.identityFilepath,
        ...manifest.controllers.map((controller) => controller.filepath),
        ...manifest.commands.map((command) => command.filepath),
        ...manifest.routes.client.map((route) => route.filepath),
        ...manifest.routes.server.map((route) => route.filepath),
        ...manifest.layouts.map((layout) => layout.filepath),
        ...manifest.services.app.flatMap((service) => [service.metasFilepath, service.sourceDir].filter(Boolean) as string[]),
        ...manifest.services.routerPlugins.flatMap((service) => [service.metasFilepath, service.sourceDir].filter(Boolean) as string[]),
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
