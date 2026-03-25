import cli from '..';
import Compiler from '../compiler';
import { readProteumManifest } from '../compiler/common/proteumManifest';
import {
    explainSectionNames,
    pickExplainManifestSections,
    renderExplainHuman,
    type TExplainSectionName,
} from '@common/dev/diagnostics';

const allowedExplainArgs = new Set(['json', 'all', ...explainSectionNames]);

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

export const run = async (): Promise<void> => {
    validateExplainArgs();

    const compiler = new Compiler('dev');
    await compiler.refreshGeneratedTypings();

    const manifest = readProteumManifest(cli.paths.appRoot);
    const selectedSections = getSelectedSections();

    if (cli.args.json === true) {
        console.log(JSON.stringify(pickExplainManifestSections(manifest, selectedSections), null, 2));
        return;
    }

    console.log(renderExplainHuman(manifest, selectedSections));
};
