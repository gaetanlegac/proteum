/*----------------------------------
- DEPENDANCES
----------------------------------*/

/*
    NOTE: This is a copy of core/sever/app/config
    We can't import core deps here because it will cause the following error:
        "Can't use import when not a module"
    It will be possible to import core files when the CLI will be compiled as one output file with tsc
    And for that, we need to fix the TS errors for the CLI
*/

// Npm
import fs from 'fs-extra';
import yaml from 'yaml';

// Types
import type { TEnvConfig } from '../../server/app/container/config';
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

    public env(): TEnvConfig {
        // We assume that when we run 5htp dev, we're in local
        // Otherwise, we're in production environment (docker)
        logVerbose('[app] Using environment:', process.env.NODE_ENV);
        const envFileName = this.appDir + '/env.yaml';
        const envFile = this.loadYaml(envFileName);
        return {
            ...envFile,
            router:
                this.routerPortOverride === undefined
                    ? envFile.router
                    : { ...envFile.router, port: this.routerPortOverride },
            version: 'CLI',
        };
    }

    public identity() {
        const identityFile = this.appDir + '/identity.yaml';
        return this.loadYaml(identityFile);
    }
}
