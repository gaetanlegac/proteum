/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import { ComponentChild } from 'preact';

// Core
import useContext from '@/client/context';
import { focusContent } from '@client/utils/dom';

// Specific
import type Application from '../../app';

/*----------------------------------
- TYPES: IMPORTATIONS
----------------------------------*/

/*----------------------------------
- TYPES: DECLARATIONS
----------------------------------*/

type TParams = { [cle: string]: unknown };

type CardInfos = TParams & {
    title?: string;
    content?: ComponentChild;
    boutons?: ComponentChild;
    type?: string;
    close?: (returnedValue?: unknown) => void;
    isToast?: boolean;
};

type TDialogRendererProps = CardInfos & { isToast?: boolean };

type ComposantToast = React.ComponentType<TDialogRendererProps> & { data?: object };

type TOptsToast = CardInfos & { content?: ComponentChild; data?: {}; className?: string };

type TOnCloseCallback<TReturnType extends any> = (returnedValue: TReturnType) => void;

type TToastShortcutArgs = [
    title: TOptsToast['title'],
    content?: TOptsToast['content'],
    boutons?: TOptsToast['boutons'],
    options?: TOptsToast,
];

export type TDialogControls = { close: TOnCloseCallback<any>; then: (cb: TOnCloseCallback<any>) => any };

type TDialogContentArg = ComposantToast | Promise<{ default: ComposantToast }> | TOptsToast;

type TDialogShowArgs =
    | [
          // On utilise une fonction pour pouvoir accéder aux fonctions (close, ...) lors de la déclaration des infos de la toast
          Content: TDialogContentArg,
          paramsInit?: TParams,
      ]
    | [
          title: string,
          // On utilise une fonction pour pouvoir accéder aux fonctions (close, ...) lors de la déclaration des infos de la toast
          Content: TDialogContentArg,
          paramsInit?: TParams,
      ];

type DialogActions = {
    setToasts: (setter: (old: ComponentChild[]) => ComponentChild[]) => void;
    setModals: (setter: (old: ComponentChild[]) => ComponentChild[]) => void;

    show: (...args: TDialogShowArgs) => TDialogControls;

    loading: (title: string) => TDialogControls;

    info: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls;

    success: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls;

    warning: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls;

    error: (...[title, content, boutons, options]: TToastShortcutArgs) => TDialogControls;
};

/*----------------------------------
- SERVICE CONTEXTE
----------------------------------*/
let idA: number = 0;

const isPromiseContent = (value: TDialogContentArg): value is Promise<{ default: ComposantToast }> =>
    typeof value === 'object' && value !== null && 'then' in value;

const isDialogRenderer = (value: TDialogContentArg): value is ComposantToast => typeof value === 'function';

const DefaultDialogContent = ({ title, content, boutons, type, isToast }: TDialogRendererProps) => (
    <div class={`dialog-card${type ? ` ${type}` : ''}${isToast ? ' is-toast' : ''}`}>
        {title ? <header>{title}</header> : null}
        {content ? <div class="dialog-card__content">{content}</div> : null}
        {boutons ? <footer>{boutons}</footer> : null}
    </div>
);

export const createDialog = (app: Application, isToast: boolean): DialogActions => {
    const show = <TReturnType extends any = true>(...args: TDialogShowArgs): TDialogControls => {
        let onClose: TOnCloseCallback<TReturnType>;
        const id = idA++;

        // Parse args
        let title: string | undefined;
        let Content: TDialogContentArg;
        let paramsInit: TParams = {};
        if (typeof args[0] === 'string') {
            const [nextTitle, nextContent, nextParams] = args as [string, TDialogContentArg, TParams?];
            title = nextTitle;
            Content = nextContent;
            paramsInit = nextParams || {};
        } else {
            const [nextContent, nextParams] = args as [TDialogContentArg, TParams?];
            Content = nextContent;
            paramsInit = nextParams || {};
        }

        // Set instance management function
        const setDialog = isToast ? instance.setToasts : instance.setModals;

        // Close function
        const close = (retour: TReturnType) => {
            setDialog((q) =>
                (q as Array<ComponentChild & { id?: number }>).filter((m) => m && m.id !== id) as ComponentChild[],
            );

            if (onClose !== undefined) onClose(retour);
        };

        const promise = new Promise(async (resolve: TOnCloseCallback<TReturnType>) => {
            onClose = resolve;

            let render: ComponentChild;
            let propsRendu: TDialogRendererProps = { ...paramsInit, close: close };

            // modal.show( import('./modalSupprimer') )
            //  -> Fetch component
            if (isPromiseContent(Content)) Content = (await Content).default;

            // modal.show('Supprimer', import('./modalSupprimer'))
            //  -> Shortcut for passing a title to the component or default card renderer.
            if (title !== undefined) propsRendu.title = title;

            if (isDialogRenderer(Content)) {
                render = <Content {...propsRendu} isToast={isToast} />;
            } else {
                render = <DefaultDialogContent {...propsRendu} {...Content} isToast={isToast} />;
            }

            // Chargeur de données
            /*if (('data' in ComposantCharge) && typeof ComposantCharge.data === 'function') {
     
                propsRendu.data = await ComposantCharge.data(app, paramsInit);
     
                const { fetchersStateA } = initStateAsync(propsRendu.data, {}, false);
     
                await execFetchersState(fetchersStateA);
     
            }*/

            if (!isToast) render = <div class="modal">{render}</div>;

            (render as ComponentChild & { id?: number }).id = id;

            setDialog((q) => [...q, render]);
        });

        return { close, then: (cb) => promise.then(cb) };
    };

    const instance: DialogActions = {
        show: show,

        setToasts: () => undefined,
        setModals: () => undefined,

        loading: (title: string) => show({ title: title, type: 'loading' }),

        info: (...[title, content, boutons, options]: TToastShortcutArgs) =>
            show({ title: title, type: 'info', content: content && <p>{content}</p>, boutons, ...options }),

        success: (...[title, content, boutons, options]: TToastShortcutArgs) =>
            show({ title: title, type: 'success', content: content && <p>{content}</p>, boutons, ...options }),

        warning: (...[title, content, boutons, options]: TToastShortcutArgs) =>
            show({ title: title, type: 'warn', content: content && <p>{content}</p>, boutons, ...options }),

        error: (...[title, content, boutons, options]: TToastShortcutArgs) =>
            show({ title: title, type: 'error', content: content && <p>{content}</p>, boutons, ...options }),
    };

    return instance;
};

/*----------------------------------
- COMPOSANT
----------------------------------*/
import './index.less';
export default () => {
    const app = useContext();

    const [modals, setModals] = React.useState<ComponentChild[]>([]);
    const [toasts, setToasts] = React.useState<ComponentChild[]>([]);

    if (app.side === 'client' && app.modal && app.toast) {
        (app.modal as DialogActions).setModals = setModals;
        (app.toast as DialogActions).setToasts = setToasts;
    }

    React.useEffect(() => {
        console.log('Updated toast list');

        const modals = document.querySelectorAll('#modals > .modal');
        if (modals.length === 0) return;

        // Focus
        const lastToast = modals[modals.length - 1];
        focusContent(lastToast as HTMLElement);
    });

    return (
        <>
            {modals.length !== 0 ? <div id="modals">{modals}</div> : null}

            {toasts.length !== 0 ? <div id="toasts">{toasts}</div> : null}
        </>
    );
};
