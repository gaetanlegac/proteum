import { createBrowserHistory } from 'history';
export type { Update } from 'history';

export const history = (typeof window !== 'undefined') ? createBrowserHistory() : undefined;
export const location = history?.location;