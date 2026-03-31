/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs';
import path from 'path';
import TsAlias from 'ts-alias';
import moduleAlias from 'module-alias';

// Core

/*----------------------------------
- TYPES
----------------------------------*/

import type { App } from './app';
import type { TAppSide } from './app';

export type TPathInfosOptions = {
    basePath?: string;
    shortenExtensions: string[];
    // Indexed will be trimed only when the extension can be shorten
    trimIndex: boolean;
};

export type TPathInfos = {
    original: string;
    absolute: string;
    relative: string;
    //forImport: string,

    name: string;
    extension: string;
    isIndex: boolean;
};

export type TResolvedPackageBinary = {
    packageName: string;
    packageRoot: string;
    binPath: string;
    command: string;
    args: string[];
};

export type TFrameworkInstallGraph = {
    activeRoot: string;
    installedRoot?: string;
    appNodeModulesRoot: string;
    frameworkNodeModulesRoot: string;
};

export type TFrameworkInstallMode = 'npm' | 'npm-link' | 'path' | 'workspace' | 'global' | 'checkout';

export type TFrameworkInstallInfo = {
    mode: TFrameworkInstallMode;
    summary: string;
    dependencySpec?: string;
};

/*----------------------------------
- CONFIG
----------------------------------*/

export const staticAssetName = /*isDebug ? '[name].[ext].[hash:8]' :*/ '[hash:8][ext]';

const pathInfosDefaultOpts = { shortenExtensions: ['ts', 'js', 'tsx', 'jsx'], trimIndex: true };

const safeRealpath = (filepath: string) => {
    try {
        return fs.realpathSync(filepath);
    } catch {
        return path.resolve(filepath);
    }
};

const readPackageJson = (filepath: string) => {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8')) as Record<string, unknown>;
    } catch {
        return undefined;
    }
};

const readPackageDependencySpec = (appRoot: string, packageName: string) => {
    const packageJson = readPackageJson(path.join(appRoot, 'package.json'));
    if (!packageJson) return undefined;

    const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

    for (const section of dependencySections) {
        const dependencies = packageJson[section];
        if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;

        const dependencySpec = (dependencies as Record<string, unknown>)[packageName];
        if (typeof dependencySpec !== 'string' || dependencySpec.trim() === '') continue;

        return dependencySpec.trim();
    }

    return undefined;
};

const findVisibleNodeModulesRoot = (startPath: string): string | undefined => {
    let currentPath = path.resolve(startPath);

    while (true) {
        const candidate = path.join(currentPath, 'node_modules');
        if (fs.existsSync(candidate)) return candidate;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const findVisiblePackageInstall = (startPath: string, packageName: string): string | undefined => {
    let currentPath = path.resolve(startPath);

    while (true) {
        const candidate = path.join(currentPath, 'node_modules', packageName);
        if (fs.existsSync(candidate)) return candidate;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return undefined;
        currentPath = parentPath;
    }
};

const resolveCoreRoot = (appRoot: string): string => {
    const currentPackageRoot = path.resolve(__dirname, '..');
    const currentBin = path.join(currentPackageRoot, 'cli', 'bin.js');
    const invokedScript = process.argv[1] ? safeRealpath(process.argv[1]) : '';
    const invokedCurrentPackage = invokedScript === safeRealpath(currentBin);

    if (invokedCurrentPackage) return currentPackageRoot;

    const installedFrameworkRoot = findVisiblePackageInstall(appRoot, 'proteum');
    if (installedFrameworkRoot) return installedFrameworkRoot;

    // When running `npx`/global installs, there may be no local `node_modules/proteum` yet.
    // Fall back to the installed package root (this file lives in `<root>/cli`).
    return currentPackageRoot;
};

const normalizeImportPath = (value: string) => value.replace(/\\/g, '/');

const resolveAppNodeModulesRoot = (appRoot: string): string => {
    const installedRoot = findVisiblePackageInstall(appRoot, 'proteum');

    return (
        (installedRoot ? path.dirname(installedRoot) : undefined) ||
        findVisibleNodeModulesRoot(appRoot) ||
        path.join(appRoot, 'node_modules')
    );
};

const resolveFrameworkInstallRoot = (appRoot: string): string =>
    findVisiblePackageInstall(appRoot, 'proteum') || path.join(resolveAppNodeModulesRoot(appRoot), 'proteum');

const resolveFrameworkInstallGraph = (appRoot: string, activeRoot: string): TFrameworkInstallGraph => {
    const installedRoot = findVisiblePackageInstall(appRoot, 'proteum');

    return {
        activeRoot,
        installedRoot,
        appNodeModulesRoot: resolveAppNodeModulesRoot(appRoot),
        frameworkNodeModulesRoot: findVisibleNodeModulesRoot(activeRoot) || path.join(activeRoot, 'node_modules'),
    };
};

const resolvePackageJsonPath = (packageName: string, searchPaths: string[]): string =>
    require.resolve(`${packageName}/package.json`, { paths: searchPaths });

const filenameToImportName = (value: string) =>
    normalizeImportPath(value).replace(/[^A-Za-z0-9_]+/g, '_');

export const resolveFrameworkInstallInfo = ({
    appRoot,
    framework,
}: {
    appRoot: string;
    framework: TFrameworkInstallGraph;
}): TFrameworkInstallInfo => {
    const dependencySpec = readPackageDependencySpec(appRoot, 'proteum');
    const installedRoot = framework.installedRoot ? path.resolve(framework.installedRoot) : undefined;
    const normalizedActiveRoot = normalizeImportPath(safeRealpath(framework.activeRoot));
    const installedRootIsSymlink =
        installedRoot !== undefined &&
        (() => {
            try {
                return fs.lstatSync(installedRoot).isSymbolicLink();
            } catch {
                return false;
            }
        })();

    if (dependencySpec?.startsWith('file:') || dependencySpec?.startsWith('link:')) {
        return {
            mode: 'path',
            summary: `path (${dependencySpec})`,
            dependencySpec,
        };
    }

    if (dependencySpec?.startsWith('workspace:')) {
        return {
            mode: 'workspace',
            summary: `workspace (${dependencySpec})`,
            dependencySpec,
        };
    }

    if (installedRootIsSymlink) {
        return {
            mode: 'npm-link',
            summary: 'npm link',
            dependencySpec,
        };
    }

    if (dependencySpec) {
        return {
            mode: 'npm',
            summary: `npm (${dependencySpec})`,
            dependencySpec,
        };
    }

    if (!normalizedActiveRoot.includes('/node_modules/')) {
        return {
            mode: 'checkout',
            summary: 'local checkout',
        };
    }

    return {
        mode: 'global',
        summary: 'global install',
    };
};

/*----------------------------------
- LIB
----------------------------------*/
export default class Paths {
    /*----------------------------------
    - LISTE
    ----------------------------------*/
    public coreRoot: string;
    public framework: TFrameworkInstallGraph;
    public core: { cli: string; root: string; pages: string };

    public constructor(public appRoot: string, coreRoot = resolveCoreRoot(appRoot)) {
        this.coreRoot = coreRoot;
        this.framework = resolveFrameworkInstallGraph(appRoot, coreRoot);
        this.core = { cli: path.resolve(__dirname, '.'), root: this.coreRoot, pages: this.coreRoot + '/client/pages' };
    }

    /*----------------------------------
    - EXTRACTION
    ----------------------------------*/

    public infos(filename: string, givenOpts: Partial<TPathInfosOptions> = {}): TPathInfos {
        const opts: TPathInfosOptions = { ...pathInfosDefaultOpts, ...givenOpts };

        // Extraction élements du chemin
        const decomp = filename.split('/');
        const nomComplet = decomp.pop() as string;
        const lastDotIndex = nomComplet.lastIndexOf('.');
        const nomFichier = lastDotIndex === -1 ? nomComplet : nomComplet.substring(0, lastDotIndex);
        const extension = lastDotIndex === -1 ? '' : nomComplet.substring(lastDotIndex + 1);
        const shortenExtension = opts.shortenExtensions && opts.shortenExtensions.includes(extension);

        // Vire l'index
        const isIndex = nomFichier === 'index';
        let cheminAbsolu: string;
        let nomReel: string;
        if (isIndex && shortenExtension && opts.trimIndex) {
            cheminAbsolu = decomp.join('/');
            nomReel = decomp.pop() as string;
        } else {
            cheminAbsolu = [...decomp, nomFichier].join('/');
            nomReel = nomFichier;
        }

        // Conserve l'extension si nécessaire
        if (!shortenExtension) cheminAbsolu += '.' + extension;

        const relative = opts.basePath === undefined ? '' : cheminAbsolu.substring(opts.basePath.length + 1);

        // Retour
        const retour = {
            original: filename,
            absolute: cheminAbsolu,
            relative,

            // Not used anymore, but can be useful in the future
            //forImport: this.withAlias(cheminAbsolu, side),

            name: nomReel,
            extension,
            isIndex,
        };

        return retour;
    }

    public getPageChunk(app: App, file: string) {
        const infos = this.infos(file, {
            basePath: file.startsWith(app.paths.pages) ? app.paths.pages : this.core.pages,
            // Avoid potential conflicts between /landing.tsx and /landing/index.tsx
            trimIndex: false,
        });

        const filepath = infos.relative;

        // Before:  /home/.../src/client/pages/landing/index.tsx
        // After:   landing
        let chunkId = filenameToImportName(filepath);

        // nsure it's non-empty
        if (chunkId.length === 0)
            // = /index.tsx
            chunkId = 'main';

        return { filepath, chunkId };
    }

    public getLayoutChunk(app: App, file: string) {
        const layoutDir = path.dirname(path.dirname(file));
        const relativeLayoutDir = path.relative(app.paths.pages, layoutDir);
        const filepath = relativeLayoutDir === '' ? '' : normalizeImportPath(relativeLayoutDir);

        return { filepath, chunkId: filenameToImportName(filepath) };
    }

    public applyAliases() {
        const aliases = new TsAlias({ rootDir: this.core.cli });

        //console.log('Applying Aliases ...', aliases.forModuleAlias());
        moduleAlias.addAliases(aliases.forModuleAlias());
    }

    public getFrameworkRoots(): string[] {
        return [
            this.framework.activeRoot,
            ...(this.framework.installedRoot ? [this.framework.installedRoot] : []),
        ].filter((rootPath, index, list) => list.indexOf(rootPath) === index && fs.existsSync(rootPath));
    }

    public getFrameworkInstallRoot(): string {
        return this.getFrameworkInstallRootForAppRoot(this.appRoot);
    }

    public getFrameworkInstallRootForAppRoot(appRoot: string): string {
        return resolveFrameworkInstallRoot(appRoot);
    }

    public getAppNodeModulesRootForAppRoot(appRoot: string): string {
        return resolveAppNodeModulesRoot(appRoot);
    }

    public relativePathFromFile(targetFile: string, absolutePath: string): string {
        return this.relativePathFromDirectory(path.dirname(targetFile), absolutePath);
    }

    public relativePathFromDirectory(targetDirectory: string, absolutePath: string): string {
        const relativePath = normalizeImportPath(path.relative(targetDirectory, absolutePath));
        if (relativePath === '') return '.';
        if (!relativePath.startsWith('.')) return `./${relativePath}`;
        return relativePath;
    }

    public relativeFrameworkPathFrom(targetFile: string, ...segments: string[]): string {
        return this.relativePathFromFile(targetFile, path.join(this.getFrameworkInstallRoot(), ...segments));
    }

    public relativeAppNodeModulesPathFrom(targetFile: string, ...segments: string[]): string {
        return this.relativePathFromFile(targetFile, path.join(this.framework.appNodeModulesRoot, ...segments));
    }

    public relativeFrameworkPathFromDirectory(targetDirectory: string, ...segments: string[]): string {
        return this.relativePathFromDirectory(targetDirectory, path.join(this.getFrameworkInstallRoot(), ...segments));
    }

    public relativeAppNodeModulesPathFromDirectory(targetDirectory: string, ...segments: string[]): string {
        return this.relativePathFromDirectory(targetDirectory, path.join(this.framework.appNodeModulesRoot, ...segments));
    }

    public relativeFrameworkTsconfigPathFrom(targetFile: string): string {
        return this.relativeFrameworkPathFrom(targetFile, 'tsconfig.common.json');
    }

    public relativeFrameworkPathForAppRoot(appRoot: string, targetFile: string, ...segments: string[]): string {
        return this.relativePathFromFile(targetFile, path.join(this.getFrameworkInstallRootForAppRoot(appRoot), ...segments));
    }

    public relativeFrameworkPathFromDirectoryForAppRoot(
        appRoot: string,
        targetDirectory: string,
        ...segments: string[]
    ): string {
        return this.relativePathFromDirectory(
            targetDirectory,
            path.join(this.getFrameworkInstallRootForAppRoot(appRoot), ...segments),
        );
    }

    public relativeAppNodeModulesPathFromDirectoryForAppRoot(
        appRoot: string,
        targetDirectory: string,
        ...segments: string[]
    ): string {
        return this.relativePathFromDirectory(
            targetDirectory,
            path.join(this.getAppNodeModulesRootForAppRoot(appRoot), ...segments),
        );
    }

    public resolvePackageRoot(packageName: string, { preferApp = true }: { preferApp?: boolean } = {}): string {
        const searchPaths = preferApp
            ? [this.appRoot, this.framework.activeRoot]
            : [this.framework.activeRoot, this.appRoot];
        return path.dirname(resolvePackageJsonPath(packageName, searchPaths));
    }

    public resolveRequest(request: string, { preferApp = true }: { preferApp?: boolean } = {}): string {
        const searchPaths = preferApp
            ? [this.appRoot, this.framework.activeRoot]
            : [this.framework.activeRoot, this.appRoot];
        return require.resolve(request, { paths: searchPaths });
    }

    public resolveBinary(
        packageName: string,
        binName = packageName,
        { preferApp = true }: { preferApp?: boolean } = {},
    ): TResolvedPackageBinary {
        const packageRoot = this.resolvePackageRoot(packageName, { preferApp });
        const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
            bin?: string | Record<string, string>;
        };
        const binField = packageJson.bin;
        const relativeBinPath =
            typeof binField === 'string'
                ? binField
                : binField?.[binName] || binField?.[packageName];

        if (!relativeBinPath) {
            throw new Error(`Unable to resolve binary "${binName}" from package "${packageName}".`);
        }

        const binPath = path.resolve(packageRoot, relativeBinPath);

        return {
            packageName,
            packageRoot,
            binPath,
            command: process.execPath,
            args: [binPath],
        };
    }
}
