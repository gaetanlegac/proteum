import path from 'path';

import cli from '..';
import { runPageContractMigration } from '../migrate/pageContract';

const printHuman = (summary: ReturnType<typeof runPageContractMigration>) => {
    console.log(`Proteum migrate page-contract`);
    console.log(`App root: ${summary.appRoot}`);
    console.log(`Scanned files: ${summary.scannedFiles}`);
    console.log(`Changed files: ${summary.changedFiles.length}${summary.dryRun ? ' (dry run)' : ''}`);

    if (summary.changedFiles.length > 0) {
        console.log('');
        console.log('Rewritten files:');
        for (const filepath of summary.changedFiles) {
            console.log(`- ${path.relative(summary.appRoot, filepath)}`);
        }
    }

    if (summary.manualFixes.length > 0) {
        console.log('');
        console.log('Manual fixes required:');
        for (const fix of summary.manualFixes) {
            console.log(
                `- ${path.relative(summary.appRoot, fix.filepath)}:${fix.line}:${fix.column} ${fix.routeLabel} :: ${fix.reason}`,
            );
        }
    }
};

export const run = async (): Promise<void> => {
    const action = String(cli.args.action || '').trim();
    if (action !== 'page-contract') {
        throw new Error(`Unsupported migrate action "${action}". Expected "page-contract".`);
    }

    const summary = runPageContractMigration({
        appRoot: String(cli.args.workdir || process.cwd()),
        dryRun: cli.args.dryRun === true,
    });

    if (cli.args.json === true) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        printHuman(summary);
    }

    if (summary.manualFixes.length > 0) {
        throw new Error(`Page-contract migration requires manual fixes in ${summary.manualFixes.length} location(s).`);
    }
};
