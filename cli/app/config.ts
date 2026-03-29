/*----------------------------------
- DEPENDANCES
----------------------------------*/

import { parseProteumEnvConfig, type TProteumLoadedEnvConfig } from '../../common/env/proteumEnv';
import { loadApplicationIdentityConfig, loadApplicationSetupConfig } from '../../common/applicationConfigLoader';
import { logVerbose } from '../runtime/verbose';

/*----------------------------------
- LOADE
----------------------------------*/
export default class ConfigParser {
    public constructor(
        public appDir: string,
        public envName?: string,
        public routerPortOverride?: number,
    ) {}

    public env(): TProteumLoadedEnvConfig {
        logVerbose('[app] Loading Proteum env vars from process.env');
        const setup = this.setup();
        return {
            ...parseProteumEnvConfig({
                appDir: this.appDir,
                connectedProjects: setup.connect,
                routerPortOverride: this.routerPortOverride,
            }),
            version: 'CLI',
        };
    }

    public identity(): Config.Identity {
        const identityFile = this.appDir + '/identity.config.ts';
        logVerbose(`Loading config ${identityFile}`);
        return loadApplicationIdentityConfig(this.appDir);
    }

    public setup(): Config.Setup {
        const setupFile = this.appDir + '/proteum.config.ts';
        logVerbose(`Loading config ${setupFile}`);
        return loadApplicationSetupConfig(this.appDir);
    }
}
