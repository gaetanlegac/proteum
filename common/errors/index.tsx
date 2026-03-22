import type { ComponentChild } from 'preact';

import type ServerRequest from '@server/services/router/request';
import type { TBasicUser } from '@server/services/auth';

/*----------------------------------
- TYPES
----------------------------------*/

export type TListeErreursSaisie<TClesDonnees extends string = string> = { [champ in TClesDonnees]: string[] };

export type TJsonError = {
    code: number;
    origin?: string;
    message: string;
    // Form fields
    errors?: TListeErreursSaisie;
} & TErrorDetails;

type TErrorDetails = {
    // Allow to identify the error catched (ex: displaying custop content, running custom actions, ...)
    id?: string;
    data?: {};

    cta?: { label: string; link: string };

    // For debugging
    stack?: string;
    origin?: string;
};

/*----------------------------------
- TYPES: BUG REPORT
----------------------------------*/

export type ServerBug = {
    // Context
    hash: string;
    isDuplicate: boolean;
    date: Date; // Timestamp
    channelType?: string;
    channelId?: string;

    // User
    user?: TBasicUser | null;
    ip?: string | null;

    // Request
    request?: {
        method: ServerRequest['method'];
        url: ServerRequest['url'];
        data: ServerRequest['data'];
        validatedData: ServerRequest['validatedData'];
        headers: ServerRequest['headers'];
        cookies: ServerRequest['cookies'];
    };

    // Error
    title?: string;
    stacktraces: string[];
    context: object[];
};

export type TCatchedError = Error | CoreError | Anomaly;

/*----------------------------------
- ERREURS
----------------------------------*/
export abstract class CoreError extends Error {
    public static msgDefaut: string;

    public abstract http: number;
    public title: string = 'Uh Oh ...';
    public message: string;
    public details: TErrorDetails = {};

    // Note: On ne le redéfini pas ici, car déjà présent dans Error
    //      La redéfinition reset la valeur du stacktrace
    //public stack?: string;

    public constructor(message?: string, details?: TErrorDetails) {
        super(message);

        this.message = message || (this.constructor as typeof CoreError).msgDefaut;
        this.details = details || {};

        // Inject stack
        if (details !== undefined) this.stack = details.stack;
    }

    public json(): TJsonError {
        return { code: this.http, message: this.message, ...this.details };
    }

    public toString() {
        return this.message;
    }

    public render?(): ComponentChild;
}

export class InputError extends CoreError {
    public http = 400;
    public title = 'Bad Request';
    public static msgDefaut = 'Bad Request.';
}

export class InputErrorSchema extends CoreError {
    public http = 400;
    public title = 'Bad Request';
    public static msgDefaut = 'Bad Request.';

    private static listeToString(liste: TListeErreursSaisie) {
        let chaines: string[] = [];
        for (const champ in liste) chaines.push(champ + ': ' + liste[champ].join('. '));
        return chaines.join('; ');
    }

    public constructor(
        public errors: TListeErreursSaisie,
        details?: TErrorDetails,
    ) {
        super(InputErrorSchema.listeToString(errors), details);
    }

    public json(): TJsonError {
        return { ...super.json(), errors: this.errors };
    }

    public render(): ComponentChild {
        return (
            <ul class="col al-left">
                {Object.keys(this.errors).map((champ) => (
                    <li>
                        {champ}: {this.errors[champ].join('. ')}
                    </li>
                ))}
            </ul>
        );
    }
}

export class AuthRequired<FeatureKeys extends string> extends CoreError {
    public http = 401;
    public title = 'Authentication Required';
    public static msgDefaut = 'Please Login to Continue.';

    public constructor(
        message: string,
        public feature: FeatureKeys,
        public action: string,
        details?: TErrorDetails,
    ) {
        super(message, details);
    }

    public json(): TJsonError & { feature: string; action: string } {
        return { ...super.json(), feature: this.feature, action: this.action };
    }
}

export class UpgradeRequired<FeatureKeys extends string> extends CoreError {
    public http = 402;
    public title = 'Upgrade Required';
    public static msgDefaut = 'Please Upgrade to Continue.';

    public constructor(
        message: string,
        public feature: FeatureKeys,
        public action: string,
        details?: TErrorDetails,
    ) {
        super(message, details);
    }

    public json(): TJsonError & { feature: string; action: string } {
        return { ...super.json(), feature: this.feature, action: this.action };
    }
}

export class Forbidden extends CoreError {
    public http = 403;
    public title = 'Access Denied';
    public static msgDefaut = 'You do not have sufficient permissions to access this content.';
}

export class NotFound extends CoreError {
    public http = 404;
    public title = 'Not Found';
    public static msgDefaut = 'The resource you asked for was not found.';
}

export class Gone extends CoreError {
    public http = 410;
    public title = 'Gone';
    public static msgDefaut = 'The resource you asked for has been removed.';
}

export class RateLimit extends CoreError {
    public http = 429;
    public title = "You're going too fast";
    public static msgDefaut = 'Please slow down a bit and retry again later.';
}

export class Anomaly extends CoreError {
    public http = 500;
    public title = 'Technical Error';
    public static msgDefaut = 'A technical error has occurred. A notification has just been sent to the admin.';

    public constructor(
        message: string,
        public dataForDebugging?: object,
        public originalError?: Error,
    ) {
        super(message);
    }
}

export class NotAvailable extends CoreError {
    // TODO: page erreur pour code 503
    public http = 404;
    public title = 'Not Available';
    public static msgDefaut = 'Sorry, the service is currently not available.';
}

export class NetworkError extends Error {
    public title = 'Network Error';
}

export const viaHttpCode = (code: number, message: string, details?: TErrorDetails): CoreError => {
    return fromJson({ code, message, ...details });
};

export const toJson = (e: Error | CoreError): TJsonError => {
    if ('json' in e && typeof e.json === 'function') return e.json();

    const details = 'details' in e ? e.details : { stack: e.stack };

    return { code: 500, message: e.message, ...details };
};

export const fromJson = ({ code, message, ...details }: TJsonError) => {
    const errorDetails = details as Record<string, unknown>;

    switch (code) {
        case 400:
            if (details.errors) return new InputErrorSchema(details.errors, details);
            else return new InputError(message, details);

        case 401:
            return new AuthRequired(message, errorDetails.feature as FeatureKeys, errorDetails.action as string, details);

        case 402:
            return new UpgradeRequired(
                message,
                errorDetails.feature as FeatureKeys,
                errorDetails.action as string,
                details,
            );

        case 403:
            return new Forbidden(message, details);

        case 404:
            return new NotFound(message, details);

        case 429:
            return new RateLimit(message, details);

        default:
            return new Anomaly(message, details);
    }
};

export default CoreError;
