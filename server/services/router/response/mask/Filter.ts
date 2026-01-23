/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Libs
import { TSelecteur } from './selecteurs';

/*----------------------------------
- TYPES
----------------------------------*/

type TObjet = { [cle: string]: TObjet | any };

/*----------------------------------
- CONFIG
----------------------------------*/

const debug = false;

const maxLevel = 10; // Prévention contre les références circulaires

/*----------------------------------
- CLASS
----------------------------------*/
export default class Filtre {

    public constructor() {


    }

    public filtrer(
        donnee: TObjet | Array<unknown> | Date,
        schema?: TSelecteur,
        chemin: string[] = [],
        schemaParent?: TObjet
    ): any {

        // Prévention contre les références circulaires
        if (chemin.length > maxLevel)
            throw new Error(`Erreur: Niveau max (${maxLevel}) atteint via la branche ${chemin.join('.')}. Vérifier s'il n'existe pas une référence circulaire dans l'objet à filtrer.`)

        try {

            // Tableau: on itère chaque élement de celui-ci
            if (Array.isArray(donnee)) {

                debug && console.log(`[requete][reponse][filtre]`, chemin.join('.'), ': Tableau');

                return this.tableau(donnee, schema, chemin, schemaParent);

                // Valeur: Chaque true doit être remplacé par la donnee[ nomBranche ] correspondante
                // Si la donnée est une chaine, un nombre, etc ... On la traite comme s'il y avait un true
            } else if (
                // Extrémité de la branche
                schema === true
                ||
                // Valeur non-itérable
                !donnee
                ||
                typeof donnee !== 'object'
                ||
                donnee instanceof Date
            ) {

                debug && console.log(`[requete][reponse][filtre]`, chemin.join('.'), ': Valeur');

                return this.valeur(
                    donnee,
                    schema,
                    chemin
                );

                // Objet
            } else {

                debug && console.log(`[requete][reponse][filtre]`, chemin.join('.'), ': Objet');

                return this.objet(donnee, schema, chemin, schemaParent);

            }

        } catch (error) {

            console.error('Erreur =', error, '|| données =', donnee, '|| chemin =', chemin, '|| schema =', schema);
            throw new Error(`Erreur lors du filtrage. Infos ci-dessus.`);

        }
    }

    private tableau(
        donnee: any[],
        schema: TSelecteur | undefined,

        chemin: string[],
        schemaParent?: TObjet
    ) {

        let retour: any[] = [];

        for (const iElem in donnee) {
            retour.push(
                this.filtrer(
                    donnee[iElem],
                    schema,

                    [...chemin, iElem],
                    schemaParent
                )
            )
        }

        return retour;
    }

    private objet(
        donnee: TObjet,
        schema: TSelecteur | undefined,

        chemin: string[],
        schemaParent?: TObjet
    ) {

        if (typeof schema === 'object') {

            // Exemple: article ( titre enfant( @ ) )
            // Copie du schéma parent
            if (schema['@'] === true) {

                if (schemaParent === undefined)
                    throw new Error(`Référence au schéma parent trouvée, mais impossible d'accéder au schéma parent (schemaParent = undefined)`);

                schema = schemaParent;

                // Exemple: *
                // Parcours et filtre toutes les entrées
            } else if (schema['*'] === true) {

                // L'itération se fera directement sur les données fournies
                schema = undefined;

                // Exemple: * ( nom symbole )
                // Applique un selecteurs à toutes les entrées
            } else if (schema['*'] !== undefined) {

                const schemaBranches = schema['*'];
                schema = {};

                // Applique le schema du wildcard à toutes les entrées de l'objet
                // TODO: alternative plus performante
                for (const cle in donnee)
                    schema[cle] = schemaBranches;

            }
        }

        let retour: TObjet = {};

        // Liste des clés à itérer
        let clesAiterer: string[];
        if (schema !== undefined)
            clesAiterer = Object.keys(schema as object);
        else // En dernier recours, on itère tout simplement les données de l'objet
            clesAiterer = Object.keys(donnee);

        // Objet
        for (const nomBranche of clesAiterer) {

            const cheminA = [...chemin, nomBranche];
            let donneeBranche = undefined;

            // Extraction de la valeur de la propriété
            if (donneeBranche === undefined)
                donneeBranche = donnee[nomBranche];

            // Filtrage de la valeur de la propriété
            retour[nomBranche] = this.filtrer(
                donneeBranche,
                schema !== undefined ? schema[nomBranche] : undefined,

                cheminA,

                schema as TObjet
            );
        }

        return retour;
    }

    // Traitement des données aux extrémités (auxquelles font référence les true)
    private valeur(
        donnee: any,
        schema: TSelecteur,
        chemin: string[]
    ) {

        // Si sélecteur wildcard
        const wildcard = typeof schema === 'object' && schema['*'] === true

        // Traitement des objets
        if (donnee && typeof donnee === 'object') {

            // Promise
            if (typeof donnee.then === 'function')
                throw new Error(chemin.join('.') + ": Les promises ne sont pas autorisées en retour api, sauf via un getter de modèle.");

            // Sinon, wildcard obliatoire si on souhaite conserver l'objet entier
            else if (wildcard === false) {

                if (donnee instanceof Date)
                    return donnee.toISOString();
                // Mauvaise idée: Les instances de modèle Sequelize possèdent une méthode toString()
                /*else if (typeof donnee.toString === 'function')
                    return donnee.toString();*/

            }

        }

        return donnee;
    }

    /*private propriete<TModele extends Modele>(
        nom: keyof TModele,
        modele: TModele,
        metasClasse: TModelMetas,
        cheminA: string[]
    ): any | undefined {

        const metasProp = metasClasse.attributes[nom];

        if (metasProp === undefined)
            console.warn(`ATTENTION: La propriété « ${nom} » a été demandée via le sélecteur, mais cette dernière n'a pas été référencée dans le modèle ${metasClasse.nom}.`);

        // Exposé publiquement
        // @ts-ignore: 'string' can't be used to index type '{ "Post": string[]; "Question": string[], ...
        if (metasProp?.api === undefined) {
            //debug && console.log(`Elimination de la donnée ${cheminA.join('.')} (propriété de classe ${metasClasse.nom}.${nom}) (non-exposé à l'API)`);
            return undefined;
        }

        let valeur: any;
        // Si promise, on lui rattache un catch le plus tôt possible, avant qu'on ne tente d'acceder à sa valeur
        // (un simple acces lançant directement la promise)
        valeur = modele[nom];

        // Permissions
        if (!this.controleAcces(modele, metasProp.api.auth, `Elimination de la donnée ${cheminA.join('.')} (${metasClasse.nom}.${nom})`)) {
            return undefined;
        }

        if (valeur === undefined || valeur === null)
            return undefined;

        // Filtre spécifique à la propriété
        if (metasProp.api.sortie)
            valeur = metasProp.api.sortie(valeur);

        if (valeur === undefined || valeur === null)
            return undefined;

        // Dernier traitement des valeurs
        //valeur = filtresProps(valeur, metasProp);
        return valeur;
    }

    private controleAcces(
        donneesCompletes: Modele,
        roleRequis: TControleAcces | undefined,
        logElimination: string
    ): boolean {

        if (roleRequis === undefined)
            return true;
        else if (!this.user) {
            //debug && console.log(logElimination + ` (Non-connecté)`);
            return false;
        } else {

            // L'admin peut tout voir depuis l'interface d'amdin
            if (this.user && this.user.roles.includes('ADMIN'))
                return true;

            // Fonction personnalisée
            if (typeof roleRequis === 'function') {
                const retour = roleRequis(donneesCompletes, this.user);
                //debug && console.log(logElimination + ` (Via fonction custom)`);
                return retour;
            } else {

                // Force le format tableau
                if (typeof roleRequis === 'string')
                    roleRequis = [roleRequis];

                // Vérification si l'un des role requis correspond à l'utilisateur actuel
                for (const role of roleRequis) {

                    // Role simple
                    if (this.user.roles.includes(role))
                        return true;
                    // Correspondance id utilisateur avec valeur d'une colonne (ex: auteur)
                    else {
                        const nomCol = role === 'id' || role.endsWith('_id')
                            ? role
                            : role + '_id';
                        const valeurCol = donneesCompletes[nomCol];

                        // TODO: Vérif si nom colonne existante dans modèle

                        if (valeurCol === this.user.id)
                            return true;
                    }
                }


                //debug && console.log(logElimination + ` (User actuel: ${this.user.id} ${this.user.roles.join(', ')} ; Requis: ${roleRequis.join(', ')})`);
            }

            return false;
        }
    }*/

}