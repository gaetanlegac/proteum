/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app';

// Specific
import { SchemaValidators, TFileValidator } from '@server/services/router/request/validation/validators';
import Validator, { TValidatorOptions } from '@server/services/router/request/validation/validator';

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- SERVICE
----------------------------------*/
export default class ServerSchemaValidator extends SchemaValidators {

    public constructor( public app: Application ) {
        super();
    }

    public richText = (opts: TValidatorOptions<string> & {
        attachements?: TFileValidator
    } = {}) => new Validator<string>('richText', (val, options, path) => {

        // Default validation
        val = super.richText(opts).validate(val, options, path);

        // Uploads are done in the business code since the process is specific to every case:
        // - ID in the destination directory
        // - Cleanup before upload

        return val;

    }, {
        //defaut: new Date,
        ...opts,
    })

}