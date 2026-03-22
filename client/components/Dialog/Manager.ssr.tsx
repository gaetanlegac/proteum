/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import type { ComponentChild } from 'preact';

type TDialogControls = { close: (returnedValue?: unknown) => void; then: (cb: (value: unknown) => void) => void };

type TDialogActions = {
    setToasts: (setter: (old: ComponentChild[]) => ComponentChild[]) => void;
    setModals: (setter: (old: ComponentChild[]) => ComponentChild[]) => void;
    show: (...args: unknown[]) => TDialogControls;
    loading: (title: string) => TDialogControls;
    info: (...args: unknown[]) => TDialogControls;
    success: (...args: unknown[]) => TDialogControls;
    warning: (...args: unknown[]) => TDialogControls;
    error: (...args: unknown[]) => TDialogControls;
};

const noopControls = (): TDialogControls => ({ close: () => undefined, then: () => undefined });

export const createDialog = (_app?: unknown, _isToast?: boolean): TDialogActions => ({
    setToasts: () => undefined,
    setModals: () => undefined,
    show: () => noopControls(),
    loading: () => noopControls(),
    info: () => noopControls(),
    success: () => noopControls(),
    warning: () => noopControls(),
    error: () => noopControls(),
});

/*----------------------------------
- COMPOSANT
----------------------------------*/
export default function DialogManager() {
    return null;
}
