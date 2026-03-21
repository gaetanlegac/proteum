import { InputError } from '@common/errors';
import zod, { _ZodType } from 'zod';

export type TRichTextValidatorOptions = { attachements?: boolean };

export const preprocessSchema = (schema: zod.ZodObject): zod.ZodObject => {
    // Not working, data is {}
    return schema;

    if (!(schema instanceof zod.ZodObject)) return schema;

    if (schema.withPreprocessing) return schema;

    const shape = schema.def.shape;
    const newShape: Record<string, zod.ZodTypeAny> = {};

    for (const key in shape) {
        if (!['newEntity', 'email'].includes(key)) continue;

        let current: zod.ZodTypeAny = shape[key];
        while (current) {
            const origType = current.type;
            const preprocessor = toPreprocess[origType];

            if (origType === 'object') {
                newShape[key] = preprocessSchema(current as zod.ZodObject);
                break;
            }

            if (preprocessor) {
                newShape[key] = preprocessor(current);
                console.log('====newShape', key, newShape[key]);
                break;
            }

            current = current.def;
        }
    }

    const newSchema = zod.object(newShape);
    newSchema.withPreprocessing = true;
    return newSchema;
};

const toPreprocess = {
    string: (zString: zod.ZodString) =>
        zod.preprocess((val) => {
            return val === '' ? undefined : val;
        }, zString),

    int: (zInt: zod.ZodInt) =>
        zod.preprocess((val) => {
            return typeof val === 'string' ? Number.parseInt(val) : val;
        }, zInt),
};

export const schema = {
    ...zod,

    file: () => {
        // Chaine = url ancien fichier = exclusion de la valeur pour conserver l'ancien fichier
        // NOTE: Si la valeur est présente mais undefined, alors on supprimera le fichier
        /*if (typeof val === 'string')
            return true;*/

        return zod.file();
    },

    choice: (choices: string[] | { value: any; label: string }[] | _ZodType, options: { multiple?: boolean } = {}) => {
        const normalizeValue = (value: any) => (typeof value === 'object' ? value.value : value);

        const valueType: _ZodType = Array.isArray(choices) ? zod.enum(choices.map(normalizeValue)) : zod.string();

        const itemType = zod.union([zod.object({ value: valueType, label: zod.string() }), valueType]);

        const type = options.multiple ? zod.array(itemType) : itemType;

        return type.transform((v) => {
            if (options.multiple) {
                return v.map(normalizeValue);
            } else {
                return normalizeValue(v);
            }
        });
    },

    richText: (opts: TRichTextValidatorOptions = {}) =>
        schema.custom((val) => {
            if (typeof val !== 'string') {
                console.error('Invalid rich text format.', val);
                return false;
            }

            // We get a stringified json as input since the editor workds with JSON string
            try {
                val = JSON.parse(val);
            } catch (error) {
                console.error('Failed to parse rich text json:', error, val);
                return false; //throw new InputError("Invalid rich text format.");
            }

            // Check that the root exists and has a valid type
            if (!val || typeof val !== 'object' || typeof val.root !== 'object' || val.root.type !== 'root') {
                console.error('Invalid rich text value (1).', val);
                return false; //throw new InputError("Invalid rich text value (1).");
            }

            // Check if root has children array
            if (!Array.isArray(val.root.children)) {
                console.error('Invalid rich text value (2).', val);
                return false;
            }

            // Validate each child node in root
            for (const child of val.root.children) {
                if (!validateLexicalNode(child, opts)) return false;
            }

            return true;
        }),
};

// Recursive function to validate each node
function validateLexicalNode(node: any, opts: TRichTextValidatorOptions) {
    // Each node should be an object with a `type` property
    if (typeof node !== 'object' || !node.type || typeof node.type !== 'string')
        throw new InputError('Invalid rich text value (3).');

    // Validate text nodes
    if (node.type === 'text') {
        if (typeof node.text !== 'string') throw new InputError('Invalid rich text value (4).');

        // Validate paragraph, heading, or other structural nodes that may contain children
    } else if (['paragraph', 'heading', 'list', 'listitem'].includes(node.type)) {
        if (!Array.isArray(node.children) || !node.children.every((children) => validateLexicalNode(children, opts))) {
            throw new InputError('Invalid rich text value (5).');
        }

        // Files upload
    } else if (node.type === 'image') {
        // Check if allowed
        /*if (opts.attachements === undefined)
            throw new InputError("Image attachments not allowed in this rich text field.");*/
        // TODO: check mime
        // Upload file
    }

    return true;
}

export type { default as z } from 'zod';
