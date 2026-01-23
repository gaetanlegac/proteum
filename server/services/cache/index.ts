/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Node
import path from 'path';

// Npm
import hInterval from 'human-interval';

// Core
import type { Application } from '@server/app';
import Service, { AnyService, TRegisteredService } from '@server/app/service';
import type { default as DisksManager, Driver } from '../disks';

// Specific
import registerCommands from './commands';

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = '[cache]';

/*----------------------------------
- TYPES
----------------------------------*/

type TPrimitiveValue = string | boolean | number | undefined | TPrimitiveValue[] | {
    [key: string]: TPrimitiveValue
}

type TExpirationDelay = 'never' | string | number | Date;

type CacheEntry<TValue extends TPrimitiveValue =TPrimitiveValue > = { 
    // Value
    value: TValue, 
    // Expiration Timestamp
    expiration?: number,
    changes: number
};

type TCacheGetOrUpdateArgs<TValeur extends TPrimitiveValue> = [
    cle: string, 
    func: (() => Promise<TValeur>),
    expiration?: TExpirationDelay,
    avecDetails?: boolean
]

type TCacheGetOnlyArgs = [
    cle: string, 
    avecDetails: true
]

/*----------------------------------
- TYPES
----------------------------------*/

export type Config = {
    debug: boolean,
    disk: string, // TODO: keyof disks
    disks: DisksManager
}

export type Hooks = {

}

/*----------------------------------
- SERVICE
----------------------------------*/
export default class Cache extends Service<Config, Hooks, Application> {

    public commands = registerCommands(this);

    public data: {[key: string]: CacheEntry | undefined} = {};

    private disk: Driver;

    public constructor( 
        parent: AnyService, 
        config: Config,
        app: Application, 
    ) {

        super(parent, config, app);

        this.disk = this.config.disks.get(config.disk)
    }

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public async ready() {

        setInterval(() => this.cleanMem(), 10000);
    }

    public async shutdown() {

    }

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/
    private async restore() {
        const files = await this.disk.readDir('data', 'cache')
        for (const file of files) {

            if (!file.name.endsWith('.json'))
                continue;

            const entryKey = file.name.substring(0, file.name.length - 5);
            const filePath = path.join('cache', file.name);
            this.data[ entryKey ] = await this.disk.readJSON('data', filePath);
            console.log(LogPrefix, `Restored cache entry ${entryKey}`);
        }
    }

    private cleanMem() {

        // Remove expired data
        const now = Date.now();
        for (const key in this.data) {
            const entry = this.data[ key ];
            if (entry?.expiration && entry.expiration < now) {
                this.config.debug && console.log(LogPrefix, `Delete expired data: ${key}`);
                this.del(key);
            }
        }
        
        // Write changes
        for (const entryKey in this.data) {

            const entry = this.data[entryKey];
            if (!entry?.changes)
                continue;

            this.config.debug && console.log(LogPrefix, `Flush ${entry.changes} changes for ${entryKey}`);

            entry.changes = 0;
            const entryFile = this.getEntryFile(entryKey);
            fs.outputJSONSync(entryFile , this.data[entryKey]);
        }
    }

    private getEntryFile( entryKey: string ) {
        return path.join(this.cacheDir, entryKey + '.json');
    }

    public get<TValeur extends TPrimitiveValue>(
        cle: string, 
        avecDetails?: true
    ): Promise<CacheEntry<TValeur> | TValeur | undefined>;

    // Expiration = Durée de vie en secondes ou date max
    // Retourne null quand pas de valeur
    public get<TValeur extends TPrimitiveValue>(
        cle: string, 
        func: (() => Promise<TValeur>),
        expiration: TExpirationDelay,
        avecDetails: true
    ): Promise<CacheEntry<TValeur>>;

    public get<TValeur extends TPrimitiveValue>(
        cle: string, 
        func: (() => Promise<TValeur>),
        expiration?: TExpirationDelay,
        avecDetails?: false
    ): Promise<TValeur>;

    public async get<TValeur extends TPrimitiveValue, TArgs extends TCacheGetOnlyArgs | TCacheGetOrUpdateArgs<TValeur> = TCacheGetOnlyArgs | TCacheGetOrUpdateArgs<TValeur>>(
        ...args: TArgs
    ): Promise< TValeur | CacheEntry<TValeur> | (TArgs extends TCacheGetOnlyArgs ? undefined : TValeur)> {

        let cle: string;
        let func: (() => Promise<TValeur>) | undefined;
        let expiration: TExpirationDelay | undefined;
        let avecDetails: boolean | undefined = true;

        if (typeof args[1] === 'function') {
            ([ cle, func, expiration, avecDetails ] = args);
        } else {
            ([ cle, avecDetails ] = args);
        }

        if (expiration === undefined)
            expiration = 'never';

        let entry: CacheEntry<TValeur> | undefined = this.data[cle];

        // Expired
        if (entry?.expiration && entry.expiration < Date.now()){
            this.config.debug && console.log(LogPrefix, `Key ${cle} expired.`);
            entry = undefined;
        }

        // Donnée inexistante
        if (entry !== undefined) {

            this.config.debug && console.log(LogPrefix, `Get "${cle}": restored via cache`);
            
        } else if (func !== undefined) {

            this.config.debug && console.log(LogPrefix, `Get "${cle}": refresh value`);

            // Rechargement
            entry = {
                value: await func(),
                expiration: this.delayToTimestamp(expiration),
                changes: 0
            }

            if (expiration !== 'now')
                await this.set(cle, entry.value, expiration);

        } else
            return undefined;

        return avecDetails 
            ? entry
            : entry.value as TValeur;
    };

    /**
     * Put in cache a JSON value, associated with an unique ID.
     * @param cle Unique identifier for the cache entry. Used to retrieve the value via Cache.set()
     * @param val The value to put in cache
     * @param expiration The interval in which the data is valid.
     *  - string: the humain-readable expression. Exemple: 10 minutes
     *  - number: time in seconds
     *  - Date: the date at which the data expires
     *  - null: no expiration (default)
     * @returns A void promise
     */
    public set( cle: string, val: TPrimitiveValue, expiration: TExpirationDelay = 'never' ): void {

        // TODO: check is key contains illegal characters
    
        this.config.debug && console.log(LogPrefix, "Updating cache " + cle);
        this.data[ cle ] = {
            value: val,
            expiration: this.delayToTimestamp(expiration),
            changes: 1
        }
    };

    public del( key: string ): void {

        if (key === undefined) {
            this.data = {};
            console.log(LogPrefix, "Deleting all keys from cache");
            fs.removeSync( this.cacheDir );
        } else {
            this.data[ key ] = undefined;
            console.log(LogPrefix, `Deleting key "${key}" from cache`);
            const entryFile = this.getEntryFile(key);
            fs.removeSync( entryFile );
        }
    }


    /*----------------------------------
    - UTILS
    ----------------------------------*/
    /**
     * 
     * @param delay 
     * @returns number (timestamp when the data expired) or undefined (never expires)
     */
    private delayToTimestamp( delay: TExpirationDelay ): number | undefined {

        if (delay === 'now') {

            return Date.now();

        } else if (delay === 'never') {

            return undefined;

        // H expression
        } else if (typeof delay === 'string') {

            const ms = hInterval(delay); 
            if (ms === undefined) throw new Error(`Invalid period string: ` + delay);
            return Date.now() + ms;

        // Lifetime in seconds
        } else if (typeof delay === 'number')
            return Date.now() + delay;

        // Date limit
        else
            return delay.getTime();
    }
}
