/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import { TPostData } from '@common/router/request/api';

/*----------------------------------
- TYPES
----------------------------------*/

function mergeObjects(object1, object2) {
    return [object1, object2].reduce(function (carry, objectToMerge) {
        Object.keys(objectToMerge).forEach(function (objectKey) {
            carry[objectKey] = objectToMerge[objectKey];
        });
        return carry;
    }, {});
}

function isArray(val) {

    return ({}).toString.call(val) === '[object Array]';
}

function isJsonObject(val) {

    return !isArray(val) && typeof val === 'object' && !!val && !(val instanceof Blob) && !(val instanceof Date);
}

function isAppendFunctionPresent(formData) {

    return typeof formData.append === 'function';
}

function isGlobalFormDataPresent() {

    return typeof FormData === 'function';
}

function getDefaultFormData() {

    if (isGlobalFormDataPresent()) {
        return new FormData();
    }
}

function convertRecursively(
    jsonObject: {}, 
    options: TOptions, 
    formData: FormData, 
    parentKey: string
) {

    var index = 0;

    for (var key in jsonObject) {

        if (jsonObject.hasOwnProperty(key)) {

            var propName = parentKey || key;
            var value = options.mapping(jsonObject[key]);

            if (parentKey && isJsonObject(jsonObject)) {
                propName = parentKey + '[' + key + ']';
            }

            if (parentKey && isArray(jsonObject)) {

                if (isArray(value) || options.showLeafArrayIndexes ) {
                    propName = parentKey + '[' + index + ']';
                } else {
                    propName = parentKey + '[]';
                }
            }

            if (isArray(value) || isJsonObject(value)) {

                convertRecursively(value, options, formData, propName);

            } else if (value instanceof FileList) {

                for (var j = 0; j < value.length; j++) {
                    formData.append(propName + '[' + j + ']', value.item(j));
                }
            } else if (value instanceof Blob) {

                formData.append(propName, value, value.name);

            } else if (value instanceof Date) {

                formData.append(propName, value.toISOString());

            } else if (((value === null && options.includeNullValues) || value !== null) && value !== undefined) {

                formData.append(propName, value);
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
    initialFormData: FormData,
    showLeafArrayIndexes: boolean,
    includeNullValues: boolean,
    mapping: (value: any) => any
}

export const toMultipart = (jsonObject: TPostData, options?: TOptions) => {

    if (options && options.initialFormData) {
        
        if (!isAppendFunctionPresent(options.initialFormData)) {
            throw 'initialFormData must have an append function.';
        }
    } else if (!isGlobalFormDataPresent()) {

        throw 'This environment does not have global form data. options.initialFormData must be specified.';
    }

    var defaultOptions = {
        initialFormData: getDefaultFormData(),
        showLeafArrayIndexes: true,
        includeNullValues: false,
        mapping: function(value) {
            if (typeof value === 'boolean') {
                return +value ? '1': '0';
            }
            return value;
        }
    };

    var mergedOptions = mergeObjects(defaultOptions, options || {});

    return convertRecursively(jsonObject, mergedOptions, mergedOptions.initialFormData);
}