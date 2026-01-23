/*----------------------------------
- DEPENDANCES
----------------------------------*/
import retext from 'retext';
import kw from 'retext-keywords';
import pos from 'retext-pos';

import toString from 'nlcst-to-string';
import stopword from 'stopword';
import stopwordsFr from 'stopwords-fr';

/*----------------------------------
- TYPES
----------------------------------*/
type KeywordMatch = {
    node: any,
    index: number,
    parent?: any
}

type Keyword = {
    stem: string,
    score: number,
    matches: KeywordMatch[]
}

type KeyphraseMatch = {
    nodes: any[],
    parent?: any
}

type Keyphrase = {
    score: number,
    weight: number,
    stems: string[],
    value: string,
    matches: KeyphraseMatch[]
}

/*----------------------------------
- MODULES
----------------------------------*/
export const stopwords = (chaine: string): string[] => {
    return stopword.removeStopwords(
        chaine.split(/[\s\']+/),
        stopwordsFr
    );
}

export const keywords = (
    texte: string,
    nbTags: number = 10,
    tailleMin: number = 3
): string[] => {

    let tags: string[] = [];

    const textePure: string = stopwords( texte.replace(/(<([^>]+)>)/ig, '') ).join(' ');

    retext()
        .use(pos) // Make sure to use `retext-pos` before `retext-keywords`.
        .use(kw, {
            maximum: nbTags * 2 // Doublons possibles entre mots et phrases
        })
        .process(textePure, (err: any, file: any) => {

            //console.log('EXTRACTION MC POUR', textePure, err, file);

            if (err) {
                console.error( err );
                throw new Error(`Une erreur s'est produite lors de l'extraction des mots clés de « ${texte} »: ${err} (Console.log si dessus)`);
            }

            // Mots clés
            file.data.keywords.forEach(( keyword: Keyword ) => {
                const expr = toString(keyword.matches[0].node).toLowerCase();
                if (!tags.includes( expr ) && expr.length >= tailleMin)
                    tags.push(expr)
            })

            // Expressions clées
            /*file.data.keyphrases.forEach(( phrase: Keyphrase ) => {
                const expr = phrase.matches[0].nodes.map(
                    (val: any) => toString(val)
                ).join('').replace(' ', '-');
                if (!tags.includes( expr ) && expr.length >= tailleMin)
                    tags.push(expr);
            })*/
        })

    return tags.slice(0, nbTags);
}