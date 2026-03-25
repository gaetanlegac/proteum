import { Commands } from '@server/app/commands';

export default class ProteumDiagnosticsCommands extends Commands {
    public async ping() {
        return {
            app: this.app.identity.identifier,
            envProfile: this.app.env.profile,
            services: Object.keys(this.app.getRootServices()),
        };
    }
}
