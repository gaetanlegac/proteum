/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import sizeOf from 'object-sizeof';

// Core

// Specific
import type CacheManager from '.';

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- SERVICE
----------------------------------*/
export default (cache: CacheManager, app = cache.app) => [

   app.command('cache', 'Manage the cache service', [

        app.command('list', 'List cache entries', async () => {

            return Object.entries(cache.data).map(([ key, entry ]) => ({
                key,
                type: typeof entry?.value,
                size: sizeOf(entry?.value),
                expires: entry?.expiration || 'No expiration'
            }))
        }),

        app.command('delete', 'List cache entries', async (key?: string) => {

            await cache.del(key);

            return true;
        })
   ])
]