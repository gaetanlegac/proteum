/*import jsonpack from 'jsonpack';
import lzutf8 from 'lzutf8';

export const compresser = (objet: object): string => {
    return jsonpack.pack(
        JSON.stringify(
            objet
        )
    );
}

export const decompresser = (chaine: string): {[cle: string]: any} => {
    let retour;
    try {
        retour = jsonpack.unpack( chaine );
    } catch (e) {
        retour = {};
    }
    return retour;
}

// Le resultat est souvent plus lourd que compresser()
// A approfondir
export const compresserX2 = (objet: object): string => {
    return lzutf8.Encoding.DecimalString.encode(
        lzutf8.compress(
            compresser(objet)
        )
    );
}

export const decompresserX2 = (chaine: string): {[cle: string]: any} => {
    return decompresser(
        lzutf8.decompress(
            chaine
        )
    );
}*/

export type TObjetDonnees = {[cle: string]: any}

const dummy = (obj) => obj;
export const compresser = dummy;
export const decompresser = dummy;

export function objectFlip(objet: {[cle: string]: string}): {[cle: string]: string} {
    let retour: {} = {};
    for (const index in objet)
        retour[ objet[ index ] ] = index;
    return retour;
}

export function indexOf<TObj extends object>(objet: TObj, valeur: ValueOf<TObj>): keyof TObj {
    return Object.keys( objet )[ Object.values( objet ).indexOf( valeur ) ] as keyof TObj;
}

export function queryString(obj: {[cle: string]: string | number | boolean}) {

    let retour: string[] = []

    for (const cle in obj) {

        let val = obj[cle];

        if (typeof val === 'boolean')
            val = val ? 'true' : 'false'

        retour.push(cle + '=' + val);
    }

    return retour.join('&')

}

export const simpleDeepCopy = <TObj1 extends TObjetDonnees, TObj2 extends TObjetDonnees>(obj1: TObj1, obj2?: TObj2): TObj1 & TObj2 => {

    const retour: TObjetDonnees = {}

    for (const cle in obj1)
        if (typeof obj1[cle] === 'object' && obj1[cle].constructor === Object)
            retour[cle] = simpleDeepCopy(obj1[cle]);
        else
            retour[cle] = obj1[cle];

    if (obj2 !== undefined)
        for (const cle in obj2)
            if (typeof obj2[cle] === 'object' && obj2[cle].constructor === Object)
                retour[cle] = retour[cle]
                    ? simpleDeepCopy(retour[cle], obj2[cle])
                    : simpleDeepCopy(obj2[cle])
            else
                retour[cle] = obj2[cle];

    return retour as TObj1 & TObj2;
}

export const chemin = {
    get: <TRetour = any>(objet: { [cle: string]: any }, chemin: string): TRetour => {
        const branches = chemin.split('.');
        let valA: any = objet;
        for (const branche of branches)
            valA = valA[branche];
        return valA;
    },

    set: (objet: { [cle: string]: any }, chemin: string, val: any) => {
        const branches = chemin.split('.');
        const brancheVal = branches.pop();

        if (brancheVal === undefined)
            throw new Error(`Le chemin ne peut pas être vide.`);

        let valA: any = objet;
        for (const branche of branches)
            valA = valA[branche];

        valA[ brancheVal ] = val;
        
    }
}

export const groupBy = <TObj extends TObjetDonnees>(
    items: TObj[], 
    key: keyof TObj
): {[key: string]: TObj[]} => {
    
    const grouped: {[key: string]: TObj[]} = {};

    for (const item of items) {
        const  indexValue  = item[key] as any;
        if (grouped[ indexValue ] === undefined)
            grouped[ indexValue ] = [];
        grouped[ indexValue ].push(item);
    }

    return grouped;
}