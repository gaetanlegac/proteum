import fs from 'fs';
import path from 'path';

import app from '../../app';
import cli from '../..';
import { inspectProteumEnv } from '../../../common/env/proteumEnv';
import { reservedRouteOptionKeys, routeOptionKeys } from '../../../common/router/pageData';
import {
    TProteumManifest,
    TProteumManifestCommand,
    TProteumManifestConnectedProject,
    TProteumManifestController,
    TProteumManifestDiagnostic,
    TProteumManifestLayout,
    TProteumManifestRoute,
} from '../common/proteumManifest';
import { writeProteumManifest } from '../common/proteumManifest';
import { normalizeAbsolutePath, normalizePath } from './shared';
import type { TResolvedConnectedProjectContract } from './connectedProjects';

const requiredGitignoreEntries = [
    '/.proteum',
    '/bin',
    '/dev',
    '/.cache',
    '/var',
    '/proteum.connected.json',
] as const;

const normalizeGitignoreEntry = (value: string) => value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

const collectManifestDiagnostics = ({
    commands,
    controllers,
    routes,
}: {
    commands: TProteumManifestCommand[];
    controllers: TProteumManifestController[];
    routes: TProteumManifest['routes'];
}) => {
    const diagnostics: TProteumManifestDiagnostic[] = [];
    const expectedGitignoreEntries = [...requiredGitignoreEntries];

    const pushDiagnostic = (diagnostic: TProteumManifestDiagnostic) => {
        diagnostics.push(diagnostic);
    };

    const createDuplicateDiagnostics = <
        TEntry extends { filepath: string; sourceLocation?: { line: number; column: number } },
    >(
        entries: TEntry[],
        {
            code,
            level,
            message,
        }: {
            code: string;
            level: TProteumManifestDiagnostic['level'];
            message: (entry: TEntry, others: TEntry[]) => string;
        },
    ) => {
        if (entries.length < 2) return;

        for (const entry of entries) {
            pushDiagnostic({
                level,
                code,
                message: message(
                    entry,
                    entries.filter((candidate) => candidate !== entry),
                ),
                filepath: entry.filepath,
                sourceLocation: entry.sourceLocation,
                relatedFilepaths: entries.filter((candidate) => candidate !== entry).map((candidate) => candidate.filepath),
            });
        }
    };

    const trackDuplicates = <TEntry extends { filepath: string; sourceLocation?: { line: number; column: number } }>(
        entries: TEntry[],
        getKey: (entry: TEntry) => string | undefined,
        config: {
            code: string;
            level: TProteumManifestDiagnostic['level'];
            message: (entry: TEntry, others: TEntry[]) => string;
        },
    ) => {
        const groups = new Map<string, TEntry[]>();

        for (const entry of entries) {
            const key = getKey(entry);
            if (!key) continue;

            const group = groups.get(key) || [];
            group.push(entry);
            groups.set(key, group);
        }

        for (const group of groups.values()) {
            createDuplicateDiagnostics(group, config);
        }
    };

    for (const route of [...routes.client, ...routes.server]) {
        if (route.targetResolution === 'dynamic-expression') {
            pushDiagnostic({
                level: 'warning',
                code: 'route.dynamic-target',
                message:
                    route.kind === 'client-error'
                        ? `Proteum could not resolve this error code statically. Prefer a numeric literal or a const-only expression.`
                        : `Proteum could not resolve this route path statically. Prefer a string literal or a const-only expression.`,
                filepath: route.filepath,
                sourceLocation: route.sourceLocation,
            });
        }

        for (const optionKey of route.invalidOptionKeys) {
            pushDiagnostic({
                level: 'error',
                code: 'route.invalid-option-key',
                message: `"${optionKey}" is not a supported Router option key.`,
                filepath: route.filepath,
                sourceLocation: route.sourceLocation,
            });
        }

        for (const optionKey of route.reservedOptionKeys) {
            pushDiagnostic({
                level: 'error',
                code: 'route.reserved-option-key',
                message: `"${optionKey}" is a reserved Router option key and cannot be set explicitly.`,
                filepath: route.filepath,
                sourceLocation: route.sourceLocation,
            });
        }
    }

    trackDuplicates(routes.client.filter((route) => route.kind === 'client-page'), (route) => route.path, {
        code: 'route.duplicate-client-path',
        level: 'warning',
        message: (route, others) =>
            `Duplicate client page path "${(route as TProteumManifestRoute).path}" also registered in ${others
                .map((other) => normalizePath(path.relative(app.paths.root, other.filepath)))
                .join(', ')}.`,
    });

    trackDuplicates(
        routes.client.filter((route) => route.kind === 'client-error'),
        (route) => (typeof route.code === 'number' ? String(route.code) : undefined),
        {
            code: 'route.duplicate-client-error',
            level: 'warning',
            message: (route, others) =>
                `Duplicate client error code "${(route as TProteumManifestRoute).code}" also registered in ${others
                    .map((other) => normalizePath(path.relative(app.paths.root, other.filepath)))
                    .join(', ')}.`,
        },
    );

    trackDuplicates(
        routes.server,
        (route) => (route.path ? `${route.methodName}:${route.path}` : undefined),
        {
            code: 'route.duplicate-server-route',
            level: 'warning',
            message: (route, others) =>
                `Duplicate server route "${(route as TProteumManifestRoute).methodName.toUpperCase()} ${(route as TProteumManifestRoute).path}" also registered in ${others
                    .map((other) => normalizePath(path.relative(app.paths.root, other.filepath)))
                    .join(', ')}.`,
        },
    );

    trackDuplicates(controllers, (controller) => controller.clientAccessor, {
        code: 'controller.duplicate-client-accessor',
        level: 'error',
        message: (controller, others) =>
            `Duplicate controller accessor "${controller.clientAccessor}" also registered in ${others
                .map((other) => normalizePath(path.relative(app.paths.root, other.filepath)))
                .join(', ')}.`,
    });

    trackDuplicates(controllers, (controller) => controller.httpPath, {
        code: 'controller.duplicate-http-path',
        level: 'error',
        message: (controller, others) =>
            `Duplicate controller HTTP path "${controller.httpPath}" also registered in ${others
                .map((other) => normalizePath(path.relative(app.paths.root, other.filepath)))
                .join(', ')}.`,
    });

    trackDuplicates(commands, (command) => command.path, {
        code: 'command.duplicate-path',
        level: 'error',
        message: (command, others) =>
            `Duplicate command path "${command.path}" also registered in ${others
                .map((other) => normalizePath(path.relative(app.paths.root, other.filepath)))
                .join(', ')}.`,
    });

    const postServerRoutesByPath = new Map(
        routes.server
            .filter((route) => route.methodName === 'post' && !!route.path)
            .map((route) => [route.path as string, route]),
    );

    for (const controller of controllers) {
        const matchingRoute = postServerRoutesByPath.get(controller.httpPath);

        if (!matchingRoute) continue;

        pushDiagnostic({
            level: 'error',
            code: 'controller.server-route-collision',
            message: `Controller path "${controller.httpPath}" collides with an explicit POST server route.`,
            filepath: controller.filepath,
            sourceLocation: controller.sourceLocation,
            relatedFilepaths: [matchingRoute.filepath],
        });
    }

    const gitignoreFilepath = path.join(app.paths.root, '.gitignore');

    if (!fs.existsSync(gitignoreFilepath)) {
        pushDiagnostic({
            level: 'warning',
            code: 'app.gitignore-missing',
            message: `Missing .gitignore. Proteum-managed paths should ignore ${expectedGitignoreEntries.join(', ')}.`,
            filepath: gitignoreFilepath,
        });
    } else {
        const entries = new Set(
            fs.readFileSync(gitignoreFilepath, 'utf8')
                .split(/\r?\n/)
                .map((line) => line.replace(/#.*/, '').trim())
                .filter(Boolean)
                .map(normalizeGitignoreEntry),
        );

        for (const requiredEntry of expectedGitignoreEntries) {
            const normalizedRequiredEntry = normalizeGitignoreEntry(requiredEntry);
            if (entries.has(normalizedRequiredEntry)) continue;

            pushDiagnostic({
                level: 'warning',
                code: 'app.gitignore-generated-entry-missing',
                message: `Add "${requiredEntry}" to .gitignore so Proteum-managed paths stay untracked.`,
                filepath: gitignoreFilepath,
            });
        }
    }

    return diagnostics.sort((a, b) => {
        if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
        if (a.filepath !== b.filepath) return a.filepath.localeCompare(b.filepath);
        if ((a.sourceLocation?.line || 0) !== (b.sourceLocation?.line || 0)) {
            return (a.sourceLocation?.line || 0) - (b.sourceLocation?.line || 0);
        }
        return a.code.localeCompare(b.code);
    });
};

export const writeCurrentProteumManifest = ({
    services,
    connectedProjects: resolvedConnectedProjects,
    controllers,
    commands,
    routes,
    layouts,
}: {
    services: TProteumManifest['services'];
    connectedProjects: TResolvedConnectedProjectContract[];
    controllers: TProteumManifestController[];
    commands: TProteumManifestCommand[];
    routes: TProteumManifest['routes'];
    layouts: TProteumManifestLayout[];
}) => {
    const envInspection = inspectProteumEnv(app.paths.root, app.connectedProjects);
    const connectedProjects: TProteumManifestConnectedProject[] = Object.entries(app.connectedProjects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([namespace, config]) => {
            const connectedControllers = controllers.filter((controller) => controller.connectedProjectNamespace === namespace);
            const connectedEnv = app.env.connectedProjects[namespace];
            const resolvedConnectedProject = resolvedConnectedProjects.find((connectedProject) => connectedProject.namespace === namespace);
            const contract = resolvedConnectedProject?.contract;

            return {
                namespace,
                packageName: contract?.packageName,
                identityIdentifier: contract?.identity.identifier || connectedControllers[0]?.connectedProjectIdentifier,
                identityName: contract?.identity.name,
                sourceKind: resolvedConnectedProject?.sourceKind,
                sourceValue: resolvedConnectedProject?.sourceValue || config.source,
                cachedContractFilepath: resolvedConnectedProject?.cachedContractFilepath,
                typingMode: resolvedConnectedProject?.typingMode,
                urlInternal: connectedEnv?.urlInternal || config.urlInternal,
                controllerCount: connectedControllers.length,
            };
        });

    const manifest: TProteumManifest = {
        version: 10,
        app: {
            root: normalizeAbsolutePath(app.paths.root),
            coreRoot: normalizeAbsolutePath(cli.paths.core.root),
            identityFilepath: normalizeAbsolutePath(path.join(app.paths.root, 'identity.config.ts')),
            setupFilepath: normalizeAbsolutePath(path.join(app.paths.root, 'proteum.config.ts')),
            identity: {
                name: app.identity.name,
                identifier: app.identity.identifier,
                description: app.identity.description,
                language: app.identity.language,
                locale: app.identity.locale,
                title: app.identity.web?.title,
                titleSuffix: app.identity.web?.titleSuffix,
                fullTitle: app.identity.web?.fullTitle,
                webDescription: app.identity.web?.description,
                version: app.identity.web?.version,
            },
            setup: {
                transpile: app.transpile.length > 0 ? [...app.transpile] : undefined,
                connect:
                    Object.keys(app.connectedProjects).length > 0
                        ? Object.fromEntries(
                              Object.entries(app.connectedProjects).map(([namespace, config]) => [
                                  namespace,
                                  {
                                      ...(config.source ? { source: config.source } : {}),
                                      ...(config.urlInternal ? { urlInternal: config.urlInternal } : {}),
                                  },
                              ]),
                          )
                        : undefined,
            },
        },
        conventions: {
            routeOptionKeys: [...routeOptionKeys],
            reservedRouteOptionKeys: [...reservedRouteOptionKeys],
        },
        env: {
            source: 'process.env',
            loadedVariableKeys: envInspection.loadedVariableKeys,
            requiredVariables: envInspection.requiredVariables.map((variable) => ({
                key: variable.key,
                possibleValues: [...variable.possibleValues],
                provided: variable.provided,
            })),
            resolved: {
                name: app.env.name,
                profile: app.env.profile,
                routerPort: app.env.router.port,
                routerCurrentDomain: app.env.router.currentDomain,
                routerInternalUrl: app.env.router.internalUrl,
            },
        },
        connectedProjects,
        services,
        controllers,
        commands,
        routes,
        layouts,
        diagnostics: collectManifestDiagnostics({ commands, controllers, routes }),
    };

    writeProteumManifest(app.paths.root, manifest);
};
