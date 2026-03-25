import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';

export type TCommandSourceLocation = { line: number; column: number };

export type TCommandMethodMeta = {
    name: string;
    path: string;
    sourceLocation: TCommandSourceLocation;
};

export type TCommandFileMeta = {
    importPath: string;
    filepath: string;
    className: string;
    commandBasePath: string;
    methods: TCommandMethodMeta[];
};

type TCommandSearchDir = { importPrefix: string; root: string };

const getCommandSegments = (relativePath: string) => {
    const segments = relativePath
        .replace(/\.ts$/, '')
        .split('/')
        .filter(Boolean);

    if (segments[segments.length - 1] === 'index') {
        segments.pop();
    }

    return segments;
};

const getCommandBasePathFromFilepath = (filepath: string, root: string) =>
    getCommandSegments(path.relative(root, filepath).replace(/\\/g, '/')).join('/');

const getGeneratedClassName = (filepath: string) => {
    const filename = path.basename(filepath, '.ts').replace(/[^A-Za-z0-9_$]+/g, '_');
    const normalized = filename.length ? filename : 'Commands';

    return normalized[0].toUpperCase() + normalized.substring(1);
};

const buildImportPath = (searchDir: TCommandSearchDir, filepath: string) =>
    searchDir.importPrefix + path.relative(searchDir.root, filepath).replace(/\\/g, '/').replace(/\.ts$/, '');

const findCommandFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];

    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, dirent.name);

        if (dirent.isDirectory()) {
            files.push(...findCommandFiles(filepath));
            continue;
        }

        if (!dirent.isFile()) continue;
        if (!dirent.name.endsWith('.ts')) continue;
        if (dirent.name.endsWith('.d.ts')) continue;

        files.push(filepath);
    }

    return files;
};

const parseSourceFile = (filepath: string, code: string) =>
    ts.createSourceFile(
        filepath,
        code,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

const getNodeLocation = (sourceFile: ts.SourceFile, node: ts.Node): TCommandSourceLocation => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return { line: line + 1, column: character + 1 };
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
    !!node.modifiers?.some((modifier) => modifier.kind === kind);

const getDefaultExportClass = (sourceFile: ts.SourceFile) => {
    const classes = new Map<string, ts.ClassDeclaration>();

    for (const statement of sourceFile.statements) {
        if (ts.isClassDeclaration(statement) && statement.name) {
            classes.set(statement.name.text, statement);

            if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
                return statement;
            }
        }
    }

    for (const statement of sourceFile.statements) {
        if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;

        if (ts.isIdentifier(statement.expression)) {
            return classes.get(statement.expression.text);
        }
    }

    return undefined;
};

const getExportedString = (sourceFile: ts.SourceFile, exportName: string) => {
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            if (declaration.name.text !== exportName) continue;
            if (!declaration.initializer || !ts.isStringLiteral(declaration.initializer)) continue;

            return declaration.initializer.text;
        }
    }

    return undefined;
};

export const indexCommands = (searchDirs: TCommandSearchDir[]) => {
    const commands: TCommandFileMeta[] = [];

    for (const searchDir of searchDirs) {
        const commandFiles = findCommandFiles(searchDir.root);

        for (const filepath of commandFiles.sort((a, b) => a.localeCompare(b))) {
            const code = fs.readFileSync(filepath, 'utf8');
            const sourceFile = parseSourceFile(filepath, code);

            const commandPathOverride = getExportedString(sourceFile, 'commandPath');
            const defaultClass = getDefaultExportClass(sourceFile);

            if (!defaultClass) continue;

            const className = defaultClass.name?.text || getGeneratedClassName(filepath);
            const commandBasePath = commandPathOverride || getCommandBasePathFromFilepath(filepath, searchDir.root);
            const methods: TCommandMethodMeta[] = [];

            for (const member of defaultClass.members) {
                if (!ts.isMethodDeclaration(member)) continue;
                if (!member.body) continue;
                if (!member.name || !ts.isIdentifier(member.name)) continue;

                methods.push({
                    name: member.name.text,
                    path: [commandBasePath, member.name.text].filter(Boolean).join('/'),
                    sourceLocation: getNodeLocation(sourceFile, member.name),
                });
            }

            if (!methods.length) continue;

            commands.push({
                filepath,
                importPath: buildImportPath(searchDir, filepath),
                className,
                commandBasePath,
                methods,
            });
        }
    }

    return commands.sort((a, b) => a.filepath.localeCompare(b.filepath));
};
