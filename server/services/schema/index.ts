/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app/index';

// Specific
import { schema, type TRichTextValidatorOptions } from '@server/services/router/request/validation/zod';

/*----------------------------------
- TYPES
----------------------------------*/

export type TFileValidator = boolean;
export type TValidatorOptions<TValue> = { default?: TValue; optional?: boolean };

type TCompatValidator<TValue> = {
    validate: (value: unknown, options?: unknown, path?: string[]) => TValue;
};

/*----------------------------------
- SERVICE
----------------------------------*/
export default class ServerSchemaValidator {
    public constructor(public app: Application) {
        void app;
    }

    public richText = (
        opts: TValidatorOptions<string> & { attachements?: TFileValidator } = {},
    ): TCompatValidator<string> => ({
        validate: (value: unknown) => schema.richText(opts as TRichTextValidatorOptions).parse(value) as string,
    });
}
