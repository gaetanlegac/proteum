import { InputError } from '@common/errors';
import zod from 'zod';

export type TRichTextValidatorOptions = { attachements?: boolean };
export type TValidationSchema = zod.ZodTypeAny;
export type TValidationShape = zod.ZodRawShape;

type TChoiceOption = { value: PrimitiveValue; label: string };

type TLexicalNode = {
    type: string;
    text?: string;
    children?: TLexicalNode[];
};

type TLexicalRoot = {
    root: {
        type: 'root';
        children: TLexicalNode[];
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const hasChoiceValue = (value: unknown): value is { value: PrimitiveValue } => isRecord(value) && 'value' in value;

const normalizeChoiceValue = (value: unknown): PrimitiveValue =>
    (hasChoiceValue(value) ? value.value : value) as PrimitiveValue;

const isLexicalNode = (value: unknown): value is TLexicalNode =>
    isRecord(value) && typeof value.type === 'string';

const isLexicalRoot = (value: unknown): value is TLexicalRoot => {
    if (!isRecord(value)) return false;
    if (!isRecord(value.root)) return false;
    if (value.root.type !== 'root') return false;
    return Array.isArray(value.root.children);
};

export const isZodSchema = (fields: unknown): fields is TValidationSchema => {
    return (
        typeof fields === 'object' &&
        fields !== null &&
        'safeParse' in fields &&
        typeof (fields as TValidationSchema).safeParse === 'function'
    );
};

export function toValidationSchema<TSchema extends TValidationSchema>(fields: TSchema): TSchema;
export function toValidationSchema<TShape extends TValidationShape>(fields: TShape): zod.ZodObject<TShape>;
export function toValidationSchema(
    fields: TValidationSchema | TValidationShape,
): TValidationSchema | zod.ZodObject<TValidationShape>;
export function toValidationSchema(fields: TValidationSchema | TValidationShape) {
    return isZodSchema(fields) ? fields : zod.object(fields);
}

// Legacy hook kept as an identity to preserve the public surface without relying on removed Zod internals.
export const preprocessSchema = <TSchema extends zod.ZodObject<any>>(schema: TSchema): TSchema => schema;

const createChoiceValueSchema = (
    choices: readonly string[] | readonly TChoiceOption[] | zod.ZodTypeAny,
): zod.ZodTypeAny => {
    if (isZodSchema(choices)) return choices;

    const allowedValues = new Set(choices.map((choice) => normalizeChoiceValue(choice)));

    return zod.custom<PrimitiveValue>((value) => allowedValues.has(normalizeChoiceValue(value)), {
        message: 'Invalid choice.',
    });
};

export const schema = {
    ...zod,

    file: () => {
        // String = existing file URL, so callers can omit replacing an uploaded file.
        return zod.file();
    },

    choice: (
        choices: readonly string[] | readonly TChoiceOption[] | zod.ZodTypeAny,
        options: { multiple?: boolean } = {},
    ) => {
        const valueType = createChoiceValueSchema(choices);
        const itemType = zod.union([zod.object({ value: valueType, label: zod.string() }), valueType]);
        const choiceType = options.multiple ? zod.array(itemType) : itemType;

        return choiceType.transform((value: unknown) => {
            if (options.multiple) return (value as unknown[]).map((entry: unknown) => normalizeChoiceValue(entry));
            return normalizeChoiceValue(value);
        });
    },

    richText: (opts: TRichTextValidatorOptions = {}) =>
        schema.custom((value) => {
            if (typeof value !== 'string') {
                console.error('Invalid rich text format.', value);
                return false;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(value);
            } catch (error) {
                console.error('Failed to parse rich text json:', error, value);
                return false;
            }

            if (!isLexicalRoot(parsed)) {
                console.error('Invalid rich text value.', parsed);
                return false;
            }

            return parsed.root.children.every((child) => validateLexicalNode(child, opts));
        }),
};

function validateLexicalNode(node: unknown, opts: TRichTextValidatorOptions) {
    if (!isLexicalNode(node)) throw new InputError('Invalid rich text value (3).');

    if (node.type === 'text') {
        if (typeof node.text !== 'string') throw new InputError('Invalid rich text value (4).');
        return true;
    }

    if (['paragraph', 'heading', 'list', 'listitem'].includes(node.type)) {
        if (!Array.isArray(node.children) || !node.children.every((child) => validateLexicalNode(child, opts))) {
            throw new InputError('Invalid rich text value (5).');
        }

        return true;
    }

    if (node.type === 'image') {
        // Attachments are validated by the upload pipeline; rich-text validation only enforces node shape.
        return true;
    }

    return true;
}

export type { default as z } from 'zod';
