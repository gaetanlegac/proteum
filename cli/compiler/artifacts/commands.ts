import path from 'path';
import fs from 'fs-extra';
import ts from 'typescript';

import app from '../../app';
import cli from '../..';
import { indexCommands } from '../common/commands';
import { TProteumManifestCommand } from '../common/proteumManifest';
import writeIfChanged from '../writeIfChanged';
import { normalizeAbsolutePath } from './shared';

const readServerTsconfigPaths = () => {
    const serverTsconfigFilepath = path.join(app.paths.root, 'server', 'tsconfig.json');
    const parsed = ts.readConfigFile(serverTsconfigFilepath, ts.sys.readFile);

    if (parsed.error) {
        throw new Error(`Unable to read ${serverTsconfigFilepath}: ${parsed.error.messageText}`);
    }

    const compilerOptions = (parsed.config?.compilerOptions || {}) as { paths?: Record<string, string[]> };

    return compilerOptions.paths || {};
};

const getCommandsTsconfigFilepath = () => path.join(app.paths.root, 'commands', 'tsconfig.json');

const getCommandsGlobalTypesPath = (commandsTsconfigFilepath: string) =>
    cli.paths.relativeFrameworkPathFrom(commandsTsconfigFilepath, 'types', 'global');

const createCommandsTsconfigContent = () => {
    const commandsTsconfigFilepath = getCommandsTsconfigFilepath();

    return `${JSON.stringify(
        {
            extends: '../server/tsconfig.json',
            compilerOptions: {
                baseUrl: '..',
                rootDir: '..',
                paths: {
                    ...readServerTsconfigPaths(),
                    '@/server/index': ['./.proteum/server/commands.app.d.ts'],
                    '@models/types': ['./.proteum/server/models.ts'],
                },
            },
            include: ['.', '../var/typings', getCommandsGlobalTypesPath(commandsTsconfigFilepath), '../.proteum/server/commands.d.ts'],
        },
        null,
        4,
    )}
`;
};

const legacyCommandsTsconfigContent = `{
    "extends": "../server/tsconfig.json",
    "include": [
        ".",
        "../var/typings",
        "../node_modules/proteum/types/global",
        "../.proteum/server/services.d.ts",
        "../.proteum/server/commands.ts",
        "../server/index.ts"
    ]
}
`;

const transitionalCommandsTsconfigContent = `{
    "extends": "../server/tsconfig.json",
    "include": [
        ".",
        "../var/typings",
        "../node_modules/proteum/types/global",
        "../.proteum/server/services.d.ts",
        "../server/index.ts"
    ]
}
`;

const commandsOnlyTsconfigContent = `{
    "extends": "../server/tsconfig.json",
    "include": [
        ".",
        "../var/typings",
        "../node_modules/proteum/types/global",
        "../.proteum/server/commands.d.ts"
    ]
}
`;

const commandsAliasesTsconfigContent = `{
    "extends": "../server/tsconfig.json",
    "compilerOptions": {
        "baseUrl": "..",
        "rootDir": "..",
        "paths": {
            "@/server/index": ["./.proteum/server/commands.app.d.ts"]
        }
    },
    "include": [
        ".",
        "../var/typings",
        "../node_modules/proteum/types/global",
        "../.proteum/server/commands.d.ts"
    ]
}
`;

const isManagedCommandsTsconfig = (content: string) => {
    try {
        const parsed = JSON.parse(content) as {
            extends?: string;
            include?: string[];
            compilerOptions?: { baseUrl?: string; rootDir?: string };
        };

        if (parsed.extends !== '../server/tsconfig.json') return false;
        if (!Array.isArray(parsed.include) || parsed.include.length !== 4) return false;
        if (parsed.include[0] !== '.' || parsed.include[1] !== '../var/typings') return false;
        if (parsed.include[3] !== '../.proteum/server/commands.d.ts') return false;
        if (
            parsed.include[2] !== getCommandsGlobalTypesPath(getCommandsTsconfigFilepath()) &&
            !parsed.include[2].includes('node_modules/proteum/types/global')
        ) {
            return false;
        }

        if (parsed.compilerOptions?.baseUrl !== undefined && parsed.compilerOptions.baseUrl !== '..') return false;
        if (parsed.compilerOptions?.rootDir !== undefined && parsed.compilerOptions.rootDir !== '..') return false;

        return true;
    } catch {
        return false;
    }
};

const ensureCommandsTsconfig = () => {
    const commandsRoot = path.join(app.paths.root, 'commands');
    const commandsTsconfigFilepath = getCommandsTsconfigFilepath();
    const nextContent = createCommandsTsconfigContent();

    if (!fs.existsSync(commandsRoot)) return;

    if (!fs.existsSync(commandsTsconfigFilepath)) {
        writeIfChanged(commandsTsconfigFilepath, nextContent);
        return;
    }

    const currentContent = fs.readFileSync(commandsTsconfigFilepath, 'utf8');
    const generatedContents = new Set([
        createCommandsTsconfigContent(),
        legacyCommandsTsconfigContent,
        transitionalCommandsTsconfigContent,
        commandsOnlyTsconfigContent,
        commandsAliasesTsconfigContent,
    ]);

    if (!generatedContents.has(currentContent) && !isManagedCommandsTsconfig(currentContent)) return;

    writeIfChanged(commandsTsconfigFilepath, nextContent);
};

export const generateCommandArtifacts = () => {
    ensureCommandsTsconfig();

    const frameworkCommandsRoot = normalizeAbsolutePath(path.join(cli.paths.core.root, 'commands'));
    const commands = indexCommands([
        { importPrefix: `${frameworkCommandsRoot}/`, root: path.join(cli.paths.core.root, 'commands') },
        { importPrefix: '@/commands/', root: path.join(app.paths.root, 'commands') },
    ]);

    const getManifestScopeFromImportPath = (importPath: string) =>
        importPath.startsWith(`${frameworkCommandsRoot}/`) ? 'framework' : 'app';

    const manifestCommands = commands.flatMap<TProteumManifestCommand>((command) =>
        command.methods.map((method) => ({
            className: command.className,
            importPath: command.importPath,
            filepath: normalizeAbsolutePath(command.filepath),
            sourceLocation: method.sourceLocation,
            commandBasePath: command.commandBasePath,
            methodName: method.name,
            path: method.path,
            scope: getManifestScopeFromImportPath(command.importPath),
        })),
    );

    const commandImports = commands
        .map((command, index) => `import Command${index} from ${JSON.stringify(command.importPath)};`)
        .join('\n');

    const commandEntries = commands.flatMap((command, commandIndex) =>
        command.methods.map(
            (method) => `    {
        path: ${JSON.stringify(method.path)},
        className: ${JSON.stringify(command.className)},
        importPath: ${JSON.stringify(command.importPath)},
        filepath: ${JSON.stringify(normalizeAbsolutePath(command.filepath))},
        sourceLocation: { line: ${method.sourceLocation.line}, column: ${method.sourceLocation.column} },
        scope: ${JSON.stringify(getManifestScopeFromImportPath(command.importPath))},
        Command: Command${commandIndex},
        methodName: ${JSON.stringify(method.name)},
    },`,
        ),
    );

    writeIfChanged(
        path.join(app.paths.server.generated, 'commands.ts'),
        `/*----------------------------------
- GENERATED FILE
----------------------------------*/

// This file is generated by Proteum from command files.
// Do not edit it manually.

import type { Commands } from '@server/app/commands';
import type { TDevCommandDefinition } from '@common/dev/commands';
${commandImports ? '\n' + commandImports : ''}

export type TGeneratedCommandDefinition = TDevCommandDefinition & {
    Command: new (app: any) => Commands<any>,
    methodName: string,
}

const commands: TGeneratedCommandDefinition[] = [
${commandEntries.join('\n')}
];

export default commands;
`,
    );

    return manifestCommands;
};
