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
export class ApplicationContainer<
    TServicesIndex extends StartedServicesIndex = StartedServicesIndex
> {

    /*----------------------------------
    - INIT
    ----------------------------------*/

    public Services = Services as ServicesContainer<TServicesIndex>;
    public Environment: TEnvConfig;
    public Identity: Config.Identity;
    public Console: Console;

    public application?: Application;

    public constructor() {

        // Load config files
        const configParser = new ConfigParser( this.path.root );
        this.Environment = configParser.env();
        this.Identity = configParser.identity();
        this.Console = new Console(this, this.Environment.console);
    }

    // Context
    public hmr: __WebpackModuleApi.Hot | undefined = module.hot;

    public path = {
        root: process.cwd(),
        public: path.join( process.cwd(), '/public'),
        var: path.join( process.cwd(), '/var'),

        client: {
            generated: path.join( process.cwd(), 'src', 'client', '.generated')
        },
        server: {
            generated: path.join( process.cwd(), 'src', 'server', '.generated')
        },
    }

    public start( ApplicationClass: typeof Application ): Application {

        // Instanciate Application
        try {
            this.application = new ApplicationClass;
        } catch (error) {
            this.handleBug(error, "Failed to instanciate the Application Class");
            process.exit(1);
        }

        // Start application
        try {
            this.application.start();
        } catch (error) {
            this.handleBug(error, "Failed to start the Application");
            process.exit(1);
        }

        return this.application;
    }

    public async handleBug( rejection: Error, message: string, request?: ServerRequest ) {
        if (this.Console) {
            try {

                this.Console.createBugReport(rejection, request);

            } catch (consoleError) {
                console.error(
                    message, rejection, 
                    "Failed to transmiss the previous error to console:", consoleError
                );
                process.exit(1);
            }
        } else {
            console.error(message, rejection);
            process.exit(1);
        }
    }


    /*----------------------------------
    - HMR
    - TODO: move in dev server
    ----------------------------------*/
    private activateHMR() {

        if (!module.hot) return;

        console.info(`Activating HMR ...`);

        module.hot.accept();
        module.hot.accept( this.path.root + '/.cache/commun/routes.ts' );

        module.hot.addDisposeHandler((data) => {

            console.info(`Cleaning application ...`);

            // Services hooks
            //this.app.shutdown();

            /*
            console.log("[nettoyage] Arrêt serveur socket ...");
            if (socket !== undefined)
                socket.serveur.close()

            console.log("[nettoyage] Reset du cache requêtes JSQL ...");
            QueryParser.clearCache();*/

        });
    }

}

export default new ApplicationContainer;