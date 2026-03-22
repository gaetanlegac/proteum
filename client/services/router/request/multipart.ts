/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import { TPostData } from '@common/router/request/api';

/*----------------------------------
- TYPES
----------------------------------*/

type TMultipartPrimitive = PrimitiveValue | null | undefined;
type TMultipartValue =
    | TMultipartPrimitive
    | Blob
    | Date
    | FileList
    | TMultipartValue[]
    | { [key: string]: TMultipartValue };

type TMultipartObject = { [key: string]: TMultipartValue };

function mergeObjects<TObject extends object>(object1: TObject, object2: Partial<TObject>): TObject {
    return [object1, object2].reduce<TObject>((carry, objectToMerge) => {
        Object.keys(objectToMerge).forEach((objectKey) => {
            carry[objectKey as keyof TObject] = objectToMerge[objectKey as keyof TObject] as TObject[keyof TObject];
        });
        return carry;
    }, { ...object1 });
}

function isArray(val: unknown): val is TMultipartValue[] {
    return Array.isArray(val);
}

function isJsonObject(val: unknown): val is TMultipartObject {
    return !isArray(val) && typeof val === 'object' && !!val && !(val instanceof Blob) && !(val instanceof Date);
}

function isAppendFunctionPresent(formData: FormData) {
    return typeof formData.append === 'function';
}

function isGlobalFormDataPresent() {
    return typeof FormData === 'function';
}

function getDefaultFormData(): FormData {
    if (isGlobalFormDataPresent()) return new FormData();

    throw new Error('FormData is not available in the current environment.');
}

function appendValue(formData: FormData, key: string, value: TMultipartValue, options: TOptions) {
    if (value instanceof FileList) {
        for (let index = 0; index < value.length; index++) {
            const file = value.item(index);
            if (file) formData.append(`${key}[${index}]`, file, file.name);
        }
        return;
    }

    if (value instanceof Blob) {
        const filename = value instanceof File ? value.name : undefined;
        if (filename) formData.append(key, value, filename);
        else formData.append(key, value);
        return;
    }

    if (value instanceof Date) {
        formData.append(key, value.toISOString());
        return;
    }

    if (((value === null && options.includeNullValues) || value !== null) && value !== undefined) {
        formData.append(key, String(value));
    }
}

function convertRecursively(
    jsonObject: TMultipartObject | TMultipartValue[],
    options: TOptions,
    formData: FormData,
    parentKey: string,
) {
    let index = 0;

    for (const key in jsonObject) {
        if (jsonObject.hasOwnProperty(key)) {
            let propName = parentKey || key;
            const rawValue = isArray(jsonObject) ? jsonObject[Number(key)] : jsonObject[key];
            const value = options.mapping(rawValue);

            if (parentKey && isJsonObject(jsonObject)) {
                propName = parentKey + '[' + key + ']';
            }

            if (parentKey && isArray(jsonObject)) {
                if (isArray(value) || options.showLeafArrayIndexes) {
                    propName = parentKey + '[' + index + ']';
                } else {
                    propName = parentKey + '[]';
                }
            }

            if (isArray(value) || isJsonObject(value)) {
                convertRecursively(value, options, formData, propName);
            } else {
                appendValue(formData, propName, value, options);
            }
        }
        index++;
    }
    return formData;
}

/*----------------------------------
- UTILS
----------------------------------*/
/* Based on https://github.com/hyperatom/json-form-data
    Changes:
    - Add support for FileToUpload
*/

// options type
type TOptions = {
    initialFormData: FormData;
    showLeafArrayIndexes: boolean;
    includeNullValues: boolean;
    mapping: (value: TMultipartValue) => TMultipartValue;
};

export const toMultipart = (jsonObject: TPostData, options?: TOptions) => {
    if (options && options.initialFormData) {
        if (!isAppendFunctionPresent(options.initialFormData)) {
            throw 'initialFormData must have an append function.';
        }
    } else if (!isGlobalFormDataPresent()) {
        throw 'This environment does not have global form data. options.initialFormData must be specified.';
    }

    const defaultOptions: TOptions = {
        initialFormData: getDefaultFormData(),
        showLeafArrayIndexes: true,
        includeNullValues: false,
        mapping: function (value) {
            if (typeof value === 'boolean') {
                return value ? '1' : '0';
            }
            return value;
        },
    };

    const mergedOptions = mergeObjects(defaultOptions, options || {});

    return convertRecursively(jsonObject as TMultipartObject, mergedOptions, mergedOptions.initialFormData, '');
};
