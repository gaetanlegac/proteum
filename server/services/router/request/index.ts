/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type express from 'express';
import ISO6391 from 'iso-639-1';
import accepts from 'accepts';
import Bowser from "bowser";

// Core
import BaseRequest from '@common/router/request';

// Specific
import type { 
    default as Router, Config as RouterConfig, 
    HttpMethod, HttpHeaders
} from '..';
import ApiClient from './api';
import ServerResponse from '../response';
import type { TAnyRouter } from '..';

/*----------------------------------
- TYPES
----------------------------------*/

const localeFilter = (input: any) => {

    // Data type
    if (typeof input !== 'string')
        return;

    // Extract ISO code
    let lang = input.trim().split(/[-_]/)[0].toLowerCase();
    
    // Check size
    if (!ISO6391.validate(lang))
        return;

    return lang.toUpperCase();
}

export type UploadedFile = File

/*----------------------------------
- CONTEXTE
----------------------------------*/
export default class ServerRequest<
    TRouter extends TAnyRouter = TAnyRouter
> extends BaseRequest {

    /*----------------------------------
    - PROPRIÉTÉS
    ----------------------------------*/

    public id: string;
    public isVirtual: boolean = false;

    // Requete
    public method: HttpMethod;
    public ip?: string;
    public locale: string;
    public domain: string;
    public headers: HttpHeaders = {};
    public cookies: TObjetDonnees = {};
    public validatedData?: TObjetDonnees; // Results from the last schema.validate

    // reponse
    public response?: ServerResponse<TRouter>;
    public router: TRouter;

    // Origin
    public req: express.Request;
    public res: express.Response;

    // Services
    public api: ApiClient;

    /*----------------------------------
    - INITIALISATION
    ----------------------------------*/
    public constructor( 

        id: string,
        method: HttpMethod, 
        path: string, 
        data: TObjetDonnees | undefined,
        headers: HttpHeaders | undefined,

        res: express.Response, 
        router: TRouter,
        isVirtual: boolean = false
    ) {

        super(path);

        this.id = id;
        this.isVirtual = isVirtual;

        this.req = res.req;
        this.res = res
        this.router = router;
        this.api = new ApiClient(this);

        this.url = this.req.protocol + '://' + this.req.get('host') + this.req.originalUrl;
        this.host = this.req.get('host') as string;
        this.method = method;
        this.headers = headers || {};
        this.locale = this.getLocale();
        this.domain = res.req.hostname;
        this.cookies = res.req.cookies;

        this.ip = res.req.ip;

        this.data = data || {};
    }

    public children(method: HttpMethod, path: string, data: TObjetDonnees | undefined) {
        const children = new ServerRequest( 
            this.id, method, path, data, { ...this.headers, accept: 'application/json' },
            this.res, this.router, true
        );
        children.user = this.user;
        return children;
    }

    private getLocale() {

        const fromQuery = localeFilter(this.req.query.lang);
        if (fromQuery) {
            this.res.cookie('lang', fromQuery);
            return fromQuery;
        } 

        const locale = (
            // Member settings
            this.user?.locale 
            ||
            // URL
            localeFilter( this.req.cookies.lang )
            ||
            // Browser
            localeFilter( this.req.acceptsLanguages()[0] )
            || 
            // Default
            'EN'
        )

        return locale ? locale.toUpperCase() : 'EN'
    }

    public cookie( key: string, consume: boolean = false ) {

        const value = this.req.cookies[ key ];

        if (consume)
            this.res.clearCookie(key);

        return value;

    }

    /*----------------------------------
   - TESTS
   ----------------------------------*/

    public accepts(datatype: string | undefined) {
        // https://github.com/jshttp/accepts
        return datatype === undefined || datatype === '*' || accepts(this).type(datatype);
    }

    public device(): Bowser.Parser.ParsedResult | undefined {
        return this.headers['user-agent'] !== undefined
            ? Bowser.parse(this.headers['user-agent'])
            : undefined;
    }

    public deviceString(): string | undefined {
        const info = this.device();
        if (info === undefined) return undefined;
        const { os, browser } = info;
        return (os.name || 'Unknown OS') + ' ' + (os.versionName || os.version || '') + ' / ' + (browser.name || 'Unknown browser') + ' ' + (browser.version || '');
    }
}