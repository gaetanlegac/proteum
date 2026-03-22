/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Set timezone
process.env.TZ = 'UTC';
import 'source-map-support/register';

// Npm
import path from 'path';

// Core
import type Application from '..';
import type { StartedServicesIndex } from '../service';
import Services, { ServicesContainer } from '../service/container';
import ConfigParser, { TEnvConfig } from './config';
import Console from './console';
import type ServerRequest from '@server/services/router/request';

/*----------------------------------
- CLASS
----------------------------------*/
export class ApplicationContainer<TServicesIndex extends StartedServicesIndex = StartedServicesIndex> {
    /*----------------------------------
    - STATE
    ----------------------------------*/

    public Services = Services as ServicesContainer<TServicesIndex>;
    public Environment: TEnvConfig;
    public Identity: Config.Identity;
    public Console: Console;

    public application?: Application;

    // Runtime path registry used by the application container and generators.
    public path = {
        root: process.cwd(),
        public: path.join(process.cwd(), '/public'),
        var: path.join(process.cwd(), '/var'),

        client: { generated: path.join(process.cwd(), 'src', 'client', '.generated') },
        server: { generated: path.join(process.cwd(), 'src', 'server', '.generated') },
    };

    /*----------------------------------
    - CONFIG
    ----------------------------------*/

    public constructor() {
        // Load config files
        const configParser = new ConfigParser(this.path.root);
        this.Environment = configParser.env();
        this.Identity = configParser.identity();
        this.Console = new Console(this, this.Environment.console);
    }

    /*----------------------------------
    - PUBLIC API
    ----------------------------------*/

    public start<TApplication extends Application>(ApplicationClass: new () => TApplication): TApplication {
        // Instanciate Application
        try {
            this.application = new ApplicationClass();
        } catch (error) {
            this.handleBug(error, 'Failed to instanciate the Application Class');
            process.exit(1);
        }

        // Start application
        try {
            this.application.start();
        } catch (error) {
            this.handleBug(error, 'Failed to start the Application');
            process.exit(1);
        }

        return this.application as TApplication;
    }

    public async handleBug(rejection: unknown, message: string, request?: ServerRequest) {
        const error =
            rejection instanceof Error ? rejection : new Error(typeof rejection === 'string' ? rejection : message);

        if (this.Console) {
            try {
                this.Console.createBugReport(error, request);
            } catch (consoleError) {
                console.error(message, error, 'Failed to transmiss the previous error to console:', consoleError);
                process.exit(1);
            }
        } else {
            console.error(message, error);
            process.exit(1);
        }
    }
}

export default new ApplicationContainer();
