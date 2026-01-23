/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Libs
import compilerSelecteurs, { TObjetSelecteurs } from './selecteurs';
import Filter from './Filter';

// Filtres spécifiques métier
//import filtresProps from '@/general/serveur/filtresApi';

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- CONFIG
----------------------------------*/

const debug = false;

/*----------------------------------
- MODULE
----------------------------------*/

// proprieteModele = Si l'objet actuellement traité fait partie des valeurs d'un modèle
export default (
    donnee: any,
    selecteurs?: string | TObjetSelecteurs
) => {

    // Pas besoin de filtrer
    if (donnee === null || typeof donnee !== 'object'/*  || donnee._filtered === true */) {
        return donnee;
    }

    // Correction sélecteurs
    let selecteursCompiles: TObjetSelecteurs | undefined;
    if (selecteurs === undefined)
        selecteursCompiles = undefined;
    else if (typeof selecteurs === 'string')
        selecteursCompiles = compilerSelecteurs(selecteurs);
    else // Déjà un objet, pas besoin de compiler
        selecteursCompiles = selecteurs;

    debug && console.log('Avant filtrage', donnee);

    const filtre = new Filter();
    const retour = filtre.filtrer(donnee, selecteursCompiles);

    // Empêche un nouveau filtrage
    // OBSOLETE: éviter d emodifier le retour des api, car cela peut poser probleme lors du traitement de ces données (ex: itération clés objet)
    /*if (typeof retour === 'object' && retour !== null)
        retour._filtered = true;*/

    debug && console.log('Apres filtrage', retour);

    return retour;

}