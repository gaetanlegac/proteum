import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
if (args.length < 2)
    throw new Error(
        'Usage: ts-node scripts/restore-files-from-git-head.ts <repo-root> <relative-file> [relative-file...]',
    );

const [repoRoot, ...relativeFiles] = args;

for (const relativeFile of relativeFiles) {
    const nextContent = execFileSync('git', ['-C', repoRoot, 'show', `HEAD:${relativeFile}`], { encoding: 'utf8' });

    const filepath = path.join(repoRoot, relativeFile);
    fs.ensureDirSync(path.dirname(filepath));
    fs.writeFileSync(filepath, nextContent);
    console.log(`[restore-files-from-git-head] restored ${filepath}`);
}
