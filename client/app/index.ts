/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
if (typeof window === 'undefined') throw new Error(`This file shouldn't be loaded on server side !!!!`);

window.dev && require('preact/debug');

import type { Layout } from '@common/router';
import { createDialog } from '@client/components/Dialog/Manager';

// Local
import type { AnyService } from './service';

export { default as Service } from './service';

/*----------------------------------
- TYPES
----------------------------------*/

declare global {
    interface Window {
        dev: boolean;
        app?: Application;
        /*context: ClientContext,
        user: User,*/
        /*context: ClientContext,
        user: User,*/
    }
}

export type TBugReportInfos = { stacktrace?: string; observation?: string; before?: string };

export type TClientBugReportInfos = TBugReportInfos & { context?: string; guiVersion: string; url: string };

// Without prettify, we don't get a clear list of the class properties
type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type ApplicationProperties = Prettify<keyof Application>;

const normalizeBrowserErrorMessage = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string')
        return value.message;

    return '';
};

const isIgnorableBrowserErrorMessage = (message: string) =>
    message === 'ResizeObserver loop completed with undelivered notifications.' ||
    message === 'ResizeObserver loop limit exceeded';

export const getClientErrorMessage = (error: unknown, fallbackMessage = 'Unknown client error'): string => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message)
        return error.message;

    return fallbackMessage;
};

export const normalizeClientError = (error: unknown, fallbackMessage?: string): Error => {
    if (error instanceof Error) return error;

    return new Error(getClientErrorMessage(error, fallbackMessage));
};

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class Application {
    public side = 'client' as 'client';

    private servicesList: AnyService[] = [];

    // TODO: merge modal and toast in the same instance
    public modal = createDialog(this, false);
    public toast = createDialog(this, true);

    public constructor() {}

    public registerService(service: AnyService) {
        this.servicesList.push(service);
    }

    public start() {
        this.bindErrorHandlers();
        this.startServices();
        this.boot();
    }

    public abstract boot(): void;

    public startServices() {
        for (const service of this.servicesList) {
            service.start();
        }
    }

    public bindErrorHandlers() {
        // Impossible de recup le stacktrace ...
        window.addEventListener('unhandledrejection', (e) => {
            this.handleError(e.reason);
        });

        window.onerror = (message, file, line, col, stacktrace) => {
            const normalizedMessage = normalizeBrowserErrorMessage(message);
            if (isIgnorableBrowserErrorMessage(normalizedMessage)) return true;

            console.error(`Exception catched by method B`, normalizedMessage || message);
            this.reportBug({ stacktrace: stacktrace?.stack || JSON.stringify({ message: normalizedMessage || message, file, line, col }) }).then(
                () => {
                    // TODO in toas service: app.on('bug', () => toast.warning( ... ))
                    /*context?.toast.warning("Bug detected", 
                    "A bug report has been sent, because I've detected a bug on the interface. I'm really sorry for the interruption.",
                    null,
                { autohide: false });*/
                },
            );
        };
    }

    public handleError(error: unknown, fallbackMessage?: string): string {
        const normalizedError = normalizeClientError(error, fallbackMessage);
        console.error(normalizedError);

        return getClientErrorMessage(error, fallbackMessage);
    }

    public abstract handleUpdate(): void;

    // TODO: move on app side
    public reportBug = (infos: TBugReportInfos) =>
        fetch('/feedback/bug/ui', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: window.location.pathname,
                context: JSON.stringify((window as Window & { ssr?: unknown }).ssr),
                guiVersion: BUILD_DATE,
                ...infos,
            }),
        });

    public setLayout(_layout: Layout) {
        throw new Error(`page.setLayout has been called before the function is assigned from the <App /> component.`);
    }
}
