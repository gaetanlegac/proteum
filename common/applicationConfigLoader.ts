import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import * as ts from 'typescript';

import {
    Application as ApplicationConfig,
    normalizeApplicationIdentityConfig,
    normalizeApplicationSetupConfig,
    type TApplicationIdentityConfig,
    type TApplicationSetupConfig,
} from './applicationConfig';
import { loadOptionalProteumDotenv } from './env/proteumEnv';

const moduleCache = new Map<string, unknown>();
const supportedModuleExtensions = ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json'];

const resolveLocalModulePath = (specifier: string, fromFilepath: string) => {
    const basePath = path.resolve(path.dirname(fromFilepath), specifier);
    const candidates = [
        basePath,
        ...supportedModuleExtensions.map((extension) => `${basePath}${extension}`),
        ...supportedModuleExtensions.map((extension) => path.join(basePath, `index${extension}`)),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }

    throw new Error(`Unable to resolve module "${specifier}" from ${fromFilepath}.`);
};

const loadTsModule = (filepath: string): unknown => {
    const normalizedFilepath = path.resolve(filepath);
    if (moduleCache.has(normalizedFilepath)) return moduleCache.get(normalizedFilepath);

    const source = fs.readFileSync(normalizedFilepath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        fileName: normalizedFilepath,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
            resolveJsonModule: true,
            jsx: ts.JsxEmit.ReactJSX,
        },
    }).outputText;

    const module = { exports: {} as Record<string, unknown> };
    moduleCache.set(normalizedFilepath, module.exports);

    const requireFromFile = createRequire(normalizedFilepath);
    const runtimeRequire = (specifier: string) => {
        if (specifier === 'proteum/config' || specifier === 'proteum/config.ts') return { Application: ApplicationConfig };

        if (specifier.startsWith('.') || specifier.startsWith('/')) {
            const resolved = resolveLocalModulePath(specifier, normalizedFilepath);

            if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) return loadTsModule(resolved);

            return requireFromFile(resolved);
        }

        return requireFromFile(specifier);
    };

    const evaluate = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled);
    evaluate(runtimeRequire, module, module.exports, normalizedFilepath, path.dirname(normalizedFilepath));

    moduleCache.set(normalizedFilepath, module.exports);

    return module.exports;
};

const getDefaultExport = <T>(value: unknown): T => {
    if (value && typeof value === 'object' && 'default' in (value as Record<string, unknown>))
        return (value as { default: T }).default;

    return value as T;
};

export const identityConfigFilename = 'identity.config.ts';
export const setupConfigFilename = 'proteum.config.ts';

export const resolveIdentityConfigFilepath = (appDir: string) => path.join(appDir, identityConfigFilename);
export const resolveSetupConfigFilepath = (appDir: string) => path.join(appDir, setupConfigFilename);

export const loadApplicationIdentityConfig = (appDir: string): TApplicationIdentityConfig => {
    const filepath = resolveIdentityConfigFilepath(appDir);
    if (!fs.existsSync(filepath)) throw new Error(`Missing ${identityConfigFilename} in ${appDir}.`);
    loadOptionalProteumDotenv(appDir);

    return normalizeApplicationIdentityConfig(getDefaultExport(loadTsModule(filepath)), filepath);
};

export const loadApplicationSetupConfig = (appDir: string): TApplicationSetupConfig => {
    const filepath = resolveSetupConfigFilepath(appDir);
    if (!fs.existsSync(filepath)) throw new Error(`Missing ${setupConfigFilename} in ${appDir}.`);
    loadOptionalProteumDotenv(appDir);

    return normalizeApplicationSetupConfig(getDefaultExport(loadTsModule(filepath)), filepath);
};
