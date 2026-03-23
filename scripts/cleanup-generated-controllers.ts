import fs from 'fs-extra';
import path from 'path';

const findControllerFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findControllerFiles(filepath));
            continue;
        }

        if (dirent.isFile() && /\.(tsx?|jsx?)$/.test(dirent.name) && !dirent.name.endsWith('.d.ts')) files.push(filepath);
    }

    return files;
};

const repoRoots = process.argv.slice(2);
if (!repoRoots.length)
    throw new Error('Usage: ts-node scripts/cleanup-generated-controllers.ts <repo-root> [repo-root...]');

for (const repoRoot of repoRoots) {
    const controllerFiles = findControllerFiles(path.join(repoRoot, 'server', 'controllers'));
    let updated = 0;

    for (const controllerFile of controllerFiles) {
        let content = fs.readFileSync(controllerFile, 'utf8');
        let changed = false;

        if (
            content.includes('this.input(schema.') &&
            content.includes("import Controller from '@server/app/controller';")
        ) {
            content = content.replace(
                "import Controller from '@server/app/controller';",
                "import Controller, { schema } from '@server/app/controller';",
            );
            changed = true;
        }

        if (content.includes('export default class indexController extends Controller')) {
            const parentName = path.basename(path.dirname(controllerFile)).replace(/[^A-Za-z0-9_$]/g, '');
            content = content.replace(
                'export default class indexController extends Controller',
                `export default class ${parentName || 'Generated'}Controller extends Controller`,
            );
            changed = true;
        }

        if (!changed) continue;

        fs.writeFileSync(controllerFile, content);
        updated++;
    }

    console.log(`[cleanup-generated-controllers] ${repoRoot}: updated ${updated} controller files`);
}
