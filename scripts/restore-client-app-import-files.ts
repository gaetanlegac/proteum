import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

const repoRoots = process.argv.slice(2);
if (!repoRoots.length)
    throw new Error('Usage: ts-node scripts/restore-client-app-import-files.ts <repo-root> [repo-root...]');

for (const repoRoot of repoRoots) {
    const diffOutput = execFileSync(
        'git',
        ['-C', repoRoot, 'diff', '--name-only', 'HEAD', '--', 'client/components', 'client/hooks'],
        { encoding: 'utf8' },
    );
    const currentDiffFiles = diffOutput
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const grepOutput = execFileSync(
        'git',
        ['-C', repoRoot, 'grep', '-l', `from '@app'\\|from "@app"`, 'HEAD', '--', 'client'],
        { encoding: 'utf8' },
    );
    const headAppImportFiles = new Set(
        grepOutput
            .split('\n')
            .map((line) => line.trim().replace(/^HEAD:/, ''))
            .filter((line) => line.startsWith('client/components/') || line.startsWith('client/hooks/')),
    );

    const filesToRestore = currentDiffFiles.filter((filepath) => headAppImportFiles.has(filepath));

    for (const relativeFile of filesToRestore) {
        const nextContent = execFileSync('git', ['-C', repoRoot, 'show', `HEAD:${relativeFile}`], { encoding: 'utf8' });
        const filepath = path.join(repoRoot, relativeFile);
        fs.ensureDirSync(path.dirname(filepath));
        fs.writeFileSync(filepath, nextContent);
        console.log(`[restore-client-app-import-files] restored ${filepath}`);
    }
}
