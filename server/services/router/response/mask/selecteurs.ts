/*----------------------------------
- DEPENDANCES
----------------------------------*/

/*----------------------------------
- TYPES
----------------------------------*/
export type TSelecteur = true | "*" | TObjetSelecteurs
// Wildcard en clé = selectionner toutes les clés
// Wildcard en valeur = sélectionner absolument toutes les valeur descendantes
export type TObjetSelecteurs = {[cle: string]: TSelecteur}

/*----------------------------------
- CONSTANTES
----------------------------------*/
const reSelecteurs = /((([a-z0-9\*\@\.\_\#]+)|(\{[^\}]+\}))\s*(\(?))|\)/gi; // <branche>( <elem1> <elem2> )

const cache: TObjetSelecteurs = {};

/*----------------------------------
- FONCTION
----------------------------------*/
export default (selecteurs: string) => {

    if (cache[selecteurs] === undefined)
        cache[selecteurs] = compiler(selecteurs);

    return cache[selecteurs];

}

const compiler = (selecteurs: string): TObjetSelecteurs => {

    let chemins: TObjetSelecteurs = {};
    let cheminA: string[] = []; // Chemin en construction

    let branche;
    while (branche = reSelecteurs.exec(selecteurs)) {

        if (branche[0] === ')') { // fermeture

            // Niveau précédent: docs.titre => docs
            cheminA.pop();

        } else {

            const nomBranche = branche[2];
            const ouverture = branche[5] === '(';

            // Ligne débutant par un # = commentaire
            if (nomBranche.startsWith("#"))
                continue;

            if (ouverture)
                // Ouverture de la branche: docs => docs.titre
                cheminA.push(nomBranche);
            else {

                const chemin = [...cheminA, nomBranche];

                // Construction du chemin
                let brancheA = chemins;
                const nbBranches = chemin.length;
                for (let iBranche = 0; iBranche < nbBranches; iBranche++) {

                    const nomBranche = chemin[iBranche];

                    const extremite = iBranche === nbBranches - 1
                    if (extremite) {

                        // Dernière branche = extremité = true
                        brancheA[nomBranche] = true;

                    } else {

                        // Pas encore définie
                        if (brancheA[nomBranche] === undefined)
                            // Sinon, initialisation
                            brancheA[nomBranche] = {};

                        // Rférnce pour la prochaine itération
                        brancheA = brancheA[nomBranche];

                    }
                }
            }
        }
    }

    return chemins;

}