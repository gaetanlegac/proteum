/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import Response from '../response';

// Types
import type { TBasicUser } from '@server/services/auth';

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- CONTEXT
----------------------------------*/
export default abstract class BaseRequest {

    // Permet d'accèder à l'instance complète via spread
    public request: this = this;
    public url!: string;
    public host!: string;

    public data: TObjetDonnees = {};
    public abstract response?: Response;
    public user: TBasicUser | null = null;

    public constructor(
        public path: string,
    ) {

    }
}