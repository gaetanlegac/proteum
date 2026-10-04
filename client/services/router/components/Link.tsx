/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import type { ComponentChild } from 'preact';

// Core
import { ReactClientContext } from '@/client/context';

// Specific
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
    prefetch,
    ...props
}: {
    to: string;
    children?: ComponentChild;
    class?: string;
    className?: string;
    // Loads the route chunk of `to` on hover or focus
    prefetch?: boolean;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const context = React.useContext(ReactClientContext);
    const openNewTab = shouldOpenNewTab(to, typeof target === 'string' ? target : undefined);
    const resolvedTarget = openNewTab ? '_blank' : target;

    const { onMouseEnter, onFocus } = props;
    const prefetchHandlers =
        prefetch && !openNewTab
            ? {
                  onMouseEnter: (e: React.MouseEvent<HTMLAnchorElement>) => {
                      void context?.Router.prefetch(to);
                      onMouseEnter?.(e);
                  },
                  onFocus: (e: React.FocusEvent<HTMLAnchorElement>) => {
                      void context?.Router.prefetch(to);
                      onFocus?.(e);
                  },
              }
            : {};

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
            {...prefetchHandlers}
            href={to}
            target={resolvedTarget}
            onClick={handleClick}
            class={classNameAttr ?? className}
        >
            {children}
        </a>
    );
};
