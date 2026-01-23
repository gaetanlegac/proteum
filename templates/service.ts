// Regex: \/server\/libs\/.+\.ts$

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm

// Core
import { $ } from '@server/app';

// App
import User from '@/server/models';

/*----------------------------------
- CONFIG
----------------------------------*/



/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- SERVICE
----------------------------------*/
class NAMEs {

    /*----------------------------------
    - INFORMATIONS
    ----------------------------------*/
    public async List( user: User | null ): Promise<NAME[]> {

        const NAMELOWER = await $.sql<NAME>`
            SELECT 
                id
            FROM core.NAME
            ORDER BY date DESC
            LIMIT 25
        `.all();

        return NAMELOWER;

    }

    public async Get( id: string, user: User ): Promise<NAME> {

        const NAMELOWERs = await $.sql<NAME>`
            SELECT 
                id
            FROM core.NAME
            WHERE id = ${id}
        `.firstOrFail();

        return NAMELOWERs;

    }

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/
    public async Action( id: string, user: User ): Promise<NAME> {

        const NAMELOWER = await this.Get(id, user);

        return true;

    }


}

export default new NAMEs