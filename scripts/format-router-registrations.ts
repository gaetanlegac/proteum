import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import type * as types from '@babel/types';

const requireFromWorkspace = createRequire(path.join(process.cwd(), 'package.json'));
const prettier = requireFromWorkspace('prettier') as typeof import('prettier');
const prettierConfig = require(path.resolve(__dirname, '..', 'prettier.config.cjs'));

const ROUTER_REGISTRATION_PATTERN = /Router\.(page|error)\(/;
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);

const findFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findFiles(filepath));
            continue;
        }

        if (dirent.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(filepath))) files.push(filepath);
    }

    return files;
};

const formatFile = async (filepath: string) => {
    const source = fs.readFileSync(filepath, 'utf8');
    if (!ROUTER_REGISTRATION_PATTERN.test(source)) return false;

    const ast = parse(source, {
        sourceType: 'module',
        errorRecovery: true,
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });

    const replacements: Array<{ start: number; end: number; formatted: string }> = [];

    traverse(ast, {
        ExpressionStatement(routePath: NodePath<types.ExpressionStatement>) {
            const expression = routePath.node.expression;
            if (
                expression.type !== 'CallExpression' ||
                expression.callee.type !== 'MemberExpression' ||
                expression.callee.object.type !== 'Identifier' ||
                expression.callee.object.name !== 'Router' ||
                expression.callee.property.type !== 'Identifier' ||
                (expression.callee.property.name !== 'page' && expression.callee.property.name !== 'error')
            )
                return;

            if (routePath.node.start == null || routePath.node.end == null) return;

            replacements.push({
                start: routePath.node.start,
                end: routePath.node.end,
                formatted: '',
            });
        },
    });

    if (!replacements.length) return false;

    for (const replacement of replacements) {
        const fragment = source.slice(replacement.start, replacement.end);
        replacement.formatted = (await prettier.format(fragment, {
            ...prettierConfig,
            filepath,
        })).trimEnd();
    }

    let nextSource = source;

    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        nextSource =
            nextSource.slice(0, replacement.start) + replacement.formatted + nextSource.slice(replacement.end);
    }

    if (nextSource === source) return false;

    fs.writeFileSync(filepath, nextSource);
    return true;
};

const main = async () => {
    const repoRoots = process.argv.slice(2);
    if (!repoRoots.length) {
        throw new Error('Usage: ts-node scripts/format-router-registrations.ts <repo-root> [repo-root...]');
    }

    let changedFiles = 0;

    for (const repoRoot of repoRoots) {
        const pagesRoot = path.join(repoRoot, 'client', 'pages');
        const files = findFiles(pagesRoot);

        for (const filepath of files) {
            const changed = await formatFile(filepath);
            if (!changed) continue;

            changedFiles += 1;
            console.log(`formatted ${filepath}`);
        }
    }

    console.log(`formatted ${changedFiles} file(s)`);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
