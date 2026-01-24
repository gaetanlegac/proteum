/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';

if (typeof window === 'undefined')
    throw new Error(`This file shouldn't be loaded on server side !!!!`);

window.dev && require('preact/debug');

// Core
import { CoreError, InputErrorSchema } from '@common/errors';
import type { Layout } from '@common/router';
import { createDialog } from '@client/components/Dialog/Manager';

// Local
import type { AnyService } from './service';

export { default as Service } from './service';

import 'tailwindcss';

/*----------------------------------
- TYPES
----------------------------------*/

declare global {
    interface Window {
        dev: boolean,
        /*context: ClientContext,
        user: User,*/
        /*context: ClientContext,
        user: User,*/
    }
}

export type TBugReportInfos = {
    stacktrace?: string,
    observation?: string,
    before?: string,
}

export type TClientBugReportInfos = TBugReportInfos & {
    context?: string,
    guiVersion: string,
    url: string,
}

// Without prettify, we don't get a clear list of the class properties
type Prettify<T> = {
    [K in keyof T]: T[K];
  } & {};

export type ApplicationProperties = Prettify<keyof Application>;

/*----------------------------------
- CLASS
----------------------------------*/
export default abstract class Application {

    public side = 'client' as 'client';

    private servicesList: AnyService[] = []

    // TODO: merge modal and toast in the same instance
    public modal = createDialog(this, false);
    public toast = createDialog(this, true);

    public constructor() {

    }

    public registerService( service: AnyService ) {
        console.log(`[app] Register service`, service.constructor?.name);
        this.servicesList.push(service);
    }

    public start() {
        this.bindErrorHandlers();
        this.startServices();
        this.boot();
    }

    public abstract boot(): void;

    public startServices() {

        console.log(`[app] Starting ${this.servicesList.length} services.`);

        for (const service of this.servicesList) {
            console.log(`[app] Start service`, service);
            service.start();
        }

        console.log(`[app] All ${this.servicesList.length} services were started.`);
    }

    public bindErrorHandlers() {

        // Impossible de recup le stacktrace ...
        window.addEventListener("unhandledrejection", (e) => {
            const error = new Error(e.reason); // How to get stacktrace ?
            this.handleError(error);
        });
        
        window.onerror = (message, file, line, col, stacktrace) => {
            console.error(`Exception catched by method B`, message);
            this.reportBug({
                stacktrace: stacktrace?.stack || JSON.stringify({ message, file, line, col })
            }).then(() => {

                // TODO in toas service: app.on('bug', () => toast.warning( ... ))
                /*context?.toast.warning("Bug detected", 
                    "A bug report has been sent, because I've detected a bug on the interface. I'm really sorry for the interruption.",
                    null,
                { autohide: false });*/

            })
        }
    }

    public abstract handleError( error: CoreError | Error );

    // TODO: move on app side
    public reportBug = (infos: TBugReportInfos) => fetch('/feedback/bug/ui', {
        method: 'POST',
        headers: {
            'Accept': "application/json",
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            url: window.location.pathname,
            context: JSON.stringify(window["ssr"]),
            guiVersion: BUILD_DATE,
            ...infos
        })
    })

    public setLayout(layout: Layout) {
        throw new Error(`page.setLayout has been called before the function is assigned from the <App /> component.`);
    };
}   