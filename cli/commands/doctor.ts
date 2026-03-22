import path from 'path';

import cli from '..';
import Compiler from '../compiler';
import {
    readProteumManifest,
    type TProteumManifest,
    type TProteumManifestDiagnostic,
} from '../compiler/common/proteumManifest';

const allowedDoctorArgs = new Set(['json', 'strict']);

const validateDoctorArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && value === true)
        .map(([name]) => name);

    const invalidArgs = enabledArgs.filter((arg) => !allowedDoctorArgs.has(arg));

    if (invalidArgs.length > 0) {
        throw new Error(
            `Unknown doctor argument(s): ${invalidArgs.join(', ')}. Allowed values: ${[...allowedDoctorArgs].join(', ')}.`,
        );
    }
};

const normalizePath = (value: string) => value.replace(/\\/g, '/');

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

const formatLocation = (diagnostic: TProteumManifestDiagnostic) =>
    diagnostic.sourceLocation ? `:${diagnostic.sourceLocation.line}:${diagnostic.sourceLocation.column}` : '';

const renderGroup = (manifest: TProteumManifest, diagnostics: TProteumManifestDiagnostic[], title: string) => {
    if (diagnostics.length === 0) return `${title}\n- none`;

    return [
        title,
        ...diagnostics.map((diagnostic) => {
            const related =
                diagnostic.relatedFilepaths && diagnostic.relatedFilepaths.length > 0
                    ? ` related=${diagnostic.relatedFilepaths.map((filepath) => formatFilepath(manifest, filepath)).join(',')}`
                    : '';

            return `- ${diagnostic.code} ${diagnostic.message} source=${formatFilepath(manifest, diagnostic.filepath)}${formatLocation(diagnostic)}${related}`;
        }),
    ].join('\n');
};

export const run = async (): Promise<void> => {
    validateDoctorArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const errors = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error');
    const warnings = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning');

    if (cli.args.json === true) {
        console.log(
            JSON.stringify(
                {
                    summary: {
                        errors: errors.length,
                        warnings: warnings.length,
                        strictFailed: cli.args.strict === true && manifest.diagnostics.length > 0,
                    },
                    diagnostics: manifest.diagnostics,
                },
                null,
                2,
            ),
        );
    } else if (manifest.diagnostics.length === 0) {
        console.log('Proteum doctor\n- No manifest diagnostics were found.');
    } else {
        console.log(
            [
                'Proteum doctor',
                `- ${errors.length} errors`,
                `- ${warnings.length} warnings`,
                '',
                renderGroup(manifest, errors, 'Errors'),
                '',
                renderGroup(manifest, warnings, 'Warnings'),
            ].join('\n'),
        );
    }

    if (cli.args.strict === true && manifest.diagnostics.length > 0) {
        throw new Error(`Proteum doctor failed in strict mode with ${errors.length} errors and ${warnings.length} warnings.`);
    }
};
