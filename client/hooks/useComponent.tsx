/*----------------------------------
- DEPENDANCES
----------------------------------*/

import { ComponentChild } from 'react';
import React from 'react';


/*----------------------------------
- TYPES
----------------------------------*/
type TDonnees = {[cle: string]: any}

type TChargeurComposant = () => Promise<{ default: JSX.Element }> ;

type TOpts = {
    props?: TDonnees,
    chargement?: boolean,
    autoload?: boolean
}

/*----------------------------------
- EXPORTS
----------------------------------*/
export default function useComponent( 
    charger: TChargeurComposant | undefined = undefined,
    opts: TOpts = {}
): [
    JSX.Element, 
    () => void
] {

    const [state, setState] = React.useState<{
        idA: string | undefined,
        composant: null | any,
        chargement: boolean
    }>({
        idA: undefined,
        composant: null,
        chargement: opts.autoload === true
    });

    const chargerComposant = (chargeur?: TChargeurComposant) => {

        if (chargeur === undefined)
            chargeur = charger;

        if (chargeur === undefined)
            return;

        return chargeur().then((Composant: any) => {
            setState((stateA) => ({
                ...stateA,
                composant: Composant,
                chargement: false
            }));
        })
    }

    const afficherComposant = (nouveauChargeur?: TChargeurComposant | false, opts: {
        toggle?: boolean,
        id?: string
    } = {}) => {

        // Masque si nouveau chargeyr = false, ou si toggle activé & même chargeur que le précédent
        if (nouveauChargeur === false || (opts.toggle === true && opts.id !== undefined && opts.id === state.idA )) {

            setState({ composant: null, chargement: false, idA: undefined });

            return false;

        }else {
            setState({ composant: null, chargement: true, idA: opts.id });

            return chargerComposant(nouveauChargeur);
        }
    }

    React.useEffect(() => {

        if (opts.autoload === true && state.chargement === true)
            chargerComposant();

    }, [charger]);

    let composant: JSX.Element;

    // En cours de chargement
    if (state.chargement === true && opts.chargement === true)
        composant = <i src="spin" />;
    // Aucun composant disponible
    else if (state.composant === null)
        composant = undefined;
    // Composant chargé
    else
        composant = state.composant.default;

    return [
        composant, 
        afficherComposant
    ];
}

export const LazyComponent = ({ loader, opts, props }: { 
    loader: () => Promise<{ default: JSX.Element }>,
    opts?: TOpts,
    props?: object
}) => {

    const [Composant] = useComponent(loader, {
        autoload: true,
        chargement: true,
        ...(opts || {}),
    });

    return Composant === undefined ? null : (
        <Composant {...props} />
    )
}