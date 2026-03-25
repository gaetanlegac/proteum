import fs from 'fs';
import path from 'path';

import cli from '..';
import Compiler from '../compiler';
import { runProcess } from './runProcess';

const tsconfigPaths = ['client/tsconfig.json', 'server/tsconfig.json', 'commands/tsconfig.json'];
const eslintConfigPaths = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs'];

const resolveInstalledBinary = (name: string) => {
    const binary = path.join(cli.paths.core.root, 'node_modules', '.bin', name);

    if (!fs.existsSync(binary)) throw new Error(`Missing required binary "${name}" in Proteum dependencies.`);

    return binary;
};

const resolveExistingAppPaths = (paths: string[]) =>
    paths
        .map((relativePath) => ({ relativePath, absolutePath: path.join(cli.paths.appRoot, relativePath) }))
        .filter(({ absolutePath }) => fs.existsSync(absolutePath));

const getTypecheckEnv = () => {
    const existingNodeOptions = process.env.NODE_OPTIONS ?? '';

    if (existingNodeOptions.includes('max-old-space-size')) return {};

    return {
        NODE_OPTIONS: [existingNodeOptions, '--max-old-space-size=8192'].filter(Boolean).join(' '),
    };
};

export const refreshGeneratedTypings = async () => {
    const compiler = new Compiler('dev');

    await compiler.refreshGeneratedTypings();
};

export const runAppTypecheck = async () => {
    const existingProjects = resolveExistingAppPaths(tsconfigPaths);

    if (existingProjects.length === 0)
        throw new Error(`No TypeScript app projects found. Expected one of: ${tsconfigPaths.join(', ')}.`);

    const tsc = resolveInstalledBinary('tsc');

    for (const { relativePath } of existingProjects)
        await runProcess(tsc, ['-p', relativePath, '--noEmit', '--pretty', 'false'], {
            cwd: cli.paths.appRoot,
            env: getTypecheckEnv(),
        });
};

export const runAppLint = async ({ fix = false } = {}) => {
    const [config] = resolveExistingAppPaths(eslintConfigPaths);

    if (!config)
        throw new Error(
            `No ESLint config found. Expected one of: ${eslintConfigPaths
                .map((relativePath) => path.join(cli.paths.appRoot, relativePath))
                .join(', ')}.`,
        );

    const eslint = resolveInstalledBinary('eslint');
    const args = ['.', '--config', config.absolutePath, '--no-config-lookup'];

    if (fix) args.push('--fix');

    await runProcess(eslint, args, { cwd: cli.paths.appRoot });
};
