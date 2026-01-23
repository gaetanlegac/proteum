/*----------------------------------
- TRANSFORM
----------------------------------*/

/**
 * Normalize a string into an ID
 * @param name The string to normalize
 * @returns A ID string
 */
export const nameToID = (name: string) => name.toLowerCase().replace(/[^a-z1-9]/gi, '');

export const ucfirst = (chaine: string): string => {
    return chaine.charAt(0).toUpperCase() + chaine.slice(1);
} 

export const linkify = (texte: string): string => {
    const regex = /((http|https)\:\/\/([a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,3}(\/\S*)?))/gi;
    return texte.replace(regex, '<a href="$1" target="_blank">$3</a>');
}

export const trim = (s: string, c: string) => {
    if (c === "]") c = "\\]";
    if (c === "\\") c = "\\\\";
    return s.replace(new RegExp(
        "^[" + c + "]+|[" + c + "]+$", "g"
    ), "");
}  

export const trimLeft = (chaine: string, toTrim: string) => chaine.startsWith(toTrim)
    ? chaine.substring(toTrim.length) : chaine;

export const trimRight = (chaine: string, toTrim: string) => chaine.endsWith(toTrim)
    ? chaine.substring(0, -toTrim.length) : chaine;

export const escapeRegExp = (string: string) =>
    string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string

/*----------------------------------
- EXTRACT
----------------------------------*/
export const getKeywords = (str: string, delimiter: string = ' ') => str

    // Minuscule
    .toLowerCase()

    // condenseWhitespace ( https://github.com/sindresorhus/condense-whitespace/blob/main/index.js )
    .trim().replace(/\s{2,}/gu, ' ')

    // Ne garde que les caractères alĥanumériques, ainsi que .
    // https://stackoverflow.com/questions/20690499/concrete-javascript-regex-for-accented-characters-diacritics
    .replace(/[^\.0-9A-Za-zÀ-ÖØ-öø-ÿ]/ig, ' ')

// TODO: remove stopwords: https://github.com/fergiemcdowall/stopword
export const getSlug = (str: string) => getKeywords(str, '-')