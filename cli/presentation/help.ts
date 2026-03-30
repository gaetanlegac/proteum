import { renderRows, wrapText } from './layout';
import {
    getInitAvailabilityNote,
    isLikelyProteumAppRoot,
    proteumCommandGroups,
    proteumCommandNames,
    proteumCommands,
    proteumRecommendedFlow,
    type TProteumCommandName,
} from './commands';
import { renderSection, renderTitle } from './ink';

type TCommandDefinition = {
    options: Array<{
        preferredName: string;
        definition: string;
        description?: string;
        required: boolean;
    }>;
} | null;

type THelpRequest =
    | { kind: 'none' }
    | { kind: 'overview' }
    | { kind: 'command'; commandName: TProteumCommandName };

const commandNameSet = new Set<TProteumCommandName>(proteumCommandNames);

const renderExamples = (examples: Array<{ description: string; command: string }>) =>
    examples
        .map((example) =>
            [
                `  ${example.command}`,
                wrapText(example.description, { indent: '      ', nextIndent: '      ' }),
            ].join('\n'),
        )
        .join('\n');

const renderNotes = (notes: string[]) =>
    notes.map((note) => wrapText(note, { indent: '  - ', nextIndent: '    ' })).join('\n');

const renderOptions = (definition: TCommandDefinition) => {
    if (!definition || definition.options.length === 0) return '  This command has no options.';

    return renderRows(
        definition.options.map((option) => ({
            label: option.definition,
            value: option.description || 'No description.',
        })),
        { minLabelWidth: 18, maxLabelWidth: 34 },
    );
};

export const resolveCustomHelpRequest = (argv: string[]): THelpRequest => {
    if (argv.length === 0) return { kind: 'overview' };
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help')) return { kind: 'overview' };

    if (argv[0] === 'help' && commandNameSet.has(argv[1] as TProteumCommandName))
        return { kind: 'command', commandName: argv[1] as TProteumCommandName };

    if (commandNameSet.has(argv[0] as TProteumCommandName) && argv.some((arg) => arg === '--help' || arg === '-h'))
        return { kind: 'command', commandName: argv[0] as TProteumCommandName };

    return { kind: 'none' };
};

export const renderCliOverview = async ({
    version,
    workdir,
    initAvailable,
}: {
    version: string;
    workdir: string;
    initAvailable: boolean;
}) => {
    const sections: string[] = [];

    sections.push(
        await renderTitle(
            `PROTEUM ${version}`,
            'Explicit SSR / SEO / TypeScript framework for agent-friendly apps.',
        ),
    );

    sections.push(
        await renderSection(
            'Recommended flow',
            renderRows(proteumRecommendedFlow, { minLabelWidth: 24, maxLabelWidth: 24 }),
        ),
    );

    const groupedCommands = await Promise.all(
        proteumCommandGroups.map(async (group) =>
            renderSection(
                group.title,
                renderRows(
                    group.names.map((name) => {
                        const command = proteumCommands[name];
                        const initNote = name === 'init' ? ` ${getInitAvailabilityNote(initAvailable)}` : '';
                        const status = command.status === 'experimental' ? ' Experimental.' : '';

                        return {
                            label: command.name === 'init' ? command.usage : `proteum ${command.name}`,
                            value: `${command.summary}${status}${initNote}`,
                        };
                    }),
                    { minLabelWidth: 18, maxLabelWidth: 24 },
                ),
            ),
        ),
    );

    sections.push(groupedCommands.join('\n\n'));

    if (!isLikelyProteumAppRoot(workdir)) {
        sections.push(
            await renderSection(
                'Context',
                renderRows([
                    { label: 'current directory', value: workdir },
                    {
                        label: 'note',
                        value: 'This directory does not look like a Proteum app root. Run dev, refresh, build, check, doctor, and explain inside an app where `client/` and `server/` exist.',
                    },
                ]),
            ),
        );
    }

    sections.push(
        await renderSection(
            'Next',
            [
                wrapText('Run `proteum <command> --help` or `proteum help <command>` for full options and examples.', {
                    indent: '  ',
                    nextIndent: '  ',
                }),
                wrapText('Every Proteum CLI invocation prints the welcome banner. `proteum dev` is the only command that clears the interactive terminal before rendering its session UI.', {
                    indent: '  ',
                    nextIndent: '  ',
                }),
                wrapText('Legacy single-dash flags and positional booleans remain accepted for older app scripts, but new docs should prefer modern long flags.', {
                    indent: '  ',
                    nextIndent: '  ',
                }),
                wrapText('Add `--verbose` when you want compiler internals, watch-cycle chatter, and framework setup logs.', {
                    indent: '  ',
                    nextIndent: '  ',
                }),
            ].join('\n'),
        ),
    );

    return `${sections.join('\n\n')}\n`;
};

export const renderCommandHelp = async ({
    commandName,
    definition,
    workdir,
    initAvailable,
}: {
    commandName: TProteumCommandName;
    definition: TCommandDefinition;
    workdir: string;
    initAvailable: boolean;
}) => {
    const command = proteumCommands[commandName];
    const sections: string[] = [];
    const notes = [...(command.notes ?? [])];

    if (commandName === 'init') notes.push(getInitAvailabilityNote(initAvailable));
    if (commandName !== 'init' && !isLikelyProteumAppRoot(workdir)) {
        notes.push(
            'This command expects to run inside a Proteum app root. The current directory does not contain the usual `client/` and `server/` folders.',
        );
    }

    sections.push(await renderTitle(`PROTEUM ${command.name.toUpperCase()}`, command.summary));
    sections.push(await renderSection('Usage', `  ${command.usage}`));
    sections.push(
        await renderSection(
            'Category',
            wrapText(`${command.category}${command.status === 'experimental' ? ' · experimental' : ''}`, {
                indent: '  ',
                nextIndent: '  ',
            }),
        ),
    );
    sections.push(await renderSection('Best for', wrapText(command.bestFor, { indent: '  ', nextIndent: '  ' })));
    sections.push(await renderSection('Options', renderOptions(definition)));
    sections.push(await renderSection('Examples', renderExamples(command.examples)));

    if (notes.length > 0) sections.push(await renderSection('Notes', renderNotes(notes)));

    return `${sections.join('\n\n')}\n`;
};
