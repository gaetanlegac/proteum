import type { App, TAppSide } from '@cli/app';
import type { RuleSetRule } from '@rspack/core';

type TScriptRuleOptions = { app: App; side: TAppSide; dev: boolean };

const shouldExcludeNodeModule = (app: App, filePath: string) => {
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    if (!normalizedFilePath.includes('/node_modules/')) return false;

    if (
        normalizedFilePath.includes('/node_modules/proteum/') &&
        !normalizedFilePath.includes('/node_modules/proteum/node_modules/')
    ) {
        return false;
    }

    if (app.isTranspileModuleFile(normalizedFilePath)) return false;

    return true;
};

const getSwcTarget = (side: TAppSide) => (side === 'client' ? 'es2022' : 'es2021');

module.exports = ({ app, side, dev }: TScriptRuleOptions): RuleSetRule[] => {
    return [
        {
            loader: 'builtin:swc-loader',
            type: 'javascript/auto',
            exclude: (filePath: string) => shouldExcludeNodeModule(app, filePath),
            options: {
                sourceMaps: true,
                jsc: {
                    target: getSwcTarget(side),
                    loose: true,
                    parser: { syntax: 'typescript', tsx: true, decorators: false, dynamicImport: true },
                    transform: {
                        react: { runtime: 'automatic', importSource: 'preact', development: dev, refresh: false },
                    },
                },
            },
        },
    ];
};
