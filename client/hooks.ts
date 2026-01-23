import React from 'react';
import type { ComponentChild } from 'preact';

// Hooks
/*export { default as useState } from '@client/hooks/useState';
export type { TActions as TActionsState } from '@client/hooks/useState';
export { default as useComponent } from '@client/hooks/useComponent';
export { default as useScript } from '@client/hooks/useScript';*/

// Utils
export const Switch = (val: string | number, options: { [cle: string]: ComponentChild }) => {
    return (val in options) ? options[val] : null;
}

export const useState = <TData extends TObjetDonnees>(initial: TData): [
    TData,
    (data: Partial<TData>) => void
] => {
    const [state, setState] = React.useState<TData>(initial);
    const setPartialState = (data: Partial<TData>) => setState(current => ({ ...current, ...data }));
    return [state, setPartialState]
}