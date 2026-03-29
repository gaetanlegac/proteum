import path from 'path';
import fs from 'fs-extra';
import ts from 'typescript';

import app from '../../app';
import { normalizePath } from './shared';

const hasRegisteredRouteDefinitions = (filepath: string, content: string) => {
    const sourceFile = ts.createSourceFile(
        filepath,
        content,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    return sourceFile.statements.some((statement) => {
        if (!ts.isExpressionStatement(statement)) return false;
        if (!ts.isCallExpression(statement.expression)) return false;
        if (!ts.isPropertyAccessExpression(statement.expression.expression)) return false;

        const callee = statement.expression.expression;

        return (
            ts.isIdentifier(callee.expression) &&
            callee.expression.text === 'Router' &&
            ['page', 'error', 'get', 'post', 'put', 'delete', 'patch'].includes(callee.name.text)
        );
    });
};

const findRegisteredRouteFiles = (dir: string, options: { excludeLayoutDirectories?: boolean } = {}): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filePath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            if (options.excludeLayoutDirectories && dirent.name === '_layout') continue;

            files.push(...findRegisteredRouteFiles(filePath, options));
            continue;
        }

        if (!dirent.isFile()) continue;
        if (!/\.(ts|tsx)$/.test(dirent.name)) continue;

        const content = fs.readFileSync(filePath, 'utf8');
        if (!hasRegisteredRouteDefinitions(filePath, content)) continue;

        files.push(filePath);
    }

    return files;
};

export const findClientRouteFiles = (dir: string) => findRegisteredRouteFiles(dir, { excludeLayoutDirectories: true });

export const findServerRouteFiles = (dir: string) => findRegisteredRouteFiles(dir);

export const findLayoutFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filePath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findLayoutFiles(filePath));
            continue;
        }

        if (!dirent.isFile()) continue;
        if (dirent.name !== 'index.tsx') continue;
        if (!normalizePath(filePath).includes('/_layout/')) continue;

        files.push(filePath);
    }

    return files;
};

export const readPreloadedRouteChunks = () => {
    const preloadPath = path.join(app.paths.pages, 'preload.json');

    if (!fs.existsSync(preloadPath)) return new Set<string>();

    const content = fs.readJsonSync(preloadPath);

    if (!Array.isArray(content)) {
        throw new Error(`Invalid client/pages/preload.json format: expected an array of chunk ids.`);
    }

    return new Set<string>(content.filter((value): value is string => typeof value === 'string'));
};
