/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import type { ComponentChild } from 'preact';
import { history } from '../request/history';

export const shouldOpenNewTab = (url: string, target?: string) =>
    url && (target !== undefined || !['/', '#'].includes(url[0]) || url.startsWith('//'));

/*----------------------------------
- COMPONENT
----------------------------------*/
// Simple link
export const Link = ({
    to,
    children,
    class: classNameAttr,
    className,
    onClick,
    target,
    ...props
}: {
    to: string;
    children?: ComponentChild;
    class?: string;
    className?: string;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const openNewTab = shouldOpenNewTab(to, typeof target === 'string' ? target : undefined);
    const resolvedTarget = openNewTab ? '_blank' : target;

    const handleClick: React.MouseEventHandler<HTMLAnchorElement> | undefined = openNewTab
        ? onClick
        : (e) => {
            history?.push(to);
            e.preventDefault();
            return false;
        };

    return (
        <a
            {...props}
            href={to}
            target={resolvedTarget}
            onClick={handleClick}
            class={classNameAttr ?? className}
        >
            {children}
        </a>
    );
};
