/*----------------------------------
- DEPENDANCES
----------------------------------*/

// npm
import path from 'path';
import TsAlias from 'ts-alias';
import fs from 'fs-extra';

// Cre
import cli from '..';

// Specific
import { normalizeTranspileConfig } from '../../common/applicationConfig';
import { normalizeConnectedProjectsConfig } from '../../common/connectedProjects';
import ConfigParser from './config';
import type { TEnvConfig } from '../../server/app/container/config';

/*----------------------------------
- TYPES
----------------------------------*/

export type TAppSide = 'server' | 'client';

const parseRouterPortOverride = (rawPort: string | boolean | string[] | undefined): number | undefined => {
    if (rawPort === undefined || rawPort === '') return undefined;

    if (typeof rawPort !== 'string') throw new Error(`Invalid value for -port: expected a numeric value.`);

    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error(`Invalid value for -port: "${rawPort}". Expected an integer between 1 and 65535.`);

    return port;
};

const normalizeModulePath = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '');

const resolveSideTsconfig = (appRoot: string, side: TAppSide) => {
    const candidates = [path.join(appRoot, side, 'tsconfig.json'), path.join(appRoot, side, 'app.tsconfig.json')];

    return candidates.find((candidate) => fs.existsSync(candidate));
};

const resolveTranspileModuleDirectories = ({
    moduleNames,
    resolvePackageRoot,
    getVisiblePackageInstallRoots,
}: {
    moduleNames: string[];
    resolvePackageRoot: (moduleName: string) => string;
    getVisiblePackageInstallRoots: (moduleName: string) => string[];
}) => {
    const directories = new Set<string>();

    for (const moduleName of moduleNames) {
        const candidates = new Set<string>();

        try {
            candidates.add(normalizeModulePath(resolvePackageRoot(moduleName)));
        } catch {}

        for (const visibleInstallRoot of getVisiblePackageInstallRoots(moduleName)) {
            candidates.add(normalizeModulePath(visibleInstallRoot));
        }

        for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;

            directories.add(candidate);

            try {
                directories.add(normalizeModulePath(fs.realpathSync(candidate)));
            } catch {}
        }
    }

    return [...directories];
};

/*----------------------------------
- SERVICE
----------------------------------*/
export class App {
    // config
    // WARNING: High level config files (env and services) shouldn't be loaded from the CLI
    //  The CLI will be run on CircleCI, and no env file should be sent to this service
    public identity: Config.Identity;
    public setup: Config.Setup;

    public env: TEnvConfig;

    public routerPortOverride?: number;

    public devEventPort?: number;

    public packageJson: { [key: string]: any };

    public buildId: number = Date.now();

    public paths = {
        root: cli.paths.appRoot,
        bin: path.join(cli.paths.appRoot, 'bin'),
        dev: path.join(cli.paths.appRoot, 'dev'),
        data: path.join(cli.paths.appRoot, 'var', 'data'),
        public: path.join(cli.paths.appRoot, 'public'),
        pages: path.join(cli.paths.appRoot, 'client', 'pages'),
        cache: path.join(cli.paths.appRoot, '.cache'),
        proteum: path.join(cli.paths.appRoot, '.proteum'),

        client: { generated: path.join(cli.paths.appRoot, '.proteum', 'client') },
        server: {
            entry: path.join(cli.paths.appRoot, 'server', 'index.ts'),
            generated: path.join(cli.paths.appRoot, '.proteum', 'server'),
        },
        common: { generated: path.join(cli.paths.appRoot, '.proteum', 'common') },

        withAlias: (filename: string, side: TAppSide) => this.aliases[side].apply(filename),

        withoutAlias: (filename: string, side: TAppSide) => this.aliases[side].realpath(filename),
    };

    public containerServices = [
        //'Services',
        'Environment',
        'Identity',
        'Setup',
        /*'Application',
        'Path',
        'Event'*/
    ];

    public constructor() {
        cli.debug && console.log(`[cli] Loading app config ...`);
        this.routerPortOverride = parseRouterPortOverride(cli.args.port);

        const configParser = new ConfigParser(cli.paths.appRoot, undefined, this.routerPortOverride);
        this.identity = configParser.identity();
        this.setup = configParser.setup();
        this.env = configParser.env();
        this.packageJson = this.loadPkg();
    }

    public outputPath(target: 'dev' | 'bin') {
        return target === 'dev' ? this.paths.dev : this.paths.bin;
    }

    public get transpile() {
        return normalizeTranspileConfig(this.setup.transpile);
    }

    public get connectedProjects() {
        return normalizeConnectedProjectsConfig(this.setup.connect);
    }

    public get transpileModuleDirectories() {
        return resolveTranspileModuleDirectories({
            moduleNames: this.transpile,
            resolvePackageRoot: (moduleName) => cli.paths.resolvePackageRoot(moduleName),
            getVisiblePackageInstallRoots: (moduleName) => cli.paths.getVisiblePackageInstallRoots(moduleName),
        });
    }

    public isTranspileModuleFile(filepath: string) {
        const normalizedFilepath = normalizeModulePath(path.resolve(filepath));
        let normalizedRealFilepath: string | undefined;

        try {
            normalizedRealFilepath = normalizeModulePath(fs.realpathSync(filepath));
        } catch {}

        return this.transpileModuleDirectories.some(
            (directory) =>
                normalizedFilepath === directory ||
                normalizedFilepath.startsWith(directory + '/') ||
                normalizedRealFilepath === directory ||
                normalizedRealFilepath?.startsWith(directory + '/') === true,
        );
    }

    public isTranspileModuleRequest(request: string) {
        if (path.isAbsolute(request)) return this.isTranspileModuleFile(request);

        return this.transpile.some((moduleName) => request === moduleName || request.startsWith(moduleName + '/'));
    }

    /*----------------------------------
    - ALIAS
    ----------------------------------*/

    public aliases = {
        client: this.createSideAliases('client'),
        server: this.createSideAliases('server'),
    };

    private createSideAliases(side: TAppSide) {
        const tsconfigFilepath = resolveSideTsconfig(this.paths.root, side);

        if (!tsconfigFilepath) return new TsAlias({ aliases: [] });

        return new TsAlias({
            rootDir: tsconfigFilepath,
            modulesDir: [cli.paths.framework.appNodeModulesRoot, cli.paths.framework.frameworkNodeModulesRoot],
            debug: false,
        });
    }

    private loadPkg() {
        return fs.readJSONSync(this.paths.root + '/package.json');
    }

    public async warmup() {
        return Promise.resolve();
    }
}

export const app = new App();

export default app;
