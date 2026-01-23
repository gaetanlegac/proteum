

/*
    NOTE: Replaced by AES
*/


/*----------------------------------
-  DEPS
----------------------------------*/

// NPM
import { v4 as uuid } from 'uuid';
import hInterval from 'human-interval';

// Core
import Cron, { CronTask } from '@server/services/cron';
import { Forbidden } from '@common/errors';

const debug = true;

/*----------------------------------
- TYPES
----------------------------------*/

type TokenOptions = {
    expires?: number, // Timestamp
    data?: any
};

/*----------------------------------
- SERVICE
----------------------------------*/
class Tokens {

    private tokens: {[token: string]: TokenOptions} = {};

    public constructor() {
        Cron.task("tokens.expiration", '*/5 * * * *', async () => {
            this.cleanExpired()
        })
    }

    private cleanExpired() {
        debug && console.log("Cleaning expired tokens ...");
        const now = Date.now();
        for (const token in this.tokens) {
            const expires = this.tokens[token].expires;
            if (expires !== undefined && expires < now) {
                debug && console.log("Expired: " + token);
                delete this.tokens[token];
            }
        }
    }

    public create( duration?: string, data?: any ) {

        const now = Date.now();
        const token = uuid();
        const options: TokenOptions = {
            data
        }

        if (duration !== undefined) {

            const interval = hInterval(duration);
            if (!interval)
                throw new Error(`Invalid interval expression: ${duration}`);

            options.expires = now + interval;
        }
        
        this.tokens[ token ] = options;

        return token;

    }

    public get<TData extends any>( token: string, critical: boolean = true ): TData | undefined {

        const options = this.tokens[token];
        debug && console.log("Get token", token, options);
        if (options === undefined) {
            if (critical)
                throw new Forbidden(`Invalid token.`);
            else
                return undefined;
        }

        delete this.tokens[token];

        return options.data;
    }

}

export default new Tokens;