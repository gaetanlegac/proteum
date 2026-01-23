/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Libs métier
import buildValidators, { champ } from '@common/data/input/validators/build';
import { validateurFichier, TOptsValidateurFichier } from '@common/data/input/validators/basic';

/*----------------------------------
- VALIDATEURS
----------------------------------*/

export default buildValidators({

    file: ({ ...opts }: TOptsValidateurFichier & {}) => champ<object>('fichier', {
        ...opts,
        valider: async (val: any, donneesSaisie: TObjetDonnees, donneesRetour: TObjetDonnees) => {

            console.log('VALIDER FICHIER COTÉ CLIENT', val);

            // Chaine = url ancien fichier = conservation = sera ignoré coté serveur
            if (typeof val === 'string')
                return val;

            // Validation universelle
            val = await validateurFichier(opts, val, donneesSaisie, donneesRetour);

            return opts.valider ? await opts.valider(val, donneesSaisie, donneesRetour) : val;
        }
    })

});