/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';

// Composants globaux
import Button from '@client/components/Button';

/*----------------------------------
- TYPES
----------------------------------*/
import { ComponentChild } from 'preact';

type funcBtns = () => void

type Boutons = { [label: string]: funcBtns }

/*----------------------------------
- CONTENU
----------------------------------*/
export type Props = {

    // Informations modale
    type?: 'primary' | 'success' | 'warning' | 'error' | 'loading' | 'info',
    cover?: string,
    icon?: ComponentChild,
    title?: string | ComponentChild,
    className?: string,

    children?: ComponentChild,
    isToast?: boolean,
    width?: number,

    footer?: ComponentChild,
    boutons?: Boutons | null, // nul = pas de footer
    defaultBtn?: string,

    prison?: boolean,
    /* Hide after x seconds */autohide?: number | false,
    close?: funcBtns,
    onClose?: () => Promise<any>,
}

export default ({

    // Content
    type,
    cover,
    icon, 
    title, 
    className = '',

    children, 
    isToast,
    width,

    footer,
    boutons,
    defaultBtn,

    onClose, 
    close,
    autohide,
    prison,

}: Props) => {

    // Boutons
    if (footer === undefined && boutons !== null) {

        // Default buttons
        if (boutons === undefined || !Object.keys(boutons).length) {

            // Toast: by default, if no buttons, we autohide after 3 seconds
            if (autohide === undefined)
                autohide = 3;

            // If isToast, we show a default OK button
            if (close && !isToast)
                boutons = { 'Ok': () => close(true) };
            else
                boutons = null;

        }

        if (boutons !== null) {

            const nbBtns = Object.keys(boutons).length;

            footer = Object.entries(boutons).map(([texte, action]: [string, Function], index: number) => {
                const dernier = nbBtns > 1 && index === nbBtns - 1;
                return (
                    <Button
                        async
                        onClick={() => action()}
                        type={(defaultBtn === undefined ? dernier : (defaultBtn === texte)) ? 'primary' : undefined}
                    >
                        {texte}
                    </Button>
                )
            });
        }
    }

    if (typeof icon === 'string')
        icon = <i class={"svg-" + icon} />
    else if (icon === undefined)
        switch (type) {
            case 'info':
                icon = <i src="info-circle" />
                break;
            case 'success':
                icon = <i src="check-circle" />
                break;
            case 'warning':
                icon = <i src="exclamation-circle" />
                break;
            case 'error':
                icon = <i src="times-circle" />
                break;
            case 'loading':
                icon = <i src="spin" />
                break;
        }
        
    // Autohide
    if (isToast)
        React.useEffect(() => {
            if (autohide) {
                const timeout = setTimeout(() => close(true), autohide * 1000);
                return () => clearTimeout(timeout);
            }
        }, []);

    let render = isToast ? (
        <div class="card row bg dark" onClick={() => isToast && !prison && close(true)}>

            {icon}

            <div>

                {typeof title === "string" ? (
                    <strong>{title}</strong>
                ) : title}

                {children}

            </div>
            
        </div>
    ) : (
        <div class={"card pd-2 col al-top " + className} style={width === undefined 
            ? {}
            : { minWidth: width + "px", maxWidth: width + "px" }
        }>

            {(title || icon) && (
                <header {...{
                    class: ('col ' + type),
                    style: cover ? {
                        backgroundImage: 'url(' + cover + ')'
                    } : undefined
                }}>

                    {icon}

                    {typeof title === "string" ? (
                        <strong>{title}</strong>
                    ) : title}

                    {(!prison && close) && (
                        <Button class="close" icon="times" size="s" shape="pill" onClick={async () => {
                            if (typeof close === "function") {

                                if (onClose !== undefined)
                                    onClose(false);
                                else
                                    close(false);
                            }
                        }} />
                    )}

                </header>
            )}

            {children && (
                <div class="col content">

                    {children}

                </div>
            )}

            {footer && (
                <footer class="row fill actions">

                    {footer}

                </footer>
            )}

        </div>
    )

    return render;
}