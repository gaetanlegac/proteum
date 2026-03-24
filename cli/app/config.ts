/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import fs from 'fs-extra';
import yaml from 'yaml';

// Types
import { parseProteumEnvConfig, type TProteumLoadedEnvConfig } from '../../common/env/proteumEnv';
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

    private loadYaml(filepath: string) {
        logVerbose(`Loading config ${filepath}`);
        const rawConfig = fs.readFileSync(filepath, 'utf-8');
        return yaml.parse(rawConfig);
    }

    public env(): TProteumLoadedEnvConfig {
        logVerbose('[app] Loading Proteum env vars from process.env');
        return {
            ...parseProteumEnvConfig({
                appDir: this.appDir,
                routerPortOverride: this.routerPortOverride,
            }),
            version: 'CLI',
        };
    }

    public identity() {
        const identityFile = this.appDir + '/identity.yaml';
        return this.loadYaml(identityFile);
    }
}
