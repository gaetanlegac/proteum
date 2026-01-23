/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm: Serveurs
import bytes from 'bytes';
import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import cors, { CorsOptions } from 'cors';

// Middlewares (npm)
import morgan from 'morgan';
import hpp from 'hpp'; // Protection contre la pollution des reuqtees http
import helmet from 'helmet'; // Diverses protections
import compression from 'compression';
import fileUpload from 'express-fileupload';
import cookieParser from 'cookie-parser';
import * as csp from 'express-csp-header';

// Core
import Container from '@server/app/container';
import type Router from '..';

// Middlewaees (core)
import { MiddlewareFormData } from './multipart';

/*----------------------------------
- CONFIG
----------------------------------*/

export type Config = {

    debug?: boolean,

    // Access
    domain: string,
    port: number,
    ssl: boolean,

    // Limitations / Load restriction
    upload: {
        maxSize: string // Expression package bytes
    },
    csp: {
        default?: string[],
        styles?: string[],
        images?: string[],
        scripts: string[],
    },
    cors?: CorsOptions,
    helmet?: Parameters<typeof helmet>[0]
}

export type Hooks = {

}

/*----------------------------------
- FUNCTION
----------------------------------*/
export default class HttpServer {

    public http: http.Server | https.Server;
    public express: express.Express;

    public publicUrl: string;

    public constructor( 
        public config: Config, 
        public router: Router,
        public app = router.app
    ) {

        // Init
        this.publicUrl = this.app.env.name === 'local'
            ? 'http://localhost:' + this.config.port
            : ((this.config.ssl ? 'https' : 'http') + '://' + this.config.domain);

        // Configure HTTP server
        this.express = express();
        this.http = http.createServer(this.express);

        // Start HTTP Server
        this.app.on('cleanup', () => this.cleanup());
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/

    public async start() {

        const routes = this.express

        /*----------------------------------
        - SECURITÉ DE BASE
        ----------------------------------*/

        // Config
        routes.set('trust proxy', 1); // Indique qu'on est sous le proxy apache
        // Diverses protections (dont le disable x-powered-by)
        routes.use( helmet(this.config.helmet) );

        /*----------------------------------
        - FICHIERS STATIQUES
        ----------------------------------*/

        // Fichiers statiques: Eviter un maximum de middlewares inutiles
        // Normalement, seulement utile pour le mode production, 
        // Quand mode debug, les ressources client semblent servies par le dev middlewae
        // Sauf que les ressources serveur ne semblent pas trouvées par le dev-middleware
        routes.use(compression());
        routes.use('/public', cors());
        routes.use(
            '/public',
            express.static( Container.path.root + '/bin/public', {
                dotfiles: 'deny',
                setHeaders: function setCustomCacheControl(res, path) {

                    const dontCache = [
                        '/public/icons',
                        '/public/client'
                    ]

                    res.setHeader('Cache-Control', 'public, max-age=0');

                    // Set long term cache, except for non-hashed filenames
                    /*if (dontCache.some( p => path.startsWith( p ))) {
                        res.setHeader('Cache-Control', 'public, max-age=0');
                    } else {
                        res.setHeader('Cache-Control', 'public, max-age=604800000'); // 7 Days
                    }*/
                    
                }
            }),
            (req, res) => {
                res.status(404).send();
            }
        );
 
        routes.use('/robots.txt', express.static( path.resolve(__dirname, 'public/robots.txt')) );

        routes.get("/ping", (req, res) => res.send("pong"));

        /*----------------------------------
        - SESSION & SECURITE
        ----------------------------------*/
        // https://expressjs.com/fr/advanced/best-practice-security.html
        // Protection contre la pollution des reuqtees http
        routes.use(hpp());

        // Init de req.cookies
        routes.use(cookieParser())

        /*----------------------------------
        - DÉCODEURS
        ----------------------------------*/
        routes.use(

            // Décodage des données post
            express.json({
                // TODO: prendre en considération les upload de fichiers
                limit: bytes(this.config.upload.maxSize),
                verify: (req, res, buf, encoding) => {
                    // Store the raw request body so we can access it later
                    req.rawBody = buf;
                }
            }),

            // Permet de receptionner les données multipart (req.body + req.files)
            // A mettre avant les services, car l'assignement de req.socket fait planter les uploads
            fileUpload({
                debug: false,
                limits: {
                    fileSize: bytes(this.config.upload.maxSize),
                    abortOnLimit: true
                },
            }),

            // Décodage des requetes multipart
            // Peut-être requis par le résolver api
            MiddlewareFormData
        );

        /*----------------------------------
        - PAGES / API
        ----------------------------------*/

        if (this.config.cors !== undefined)
            routes.use( cors( this.config.cors ));

        routes.use( csp.expressCspHeader({
            directives: {
                'script-src': [csp.INLINE, csp.SELF, 
                   ...this.config.csp.scripts
                ]
            }
        }));
        
        routes.use( this.router.middleware.bind( this.router ) );

        /*----------------------------------
        - BOOT SERVICES
        ----------------------------------*/
        console.info("Lancement du serveur web");
        this.http.listen(this.config.port, () => {
            console.info(`Web server ready on ${this.publicUrl}`);
        });

    }

    public async cleanup() {
        this.http.close();
    }
}