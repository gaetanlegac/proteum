/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type Application from ".";

/*----------------------------------
- TYPES: OPTIONS
----------------------------------*/

export type AnyService = Service<{}, Application>

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class Service<
    TConfig extends {}, 
    TApplication extends Application
> {
    public constructor( 
        public app: TApplication, 
        public config: TConfig,
    ) {

        // No client service should be loaded from server side
        if (typeof window === 'undefined')
            throw new Error(`Client services shouldn't be loaded on server side.`);

        // Make the app aware of his services
        app.registerService(this);
    }

    public abstract start(): void;
}