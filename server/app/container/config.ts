/*----------------------------------
- DEPENDANCES
----------------------------------*/

/*
    WARNING: This file SHOULDN'T import deps from the project
        Because it's imported by the CLI, which should be independant of the app escept for loading config
*/

// Npm
import fs from 'fs-extra';
import yaml from 'yaml';

// Types
import { parseProteumEnvConfig, type TProteumLoadedEnvConfig } from '../../../common/env/proteumEnv';

declare const PROTEUM_PORT_OVERRIDE: number | null;
declare const BUILD_DATE: string;

/*----------------------------------
- TYPES
----------------------------------*/

declare global {
    namespace Config {
        type EnvName = TEnvConfig['name'];

        type Env = TEnvConfig;
        type Identity = AppIdentityConfig;
        interface Services {}
    }
}

export type TEnvName = TEnvConfig['name'];
export type TEnvConfig = TProteumLoadedEnvConfig;

type AppIdentityConfig = {
    name: string;
    identifier: string;
    description: string;
    author: { name: string; url: string; email: string };

    social: {};

    locale: string;
    language: string;
    maincolor: string;
    iconsPack?: string;

    web: {
        title: string;
        titleSuffix: string;
        fullTitle: string;
        description: string;
        version: string;
        metas?: { [name: string]: string };
        jsonld?: { [name: string]: string };
    };
};

export type AppConfig = { env: Config.Env; identity: Config.Identity };

const debug = false;

const getRouterPortOverride = () => {
    if (typeof PROTEUM_PORT_OVERRIDE !== 'undefined' && PROTEUM_PORT_OVERRIDE !== null) return PROTEUM_PORT_OVERRIDE;

    return undefined;
};

/*----------------------------------
- LOADE
----------------------------------*/
export default class ConfigParser {
    public constructor(
        public appDir: string,
        public envName?: string,
    ) {}

    private loadYaml(filepath: string) {
        debug && console.info(`Loading config ${filepath}`);
        const rawConfig = fs.readFileSync(filepath, 'utf-8');
        return yaml.parse(rawConfig);
    }

    public env(): TEnvConfig {
        debug && console.info('[app] Loading Proteum env vars from process.env');

        return {
            ...parseProteumEnvConfig({
                appDir: this.appDir,
                routerPortOverride: getRouterPortOverride(),
            }),
            version: BUILD_DATE,
        };
    }

    public identity() {
        const identityFile = this.appDir + '/identity.yaml';
        debug && console.info(`Loading identity ${identityFile}`);
        return this.loadYaml(identityFile);
    }
}

/*const walkYaml = (dir: string, configA: any, envName: string) => {

    const files = fs.readdirSync(dir);
    for (const file of files) {

        const fullpath = dir + '/' + file;

        // extension .yaml
        const isDir = fs.lstatSync(fullpath).isDirectory();
        let key = file;
        if (!isDir) {

            if (!file.endsWith('.yaml'))
                continue;

            key = key.substring(0, key.length - 5);

        }

        let fileConfig = configA;

        // Ciblage environnement
        // Before: /config/services/env.<envName>.yaml
        // After: /config/services
        if (key.startsWith('env.')) {

            // Excluding not mtching env name
            if (key.substring(4) !== envName)
                continue;

        // Créé l'entrée dans la config, sauf si le nom du fichier est default
        } else if (key !== 'default') {

            // Init config
            if (!(key in fileConfig))
                fileConfig[key] = {};

            fileConfig = configA[key];

        }

        // Recursion
        if (isDir)
            walk(fullpath, fileConfig, envName);
        // Lecture fichier
        else
            deepExtend(fileConfig, loadYaml(fullpath));

    }
}*/
