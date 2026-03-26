export type TScaffoldKind = 'page' | 'controller' | 'command' | 'route' | 'service';

export type TScaffoldFilePlan = {
    relativePath: string;
    content: string;
};

export type TScaffoldResult = {
    dryRun: boolean;
    created: string[];
    updated: string[];
    skipped: string[];
    notes: string[];
    nextSteps: string[];
};

export type TScaffoldInitConfig = {
    directory: string;
    name: string;
    identifier: string;
    description: string;
    port: number;
    url: string;
    install: boolean;
    proteumDependency: string;
};
