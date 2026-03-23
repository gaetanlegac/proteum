/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';
import fs from 'fs-extra';
import { rspack, type Compiler as RspackCompiler } from '@rspack/core';

// Core
import app from '../app';
import createServerConfig from './server';
import createClientConfig from './client';
import { TCompileMode, TCompileOutputTarget } from './common';
import { writeClientManifest } from './common/clientManifest';
import { logVerbose } from '../runtime/verbose';
import { createCompileReporter, type TCompileReporter } from '../presentation/compileReporter';
import { generateRoutingArtifacts } from './artifacts/routing';
import { generateControllerArtifacts } from './artifacts/controllers';
import { generateServiceArtifacts } from './artifacts/services';
import { writeCurrentProteumManifest } from './artifacts/manifest';
import { normalizePath } from './artifacts/shared';

type TCompilerCallback = (compiler: RspackCompiler) => void;

type TRecentCompilationResult = { succeeded: boolean; hash?: string; modifiedFiles?: string[] };

/*----------------------------------
- FONCTION
----------------------------------*/
export default class Compiler {
    public compiling: { [compiler: string]: Promise<void> } = {};
    private recentCompilationResults: { [compiler: string]: TRecentCompilationResult } = {};
    private recentModifiedFiles: { [compiler: string]: string[] } = {};
    private refreshingGeneratedArtifacts?: Promise<void>;
    private compileReporter?: TCompileReporter;

    public constructor(
        private mode: TCompileMode,
        private callbacks: { before?: TCompilerCallback; after?: TCompilerCallback } = {},
        private debug: boolean = false,
        private outputTarget: TCompileOutputTarget = mode === 'dev' ? 'dev' : 'bin',
    ) {}

    public cleanup() {
        const outputPath = app.outputPath(this.outputTarget);
        const generatedPublicEntries = new Set(['app']);
        const outputPublicPath = path.join(outputPath, 'public');
        const preserveDevOutput = this.mode === 'dev' && this.outputTarget === 'dev';

        if (!preserveDevOutput) fs.emptyDirSync(outputPath);

        fs.ensureDirSync(outputPublicPath);
        this.syncPublicEntries(outputPublicPath, generatedPublicEntries, this.mode === 'dev');
    }
    /* FIX issue with npm link
        When we install a module with npm link, this module's deps are not installed in the parent project scope
        Which causes some issues:
        - The module's deps are not found by Typescript
        - Including React, so VSCode shows that JSX is missing
    */
    public fixNpmLinkIssues() {
        const corePath = path.join(app.paths.root, '/node_modules/proteum');
        if (!fs.lstatSync(corePath).isSymbolicLink())
            return logVerbose("Not fixing npm issue because proteum wasn't installed with npm link.");

        this.debug && logVerbose(`Fix NPM link issues ...`);
        const outputPath = app.outputPath(this.outputTarget);

        const appModules = path.join(app.paths.root, 'node_modules');
        const coreModules = path.join(corePath, 'node_modules');

        // When the 5htp package is installed from npm link,
        // Modules are installed locally and not glbally as with with the 5htp package from NPM.
        // So we need to symbilnk the http-core node_modules in one of the parents of server.js.
        // It avoids errors like: "Error: Cannot find module 'intl'"
        this.ensureSymlinkSync(coreModules, path.join(outputPath, 'node_modules'));

        // Same problem: when 5htp-core is installed via npm link,
        // Typescript doesn't detect React and shows mission JSX errors
        const preactCoreModule = path.join(coreModules, 'preact');
        const preactAppModule = path.join(appModules, 'preact');
        const reactAppModule = path.join(appModules, 'react');

        if (!fs.existsSync(preactAppModule)) fs.symlinkSync(preactCoreModule, preactAppModule);
        if (!fs.existsSync(reactAppModule)) fs.symlinkSync(path.join(preactCoreModule, 'compat'), reactAppModule);
    }

    private syncPublicEntries(outputPublicPath: string, generatedPublicEntries: Set<string>, useSymlinks: boolean) {
        const publicFiles = new Set(
            fs.readdirSync(app.paths.public).filter((publicFile) => !generatedPublicEntries.has(publicFile)),
        );

        for (const existingPublicFile of fs.readdirSync(outputPublicPath)) {
            if (generatedPublicEntries.has(existingPublicFile) || publicFiles.has(existingPublicFile)) continue;

            fs.removeSync(path.join(outputPublicPath, existingPublicFile));
        }

        for (const publicFile of publicFiles) {
            const sourcePath = path.join(app.paths.public, publicFile);
            const outputFilePath = path.join(outputPublicPath, publicFile);

            if (useSymlinks) {
                this.ensureSymlinkSync(sourcePath, outputFilePath);
                continue;
            }

            if (fs.existsSync(outputFilePath)) fs.removeSync(outputFilePath);

            fs.copySync(sourcePath, outputFilePath);
        }
    }

    private ensureSymlinkSync(targetPath: string, linkPath: string) {
        fs.ensureDirSync(path.dirname(linkPath));

        try {
            const linkStats = fs.lstatSync(linkPath);

            if (linkStats.isSymbolicLink()) {
                const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
                if (currentTarget === path.resolve(targetPath)) return;
            }

            fs.removeSync(linkPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }

        fs.symlinkSync(targetPath, linkPath);
    }

    private async warmupApp() {
        await app.warmup();
    }

    private async refreshGeneratedArtifacts() {
        if (!this.refreshingGeneratedArtifacts) {
            this.refreshingGeneratedArtifacts = (async () => {
                const services = generateServiceArtifacts();
                const controllers = generateControllerArtifacts();
                const { clientRoutes, serverRoutes, layouts } = generateRoutingArtifacts();

                writeCurrentProteumManifest({
                    services,
                    controllers,
                    routes: { client: clientRoutes, server: serverRoutes },
                    layouts,
                });
            })().finally(() => {
                this.refreshingGeneratedArtifacts = undefined;
            });
        }

        await this.refreshingGeneratedArtifacts;
    }

    public async refreshGeneratedTypings() {
        await this.warmupApp();
        await this.refreshGeneratedArtifacts();
    }

    public dispose() {
        this.compileReporter?.stop();
        this.compileReporter = undefined;
    }

    public consumeRecentCompilationResults() {
        const recentCompilationResults = { ...this.recentCompilationResults };
        this.recentCompilationResults = {};
        return recentCompilationResults;
    }

    public async create() {
        await this.warmupApp();

        this.cleanup();

        this.fixNpmLinkIssues();
        await this.refreshGeneratedArtifacts();

        // Create compilers
        const multiCompiler = rspack([
            createServerConfig(app, this.mode, this.outputTarget),
            createClientConfig(app, this.mode, this.outputTarget),
        ]);
        this.compileReporter = createCompileReporter({
            enabled: this.mode === 'dev' && this.outputTarget === 'dev',
        });

        for (const compiler of multiCompiler.compilers) {
            const name = compiler.name;
            if (name === undefined) throw new Error(`A name must be specified to each compiler.`);

            let timeStart = new Date();

            let finished: () => void;
            this.compiling[name] = new Promise((resolve) => (finished = resolve));

            compiler.hooks.beforeRun.tapPromise(name, () => this.refreshGeneratedArtifacts());
            compiler.hooks.watchRun.tapPromise(name, () => this.refreshGeneratedArtifacts());

            compiler.hooks.compile.tap(name, (compilation) => {
                this.callbacks.before && this.callbacks.before(compiler);

                this.recentModifiedFiles[name] = [...(compiler.modifiedFiles ? [...compiler.modifiedFiles] : [])].map(
                    (filepath) => normalizePath(path.resolve(filepath)),
                );

                this.compiling[name] = new Promise((resolve) => (finished = resolve));

                timeStart = new Date();
                this.compileReporter?.start(name, this.recentModifiedFiles[name] || []);
                logVerbose(`[${name}] Compiling ...`);
            });

            /* TODO: Ne pas résoudre la promise tant que la recompilation des données indexées (icones, identité, ...) 
                n'a pas été achevée */
            compiler.hooks.done.tap(name, (stats) => {
                const compilationSucceeded = !stats.hasErrors();
                this.recentCompilationResults[name] = {
                    succeeded: compilationSucceeded,
                    hash: typeof stats.hash === 'string' ? stats.hash : undefined,
                    modifiedFiles: this.recentModifiedFiles[name] || [],
                };

                // Shiow status
                const timeEnd = new Date();
                const time = timeEnd.getTime() - timeStart.getTime();
                this.compileReporter?.finish(name, { succeeded: compilationSucceeded, durationMs: time });
                if (!compilationSucceeded) {
                    console.info(stats.toString(compiler.options.stats));
                    console.error(`[${name}] Failed to compile after ${time} ms`);
                } else {
                    if (name === 'client') {
                        writeClientManifest(stats, app.outputPath(this.outputTarget));
                    }

                    this.debug && logVerbose(stats.toString(compiler.options.stats));
                    logVerbose(`[${name}] Finished compilation after ${time} ms`);
                }

                // Mark as finished
                finished();
                delete this.compiling[name];
            });
        }

        return multiCompiler;
    }
}
