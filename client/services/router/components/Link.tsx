/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import type { ComponentChild } from 'preact';
import { history } from '../request/history';

export const shouldOpenNewTab = (url: string, target?: string) => url && (
    target !== undefined
    ||
    !['/', '#'].includes(url[0])
    || 
    url.startsWith('//')
)

/*----------------------------------
- COMPONENT
----------------------------------*/
// Simple link
export const Link = ({ to, ...props }: { 
    to: string,
    children?: ComponentChild,
    class?: string,
    className?: string
} & React.HTMLProps<HTMLAnchorElement>) => {

    const openNewTab = shouldOpenNewTab(to, props.target);

    // External = open in new tab by default
    if (openNewTab)
        props.target = '_blank';
    // Otherwise, propagate to the router
    else 
        props.onClick = (e) => {
            history?.push(to);
            e.preventDefault();
            return false
        }

    return (
        <a {...props} href={to} />
    )

}