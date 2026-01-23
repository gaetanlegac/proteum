
// Permet de concat des regex sous leur forme pure, sans devoir utiliser new RegExp qui:
// - Ne préserve pas de coloration syntaxique
// - Oblige à escape les slashs (illisible + chiant quand on veut tester le regex sur Regexr par ex)
export const regexWith = (regex: RegExp, remplacements: { [nom: string]: RegExp }) => {

    const exprComplete = regex.source.replace(/\{\:([a-z\_]+)\}/gi, (match: string, reference: string) => {

        const remplacement = remplacements[reference]
        if (remplacement === undefined)
            throw new Error(`La référence au regex « ${reference} » n'a pas été passée.`);

        return remplacement.source;

    });

    //console.log('REGEX CORRIGE', regex.source, exprComplete);

    return new RegExp(exprComplete, regex.flags);

}

export const escapeForRegex = (chaine: string) => 
    chaine.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');