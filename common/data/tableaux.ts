export type TOptsArrayToObj = { index?: string, val?: string }

// Tableau d'objets
export function arrayToObj<Ttbl extends {[cle: string]: any}, Tcle extends string|number, Tval>(
    tableau: Ttbl[],
    opts: TOptsArrayToObj = {}
): any/*{[cle: string]: Tval}*/ {

    let retour: { [index: string]: any } = {};

    // Index + val
    if (opts.index !== undefined && opts.val !== undefined) {

        for (const ligne of tableau)
            retour[ligne[opts.index]] = ligne[opts.val];

        // Index
    } else if (opts.index !== undefined) {

        for (const ligne of tableau)
            retour[ligne[opts.index]] = ligne;

        // Val
    } else if (opts.val !== undefined) {

        retour = [];

        for (const ligne of tableau)
            retour.push(ligne[opts.val]);

        // Inchangé
    } else {

        retour = tableau;

    }

    return retour;
}

export const somme = (tbl: number[]) => tbl.reduce((a: number, b: number) => a + b);

export const arrayChunks = <TArray extends any[]>(array: TArray, size: number) => {

    const arrays: TArray[] = [];
    while (array.length > 0)
        arrays.push( array.splice(0, size) as TArray );

    return arrays;
}

export function array_sum( tbl: number[] ): number {
    return tbl.reduce((a: number, b: number) => a + b);
}

export function shuffleArray<TArray extends any[]>(array: TArray): TArray {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}