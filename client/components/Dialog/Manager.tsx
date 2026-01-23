/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import { ComponentChild } from 'preact';

// Core
import useContext from '@/client/context';
import { blurable, deepContains, focusContent } from '@client/utils/dom';

// Specific
import type Application from '../../app';
import Card, { Props as CardInfos } from './card';
import Button from '../Button';

/*----------------------------------
- TYPES: IMPORTATIONS
----------------------------------*/

/*----------------------------------
- TYPES: DECLARATIONS
----------------------------------*/

type TParams = { [cle: string]: unknown }

type ComposantToast = React.FunctionComponent<{ close?: any }> & { data?: object };

type TOptsToast = (CardInfos & { 
    content?: ComponentChild,
    data?: {},
    className?: string,
})

type TOnCloseCallback<TReturnType extends any> = (returnedValue: TReturnType) => void

type TToastShortcutArgs = [
    title: TOptsToast["title"], 
    content?: TOptsToast["content"], 
    boutons?: TOptsToast["boutons"],
    options?: TOptsToast,
]

export type TDialogControls = {
    close: TOnCloseCallback<any>,
    then: (cb: TOnCloseCallback<any>) => any
}

type TDialogContentArg = ComposantToast | Promise<{ default: ComposantToast }> | TOptsToast;

type TDialogShowArgs = [
    // On utilise une fonction pour pouvoir accéder aux fonctions (close, ...) lors de la déclaration des infos de la toast
    Content: TDialogContentArg,
    paramsInit?: TParams
] | [
    title: string,
    // On utilise une fonction pour pouvoir accéder aux fonctions (close, ...) lors de la déclaration des infos de la toast
    Content: TDialogContentArg,
    paramsInit?: TParams
]

type DialogActions = {

    setToasts: ( setter: (old: ComponentChild[]) => ComponentChild[]) => void,
    setModals: ( setter: (old: ComponentChild[]) => ComponentChild[]) => void,

    show: (...args: TDialogShowArgs ) => TDialogControls,

    confirm: (title: string, content: string | ComponentChild, defaultBtn: 'Yes'|'No') => TDialogControls,

    loading: (title: string) => TDialogControls,

    info: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls,

    success: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls,

    warning: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls,

    error: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls,
}

/*----------------------------------
- SERVICE CONTEXTE
----------------------------------*/
let idA: number = 0;
export const createDialog = (app: Application, isToast: boolean): DialogActions => {

    const show = <TReturnType extends any = true>( ...args: TDialogShowArgs ): TDialogControls => {

        let onClose: TOnCloseCallback<TReturnType>;
        const id = idA++;

        // Parse args
        let title: string | undefined; 
        let Content: TDialogContentArg;
        let paramsInit: TParams = {};
        if (typeof args[0] === 'string') {
            [title, Content, paramsInit] = args;
        } else {
            [Content, paramsInit] = args;
        }

        // Set instance management function
        const setDialog = isToast
            ? instance.setToasts
            : instance.setModals;

        // Close function
        const close = (retour: TReturnType) => {

            setDialog(q => q.filter(m => m.id !== id))

            if (onClose !== undefined)
                onClose(retour);
        };

        const promise = new Promise(async (resolve: TOnCloseCallback<TReturnType>) => {
            onClose = resolve

            let render: ComponentChild;
            let propsRendu: CardInfos = {
                ...paramsInit,
                close: close
            }; 
            
            // modal.show( import('./modalSupprimer') )
            //  -> Fetch component
            if (Content.constructor === Promise)
                Content = (await Content).default;

            // modal.show('Supprimer', import('./modalSupprimer'))
            //  -> Shortcut for modal.show({ title: 'Suoorimer', content: <Component> })
            if (title !== undefined) {
                Content = {
                    title: title,
                    content: Content
                }
            }

            // modal.show({ title: 'supprimer', content: <>...</> })
            if (Content.constructor === Object) {

                const { content: CardContent, data = {}, ...propsToast } = Content as TOptsToast;
                
                let cardContent: ComponentChild;
                if (typeof CardContent === 'function') {
                    cardContent = <CardContent {...propsRendu} {...data} />
                    propsToast.boutons = null; // Component content = advanced content = should include buttons
                } else {
                    cardContent = CardContent;
                }
                
                render = (
                    <Card {...propsRendu} {...propsToast} isToast={isToast}>
                        {cardContent}
                    </Card>
                )

            // modal.show( ToastSupprimer )
            //  -> Content is a component rendering a Card
            } else {

                render = (
                    <Content {...propsRendu} isToast={isToast} />
                )
            }

            // Chargeur de données
            /*if (('data' in ComposantCharge) && typeof ComposantCharge.data === 'function') {
     
                propsRendu.data = await ComposantCharge.data(app, paramsInit);
     
                const { fetchersStateA } = initStateAsync(propsRendu.data, {}, false);
     
                await execFetchersState(fetchersStateA);
     
            }*/
            
            if (!isToast)
                render = (
                    <div class="modal">
                        {render}
                    </div>
                )

            render["id"] = id;

            setDialog(q => [...q, render]);
        });

        return {
            close,
            then: (cb) => promise.then(cb)
        }
    };

    const instance: DialogActions = {

        show: show,

        setToasts: undefined as unknown as DialogActions["setToasts"],
        setModals: undefined as unknown as DialogActions["setModals"],

        confirm: (title: string, content: string | ComponentChild, defaultBtn: 'Yes'|'No' = 'No') => show<boolean>(({ close }) => (
            <div class="card col">
                <header>
                    <h2>{title}</h2>
                </header>
                {typeof content === 'string' ? <p>{content}</p> : content}
                <footer class="row fill">
                    <Button type={defaultBtn === 'Yes' ? 'primary' : undefined}
                        onClick={() => close(true)}>
                        Yes
                    </Button>
                    <Button type={defaultBtn === 'No' ? 'primary' : undefined}
                        onClick={() => close(false)}>
                        No
                    </Button>
                </footer>
            </div>
        )),

        loading: (title: string) => show({
            title: title,
            type: 'loading'
        }),

        info: (...[title, content, boutons, options]: TToastShortcutArgs) => show({
            title: title,
            type: 'info',
            content: content && <p>{content}</p>,
            boutons,
            ...options
        }),

        success: (...[title, content, boutons, options]: TToastShortcutArgs) => show({
            title: title,
            type: 'success',
            content: content && <p>{content}</p>,
            boutons,
            ...options
        }),

        warning: (...[title, content, boutons, options]: TToastShortcutArgs) => show({
            title: title,
            type: 'warn',
            content: content && <p>{content}</p>,
            boutons,
            ...options
        }),

        error: (...[title, content, boutons, options]: TToastShortcutArgs) => show({
            title: title,
            type: 'error',
            content: content && <p>{content}</p>,
            boutons,
            ...options
        }),
    }

    return instance;
}

/*----------------------------------
- COMPOSANT
----------------------------------*/
import './index.less';
export default () => {

    const app = useContext();

    const [modals, setModals] = React.useState<ComponentChild[]>([]);
    const [toasts, setToasts] = React.useState<ComponentChild[]>([]);

    if (app.side === 'client') {
        app.modal.setModals = setModals;
        app.toast.setToasts = setToasts;
    }

    React.useEffect(() => {

        console.log('Updated toast list');

        const modals = document.querySelectorAll("#modals > .modal");
        if (modals.length === 0)
            return;

        // Focus
        const lastToast = modals[ modals.length - 1 ];
        focusContent( lastToast );

    });
    
    return <>
        {modals.length !== 0 ? (
            <div id="modals">
                {modals}
            </div>
        ) : null}

        {toasts.length !== 0 ? (
            <div id="toasts">
                {toasts}
            </div>
        ) : null}
    </>

}