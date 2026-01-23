/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import { VNode, RefObject,ComponentChild } from 'preact';

// Core
import { shouldOpenNewTab } from '@client/services/router/components/Link';
import { history } from '@client/services/router/request/history';
import useContext from '@/client/context';

/*----------------------------------
- TYPES
----------------------------------*/

export type Props = {

    id?: string,
    refElem?: RefObject<HTMLElement>,

    icon?: ComponentChild,
    iconR?: ComponentChild,

    prefix?: ComponentChild,
    suffix?: ComponentChild,
    
    tag?: "a" | "button",
    type?: 'guide' | 'primary' | 'secondary' | 'link',
    shape?: 'default' | 'icon' | 'tile' | 'pill' | 'custom',
    size?: TComponentSize,
    class?: string,

    state?: [string, React.StateUpdater<string>],
    active?: boolean,
    selected?: boolean,
    disabled?: boolean,
    loading?: boolean,
    autoFocus?: boolean,
    onClick?: (e: MouseEvent) => any,
    async?: boolean,

    submenu?: ComponentChild,
    nav?: boolean | 'exact'

// SEO: if icon only, should provinde a hint (aria-label)
} & ({ 
    hint: string,
    children?: ComponentChild | ComponentChild[],
} | { 
    children: ComponentChild | ComponentChild[],
    hint?: string,
}) & (TButtonProps | TLinkProps)

export type TButtonProps = React.JSX.HTMLAttributes<HTMLButtonElement>

export type TLinkProps = React.JSX.HTMLAttributes<HTMLAnchorElement>

/*----------------------------------
- HELPERS
----------------------------------*/
const trimSlash = (str: string): string => {
    return str.endsWith('/') ? str.slice(0, -1) : str;
}

const isCurrentUrl = (currentUrl: string, url: string, exact?: boolean) => {
    return (
        (exact && (url === currentUrl || trimSlash(url) === currentUrl))
        ||
        (!exact && currentUrl.startsWith(url))
    )
}

/*----------------------------------
- CONTROLEUR
----------------------------------*/
export default ({

    id,

    // Content
    icon, prefix, 
    children, 
    iconR, suffix,
    submenu,
    nav,
    hint,

    // Style
    class: className,
    shape,
    size,
    type,

    // Interactions
    active,
    selected,
    state: stateUpdater,
    disabled,
    loading,
    //autoFocus,
    async,

    // HTML attributes
    tag: Tag,
    refElem,
    ...props

}: Props) => {

    const ctx = useContext();
    let [isSelected, setIsSelected] = React.useState(false);
    let [isActive, setIsActive] = React.useState(false);
    const [isLoading, setLoading] = React.useState(false);

    if (isLoading || loading) {
        icon = <i src="spin" />
        iconR = undefined;
        disabled = true;
    }

    if (stateUpdater && id !== undefined) {
        const [active, setActive] = stateUpdater;
        if (id === active)
            isSelected = true;
        props.onClick = () => setActive(id);
    }

    // Hint
    if (hint !== undefined) {
        props['aria-label'] = hint;
        props.title = hint;
    }

    // Shape classes
    const classNames: string[] = ['btn'];
    if (className)
        classNames.push(className);

    if (shape !== undefined) {
        if (shape === 'tile')
            classNames.push('col');
        else
            classNames.push(shape);
    }

    if (size !== undefined)
        classNames.push(size);

    if (icon) {
        if (children === undefined)
            classNames.push('icon');
    }

    // state classes
    const [isMouseDown, setMouseDown] = React.useState(false);
    props.onMouseDown = () => setMouseDown(true);
    props.onMouseUp = () => setMouseDown(false);
    props.onMouseLeave = () => setMouseDown(false);

    // Theming & state
    if (isMouseDown)
        classNames.push('pressed');
    else if (selected || isSelected === true)
        classNames.push('bg accent');
    else if (type !== undefined)
        classNames.push(type === 'link' ? type : (' bg ' + type));
    
    if (active || isActive === true)
        classNames.push('active');

    // Icon
    if (prefix === undefined && icon !== undefined)
        prefix = typeof icon === "string" ? <i class={"svg-" + icon} /> : icon;
    if (suffix === undefined && iconR !== undefined)
        suffix = typeof iconR === "string" ? <i class={"svg-" + iconR} /> : iconR;

    // Render
    if ('link' in props || Tag === "a") {

        // Link (only if enabled)
        if (!disabled) {

            props.href = props.link;
            
            // External = open in new tab by default
            if (shouldOpenNewTab( props.href, props.target ))
                props.target = '_blank';
        }

        // Nav
        if (nav && props.target === undefined) {

            const checkIfCurrentUrl = (url: string) => 
                isCurrentUrl(url, props.link, nav === 'exact');

            React.useEffect(() => {

                // Init
                if (checkIfCurrentUrl(ctx.request.path))
                    setIsActive(true);

                // On location change
                return history?.listen(({ location }) => {

                    setIsActive( checkIfCurrentUrl(location.pathname) );

                })

            }, []);
        }

        Tag = 'a';

    } else {
        Tag = 'button';

        // Avoid to trigget onclick when presing enter
        if (type !== 'primary')
            props.type = 'button';
        else
            props.type = 'submit';
    }

    let render: VNode = (
        <Tag {...props} id={id} class={classNames.join(' ')} disabled={disabled} ref={refElem} onClick={(e: MouseEvent) => {

            // annulation si:
            // - Pas clic gauche
            // - Event annulé
            if (e.button !== 0)
                return;

            // Disabled
            if (disabled)
                return false;

            // Custom event
            if (props.onClick !== undefined) {

                const returned = props.onClick(e);
                if (async && returned?.then) {
                    setLoading(true);
                    returned.finally(() => setLoading(false));
                }
            }

            // Link
            let nativeEvent: boolean = false;
            if (('link' in props) && !e.defaultPrevented) {

                // Nouvelle fenetre = event par defaut
                if (props.target === '_blank') {

                    nativeEvent = true;

                // Page change = loading indicator
                } else if (props.target === "_self") {

                    setLoading(true);
                    window.location.href = props.link;

                } else {

                    history?.push(props.link);
                }
            }

            if (!nativeEvent) {
                e.preventDefault();
                return false;
            }       
        }}>
            {prefix}
            {children === undefined 
                ? null 
                : shape === 'custom' 
                ? children : (
                    <span class={"label"}>
                        {children}
                    </span>
                )}
            {suffix}
        </Tag>
    )

    if (Tag === "li" || submenu) {
        render = (
            <li>
                {render}
                {submenu}
            </li>
        )
    }

    return render;
}