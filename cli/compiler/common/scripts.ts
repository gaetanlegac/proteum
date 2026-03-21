import type { App, TAppSide } from '@cli/app';
import type { RuleSetRule } from '@rspack/core';

type TScriptRuleOptions = { app: App; side: TAppSide; dev: boolean };

const shouldExcludeNodeModule = (filePath: string) => {
    if (!filePath.includes('node_modules')) return false;

    if (filePath.includes('node_modules/proteum') && !filePath.includes('node_modules/proteum/node_modules')) {
        return false;
    }

    return true;
};

const getSwcTarget = (side: TAppSide) => (side === 'client' ? 'es2022' : 'es2021');

module.exports = ({ side, dev }: TScriptRuleOptions): RuleSetRule[] => {
    return [
        {
            loader: 'builtin:swc-loader',
            type: 'javascript/auto',
            exclude: shouldExcludeNodeModule,
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
