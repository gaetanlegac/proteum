import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import {
    buildExplainSummaryItems,
    explainSectionNames,
    pickExplainManifestSections,
    renderExplainHuman,
    type TExplainSectionName,
} from '@common/dev/diagnostics';
import { explainOwner } from '@common/dev/inspection';
import { compactList, printAgentResponse, printJson, quoteCommandArgument } from '../utils/agentOutput';

const allowedExplainArgs = new Set(['json', 'all', 'full', 'human', 'manifest', ...explainSectionNames]);

const validateExplainArgs = () => {
    const enabledArgs = Object.entries(cli.args)
        .filter(([name, value]) => name !== 'workdir' && name !== 'verbose' && value === true)
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

const compactOwnerMatch = (match: ReturnType<typeof explainOwner>['matches'][number]) => ({
    kind: match.kind,
    label: match.label,
    score: match.score,
    scope: match.scopeLabel,
    origin: match.originHint,
    source: match.source,
});

const hasExplicitDetailSelection = (selectedSections: TExplainSectionName[]) =>
    cli.args.full === true || cli.args.manifest === true || cli.args.all === true || selectedSections.length > 0;

const printCompactOwner = (ownerQuery: string, response: ReturnType<typeof explainOwner>) => {
    const topOwner = response.matches[0];

    printAgentResponse({
        summary: topOwner
            ? `${ownerQuery} -> ${topOwner.kind} ${topOwner.label} (${topOwner.scopeLabel})`
            : `${ownerQuery} -> no manifest owner matched`,
        data: {
            query: ownerQuery,
            normalizedQuery: response.normalizedQuery,
            top: topOwner ? compactOwnerMatch(topOwner) : undefined,
            matches: compactList(response.matches, 6).map(compactOwnerMatch),
            totalReturned: response.matches.length,
        },
        nextActions: [
            {
                label: 'Orient',
                command: `proteum orient ${quoteCommandArgument(ownerQuery)}`,
                reason: 'Resolve the owner together with the relevant instruction files and next command.',
            },
        ],
        fullDetailCommand: `proteum explain owner ${quoteCommandArgument(ownerQuery)} --full`,
    });
};

const printCompactExplain = (manifest: ReturnType<typeof readProteumManifest>) => {
    const errors = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'error').length;
    const warnings = manifest.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length;
    const requiredEnvProvided = manifest.env.requiredVariables.filter((variable) => variable.provided).length;

    printAgentResponse({
        summary: `${manifest.app.identity.identifier}: ${manifest.controllers.length} controllers, ${manifest.routes.client.length + manifest.routes.server.length} routes, ${errors} errors, ${warnings} warnings`,
        data: {
            app: {
                root: manifest.app.root,
                coreRoot: manifest.app.coreRoot,
                identifier: manifest.app.identity.identifier,
                name: manifest.app.identity.name,
            },
            counts: {
                commands: manifest.commands.length,
                connectedProjects: manifest.connectedProjects.length,
                controllers: manifest.controllers.length,
                diagnostics: manifest.diagnostics.length,
                layouts: manifest.layouts.length,
                routesClient: manifest.routes.client.length,
                routesServer: manifest.routes.server.length,
                servicesApp: manifest.services.app.length,
                servicesRouterPlugins: manifest.services.routerPlugins.length,
            },
            diagnostics: { errors, warnings },
            env: {
                requiredProvided: requiredEnvProvided,
                requiredTotal: manifest.env.requiredVariables.length,
                routerPort: manifest.env.resolved.routerPort,
            },
            summaryItems: buildExplainSummaryItems(manifest),
        },
        nextActions: [
            {
                label: 'Orient Target',
                command: 'proteum orient <route|file|controller|error>',
                reason: 'Use orient for task-specific owner, instruction, and next-command routing.',
            },
        ],
        fullDetailCommand: 'proteum explain --manifest',
        omitted: [
            {
                reason: 'Full manifest sections are omitted from the default agent summary.',
                command: 'proteum explain --manifest',
            },
        ],
    });
};

export const run = async (): Promise<void> => {
    validateExplainArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const ownerQuery = typeof cli.args.ownerQuery === 'string' ? cli.args.ownerQuery.trim() : '';

    if (ownerQuery) {
        const response = explainOwner(manifest, ownerQuery);
        if (cli.args.full === true || cli.args.manifest === true) {
            printJson(response);
            return;
        }

        if (cli.args.human !== true) {
            printCompactOwner(ownerQuery, response);
            return;
        }

        console.log(
            [
                'Proteum explain owner',
                `- query=${ownerQuery}`,
                ...(response.matches.length === 0
                    ? ['- No matching manifest owners were found.']
                    : response.matches.map(
                          (match) =>
                              `- [${match.kind}] ${match.label} score=${match.score} scope=${match.scopeLabel} origin=${match.originHint} source=${match.source.filepath}${match.source.line ? `:${match.source.line}` : ''}${match.source.column ? `:${match.source.column}` : ''}`,
                      )),
            ].join('\n'),
        );
        return;
    }

    const selectedSections = getSelectedSections();

    if (hasExplicitDetailSelection(selectedSections)) {
        printJson(pickExplainManifestSections(manifest, cli.args.manifest === true ? [...explainSectionNames] : selectedSections));
        return;
    }

    if (cli.args.human === true) {
        console.log(renderExplainHuman(manifest, selectedSections));
        return;
    }

    printCompactExplain(manifest);
};
