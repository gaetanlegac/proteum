/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm

/*----------------------------------
- TYPES: IMPORTATIONS
----------------------------------*/

import TRequeteApi, { TOptionsRequete } from '@commun/api';

/*----------------------------------
- TYPES: DEFINITIONS
----------------------------------*/

export type TFetcherState = Promise<{
    nomRetour: string,
    cache?: string,
    donnee: any
}>

/*----------------------------------
- FONCTIONS
----------------------------------*/
export const initStateAsync = (
    donneesInit: TObjetDonnees,
    optsApiGlobales: Partial<TOptionsRequete> = {},
    avecTriggers: boolean = true,
    execLazy: string[] = []
) => {

    let donneesInitState = {};

    let fetchersStateA: TFetcherState[] = [];

    let paramsApi = {};
    let listeRequetesApi: string[] = [];

    for (let nomDonnee in donneesInit) {

        let donnee = donneesInit[nomDonnee];
        let promise: undefined | Promise<any> = undefined;

        if (donnee && typeof donnee === 'object') {

            // Requete api
            if (typeof donnee.exec === 'function') {

                const requeteApi = donnee as TRequeteApi;

                // Onjection des options supplémentaires
                requeteApi.setOpts(optsApiGlobales);

                // Référencement params (accès depuis les actions)
                paramsApi[nomDonnee] = requeteApi.params;

                listeRequetesApi.push(nomDonnee);

                if (requeteApi.opts.lazy === true && !execLazy.includes(nomDonnee))
                    donnee = null;
                else
                    try {

                        // Transformation en promise
                        const retourRequete = requeteApi.exec(avecTriggers);

                        if (retourRequete.fetcher)
                            promise = retourRequete.fetcher.then(({ data }) => data);

                        // Placeholder ou cache
                        donnee = retourRequete.data;

                    } catch (e) {

                        console.error("Catch via initStateAsync", e);

                        //throw e;
                    }

                // Promise
            } else if (typeof donnee.then === 'function') {
                promise = donnee;
                donnee = undefined;
            }
        }

        donneesInitState[nomDonnee] = donnee;

        // Fonction retournant une promise
        if (promise !== undefined)
            fetchersStateA.push(
                promise.then((donnee) => {

                    return { nomRetour: nomDonnee, donnee: donnee }

                })
            );
    }

    return { donneesInitState, fetchersStateA, paramsApi, listeRequetesApi }
}

export const execFetchersState = async (fetchers: TFetcherState[]) => {

    // Execution
    const retourFetchers = await Promise.all(fetchers);

    // Rassemblement des données & màj cache
    let donneesChargees: Partial<TDonnees> = {};
    for (const { nomRetour, donnee } of retourFetchers) {
        donneesChargees[nomRetour] = donnee;
    }

    return donneesChargees;
}