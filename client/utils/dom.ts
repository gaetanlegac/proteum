import type { RefObject } from 'preact';
import { history } from '@client/services/router/request/history';

type ElementOrSelector = HTMLElement | string;
export const deepContains = (
    parents: ElementOrSelector | ElementOrSelector[],
    children: HTMLElement
): boolean => {

    if (!Array.isArray(parents))
        parents = [parents];

    let node: HTMLElement | null = children;
    while (node) {
        for (const parent of parents) {
            //console.log('Checking if', parent, 'matches with', node);
            if (
                // HTML Element
                node === parent 
                || 
                // CSS Selector
                (typeof parent === 'string' && node.matches && node.matches(parent))
            )
                return true;
        }

        node = node.parentNode as HTMLElement | null;
    }

    return false;
}

// Usage: React.useEffect( blurable([ <element>, <function> ]) );
export const blurable = (...args: [HTMLElement, Function][]) => {

    if (!history)
        return;

    const blur = (e: MouseEvent) => {

        if (e.target === null)
            return;

        for (const [refElement, masquer] of args) {

            //console.log("refElement", refElement, e.target?.matches);

            if (!deepContains([refElement], e.target))
                masquer();
                
        }
    }

    window.addEventListener('mousedown', blur);

    const unlisten = history.listen(() => {
        for (const [, masquer] of args) {

            masquer();

        }
    })

    return () => {
        window.removeEventListener('mousedown', blur);
        unlisten();
    }
}

export const focusContent = ( container: HTMLElement ) => {

    const toFocus = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input, textarea, button.btn.primary, footer > button.btn'
    ) || container;  // Is it useful ? Creating unwanted scroll issue on showing popover

    toFocus?.focus();
}