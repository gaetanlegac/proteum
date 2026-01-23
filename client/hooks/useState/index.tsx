/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import { useState as reactUseState, useEffect as reactUseEffect } from 'preact/hooks';

// Libs
import useContexte from '@/client/context';

// Libs spécifiques
import { execFetchersState, initStateAsync } from './fetchers';


/*----------------------------------
- TYPES: IMPORTATIONS
----------------------------------*/

import TRequeteApi, { TOptionsRequete } from '@common/api';

import { TDataResolved } from '@client/services/router';

/*----------------------------------
- TYPES: DEFINITIONS
----------------------------------*/

type TArgsSet<TDonnees extends TObjetDonnees = TObjetDonnees> = (
    [keyof TDonnees, any]
    |
    [keyof TDonnees, any, TObjetDonnees]
    |
    [Partial<TDonnees>]
    |
    [Partial<TDonnees>, TObjetDonnees]
)

export type TActions<TDonnees extends TObjetDonnees = TObjetDonnees> = TDonnees & {
    
    params: object,
    chargement: boolean,
    recharger: (nomRetour: string, params?: object) => void,
    load: (nomRequetes: (keyof TDonnees)[]) => void,

    // Local
    set: (...args: TArgsSet<TDonnees>) => void,
    remove: (cheminStr: string, aRetirer: { id: number | string }) => void,
    add: (cheminStr: string, aAjouter: any) => void
}

/*----------------------------------
- HOOK
----------------------------------*/
export default function useState<TDonnees extends TObjetDonnees>(
    donneesInit: TDonnees,
    optsApi: Partial<TOptionsRequete> = {}
): [TDataResolved<TDonnees>, TActions<TDonnees>] {

    /*----------------------------------
    - INIT
    ----------------------------------*/
    if (donneesInit === undefined)
        console.warn(`/!\\ Attention: Données initiales useState = undefined. La propriété data a t-elle bien été passée dans le composant de la page ?`);

    const ctx = useContexte();

    const [execLazy, setExecLazy] = reactUseState([]);

    const { 
        donneesInitState, 
        fetchersStateA, 
        paramsApi, 
        listeRequetesApi 
    } = initStateAsync(donneesInit, optsApi, true, execLazy);

    // State
    const [state, setState] = reactUseState<{
        donnees: TDonnees,
        chargement: boolean
    }>({
        donnees: donneesInitState,
        chargement: fetchersStateA.length !== 0
    });

    // Rassemblement de tous les fetchers en une seule promise
    let fetcherState: false | (() => Promise<any>) = false;
    if (fetchersStateA.length !== 0) {
        console.log(`[state] Execution des fetchers via useState`, typeof donneesInit === 'object' ? Object.keys(donneesInit) : donneesInit);
        fetcherState = () => execFetchersState(fetchersStateA);
    }

    // Serveur = ajout à la file d'attente
    if (SERVER && fetcherState !== false)
        ctx.page.fetchers.push(fetcherState);
    // Client = Execution asynchrone à chaque changement des données initiales
    reactUseEffect(() => {

        if (fetcherState !== false) {
            fetcherState().then((donneesChargees) => {

                console.log(`[state] Maj du state avec les nouvelles données de l'api`, donneesChargees);

                setState((stateA) => ({
                    donnees: {
                        ...stateA.donnees,
                        ...donneesChargees
                    },
                    chargement: false
                }));

            }).catch((e) => {

                console.error('Gérer erreur via useState', e);

            })
        }

    }, [fetcherState]);
    
    /*----------------------------------
    - ACTIONS
    ----------------------------------*/
    const set = (...argsSet: TArgsSet): void => {

        let nomDonnee: string | undefined;
        let donnees: TDonneesRemplacement;
        let nouveauxParamsRequetes: TObjetDonnees | undefined;
        if (typeof argsSet[0] === 'string')
            ([nomDonnee, donnees, nouveauxParamsRequetes] = argsSet);
        else
            ([donnees, nouveauxParamsRequetes] = argsSet);

        // Màj de l'ui
        setState((stateA) => {

            // Màj d'une seule donnée spécifique
            if (nomDonnee) {
                donnees = {
                    [nomDonnee]: typeof donnees === 'function'
                        ? donnees(stateA.donnees[nomDonnee])
                        : donnees
                }
            // Màj de toutes les données
            } else if (typeof donnees === 'function')
                donnees = donnees(stateA.donnees);

            const newState = {
                ...stateA,
                chargement: false,
                donnees: {
                    ...stateA.donnees,
                    ...donnees
                }
            };

            return newState;
        });

        // TODO: Pour màj les données de state + recharger les données api en un seul setState
        /*if (nouveauxParamsRequetes !== undefined)
            recharger(nouveauxParamsRequetes);*/
    }

    const recharger = (nomRetour: string, params?: object) => {

        console.log('recharger', nomRetour, donneesInit[nomRetour], listeRequetesApi, params);

        // Verif si requete api
        if (!listeRequetesApi.includes( nomRetour ))
            throw new Error("state.recharger appellé pour " + nomRetour + ", mais cette dernière n'est pas une requete api.");

        const requete = donneesInit[nomRetour] as TRequeteApi;

        requete.viderCache(true);

        if (params !== undefined)
            requete.setParams(params);

        setState((stateA) => ({ ...stateA  }));
    }
    
    const remove = (cheminStr: string, aRetirer: { id: number | string }) => setState((stateA) => {

        const chemin = cheminStr.split('.');
        const brancheVal = chemin.pop();

        // Pointage
        let elemA = stateA.donnees;
        for (const brancheA of chemin)
            elemA = elemA[brancheA]

        if (!Array.isArray(elemA[brancheVal]))
            throw new Error(chemin + " n'est pas un tableau");

        // Exclusion
        elemA[brancheVal] = elemA[brancheVal].filter(aVerifier => aVerifier.id !== aRetirer.id);

        return {
            ...stateA
        };

    })

    const add = (cheminStr: string, aAjouter: any) => setState((stateA) => {

        const chemin = cheminStr.split('.');
        const brancheVal = chemin.pop();

        // Pointage
        let elemA = stateA.donnees;
        for (const brancheA of chemin)
            elemA = elemA[brancheA]

        if (!Array.isArray(elemA[brancheVal]))
            throw new Error(chemin + " n'est pas un tableau");

        // Exclusion
        elemA[brancheVal] = [...elemA[brancheVal], aAjouter]

        return {
            ...stateA
        };

    })

    const load = (nomRequetes: (keyof TDonnees)[]) => {
        setExecLazy(nomRequetes);
    }

    const actions = {

        // Permet, via le passage d'un seul objet, de partager un état en lecture & écriture entre plusiieurs composants
        ...state.donnees,

        // API
        params: paramsApi,
        chargement: state.chargement,
        recharger,
        load,

        // Local
        set,
        remove,
        add
    }

    /*console.log(
        `[state] Attendu:`,
        typeof donneesInit === 'object' ? Object.keys(donneesInit) : donneesInit, 
        'Retourné: ', state.donnees
    );*/

    // Retour
    return [state.donnees, actions];

}