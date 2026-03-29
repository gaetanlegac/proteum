/*----------------------------------
- DEPENDANCES
----------------------------------*/

/*
    WARNING: This file SHOULDN'T import deps from the project
        Because it's imported by the CLI, which should be independant of the app escept for loading config
*/

// Types
import type { TApplicationIdentityConfig, TApplicationSetupConfig } from '../../../common/applicationConfig';
import { loadApplicationIdentityConfig, loadApplicationSetupConfig } from '../../../common/applicationConfigLoader';
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
        type Setup = AppSetupConfig;
        interface Services {}
    }
}

export type TEnvName = TEnvConfig['name'];
export type TEnvConfig = TProteumLoadedEnvConfig;

type AppIdentityConfig = TApplicationIdentityConfig;
type AppSetupConfig = TApplicationSetupConfig;

export type AppConfig = { env: Config.Env; identity: Config.Identity; setup: Config.Setup };

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

    public env(): TEnvConfig {
        debug && console.info('[app] Loading Proteum env vars from process.env');
        const setup = this.setup();

        return {
            ...parseProteumEnvConfig({
                appDir: this.appDir,
                connectedProjects: setup.connect,
                routerPortOverride: getRouterPortOverride(),
            }),
            version: BUILD_DATE,
        };
    }

    public identity(): Config.Identity {
        const identityFile = this.appDir + '/identity.config.ts';
        debug && console.info(`Loading identity ${identityFile}`);
        return loadApplicationIdentityConfig(this.appDir);
    }

    public setup(): Config.Setup {
        const setupFile = this.appDir + '/proteum.config.ts';
        debug && console.info(`Loading setup ${setupFile}`);
        return loadApplicationSetupConfig(this.appDir);
    }
}
