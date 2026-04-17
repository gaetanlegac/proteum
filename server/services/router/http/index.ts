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

// Core
import Container from '@server/app/container';
import type CronManager from '@server/services/cron';
import type CronTask from '@server/services/cron/CronTask';
import type { TBasicUser } from '@server/services/auth';
import type { TServerRouter } from '..';
import type { TDevConsoleLogLevel } from '@common/dev/console';
import type { TPerfGroupBy } from '@common/dev/performance';
import type { TServerReadyConnectedProject } from '@common/dev/serverHotReload';
import type { TDevSessionStartResponse, TDevSessionUserSummary } from '@common/dev/session';
import { serverHotReloadMessageType } from '@common/dev/serverHotReload';
import { explainSectionNames } from '@common/dev/diagnostics';
import {
    type TConnectedProjectHealthResponse,
    connectedProjectHealthPath,
    connectedProjectProxyPathPrefix,
    parseConnectedProjectProxyPath,
} from '@common/connectedProjects';
import { profilerTraceRequestIdHeader } from '@common/dev/profiler';

// Middlewaees (core)
import { isMutipart, MiddlewareFormData } from './multipart';

/*----------------------------------
- CONFIG
----------------------------------*/

export type Config = {
    debug?: boolean;

    // Access
    domain: string;
    port: number;
    ssl: boolean;

    // Limitations / Load restriction
    upload: {
        maxSize: string; // Expression package bytes
    };
    csp: { default?: string[]; styles?: string[]; images?: string[]; scripts: string[] };
    cors?: CorsOptions;
    helmet?: Parameters<typeof helmet>[0];
};

export type Hooks = {};

type TContentSecurityPolicyOptions = NonNullable<Parameters<typeof helmet.contentSecurityPolicy>[0]>;
type TContentSecurityPolicyDirectives = NonNullable<TContentSecurityPolicyOptions['directives']>;
type TDevSessionAuthService = {
    config: {
        jwt: {
            expiration: number;
        };
    };
    createSession: (session: { email: string }, request: { id: string; res: express.Response }) => string;
    decodeSession: (session: { email: string }, req: express.Request) => Promise<TBasicUser | null>;
};

const createContentSecurityPolicy = (config: Config['csp']): TContentSecurityPolicyOptions => {
    const directives: TContentSecurityPolicyDirectives = {
        defaultSrc:
            config.default && config.default.length > 0
                ? [...config.default]
                : helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        scriptSrc: ["'unsafe-inline'", "'self'", "'unsafe-eval'", ...config.scripts],
    };

    if (config.styles && config.styles.length > 0) directives.styleSrc = [...config.styles];
    if (config.images && config.images.length > 0) directives.imgSrc = [...config.images];

    return {
        useDefaults: false,
        directives,
    };
};

const immutablePublicAssetCacheControl = 'public, max-age=31536000, immutable';
const devPublicAssetCacheControl = 'no-store';
const revalidatedPublicAssetCacheControl = 'public, max-age=0, must-revalidate';
const hashedPublicAssetPattern = /(^|[-_.])[a-f0-9]{6,}(?=(\.[^.]+)+$)/i;
const connectedProjectBootRetryCount = 10;
const connectedProjectBootRetryDelayMs = 5_000;

const isVersionedPublicAssetRequest = (res: undefined | express.Response | http.ServerResponse, filePath: string) => {
    const request =
        res && typeof res === 'object' && 'req' in res
            ? ((res as express.Response | (http.ServerResponse & { req?: express.Request })).req ?? undefined)
            : undefined;
    const requestUrl = request?.originalUrl || request?.url || '';
    const searchParams = new URL(requestUrl, 'http://proteum.local').searchParams;
    if (searchParams.has('v')) return true;

    return hashedPublicAssetPattern.test(path.basename(filePath));
};

const resolvePublicAssetCacheControl = ({
    res,
    filePath,
    profile,
}: {
    res: undefined | express.Response | http.ServerResponse;
    filePath: string;
    profile: string;
}) => {
    if (profile === 'dev') return devPublicAssetCacheControl;
    return isVersionedPublicAssetRequest(res, filePath) ? immutablePublicAssetCacheControl : revalidatedPublicAssetCacheControl;
};
const wait = async (durationMs: number) =>
    await new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
    });
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isConnectedProjectHealthResponse = (value: unknown): value is TConnectedProjectHealthResponse =>
    typeof value === 'object' &&
    value !== null &&
    (value as TConnectedProjectHealthResponse).ok === true &&
    isNonEmptyString((value as TConnectedProjectHealthResponse).identifier) &&
    isNonEmptyString((value as TConnectedProjectHealthResponse).name) &&
    Array.isArray((value as TConnectedProjectHealthResponse).connectedProjects);

/*----------------------------------
- FUNCTION
----------------------------------*/
export default class HttpServer<TRouter extends TServerRouter = TServerRouter> {
    public http: http.Server | https.Server;
    public express: express.Express;

    public publicUrl: string;

    public constructor(
        public config: Config,
        public router: TRouter,
        public app = router.app,
    ) {
        // Init
        this.publicUrl =
            this.app.env.name === 'local'
                ? 'http://localhost:' + this.config.port
                : (this.config.ssl ? 'https' : 'http') + '://' + this.config.domain;

        // Configure HTTP server
        this.express = express();
        this.http = http.createServer(this.express);

        // Start HTTP Server
        this.app.on('cleanup', () => this.cleanup());
    }

    private resolveDevSessionAuthService(): TDevSessionAuthService {
        const plugins = Object.values(this.router.config.plugins || {}) as Array<{ users?: unknown }>;

        for (const plugin of plugins) {
            const users = plugin?.users as Partial<TDevSessionAuthService> | undefined;
            if (!users) continue;
            if (typeof users.createSession !== 'function') continue;
            if (typeof users.decodeSession !== 'function') continue;
            if (typeof users.config?.jwt?.expiration !== 'number') continue;

            return users as TDevSessionAuthService;
        }

        throw new Error('No auth router plugin with a compatible users service is registered.');
    }

    private summarizeDevSessionUser(user: TBasicUser): TDevSessionUserSummary {
        return {
            email: user.email,
            name: user.name,
            type: user.type,
            roles: [...user.roles],
            locale: user.locale ?? null,
        };
    }

    private async verifyConnectedProjectsBeforeStart(): Promise<TServerReadyConnectedProject[]> {
        const verifiedConnectedProjects: TServerReadyConnectedProject[] = [];

        for (const connectedProject of Object.values(this.app.connectedProjects || {})) {
            const healthUrl = new URL(connectedProjectHealthPath, connectedProject.urlInternal).toString();
            let lastError: Error | undefined;

            for (let retryIndex = 0; retryIndex <= connectedProjectBootRetryCount; retryIndex++) {
                try {
                    const response = await fetch(healthUrl, {
                        headers: { Accept: 'application/json' },
                    });

                    if (!response.ok) {
                        throw new Error(
                            `Connected project "${connectedProject.namespace}" health check failed at ${healthUrl} with status ${response.status}.`,
                        );
                    }

                    const payload = (await response.json()) as unknown;
                    if (!isConnectedProjectHealthResponse(payload)) {
                        throw new Error(
                            `Connected project "${connectedProject.namespace}" health check returned an invalid payload at ${healthUrl}.`,
                        );
                    }

                    lastError = undefined;
                    verifiedConnectedProjects.push({
                        namespace: connectedProject.namespace,
                        identifier: payload.identifier.trim(),
                        name: payload.name.trim(),
                        urlInternal: connectedProject.urlInternal,
                        healthUrl,
                    });
                    break;
                } catch (error) {
                    lastError =
                        error instanceof Error && error.message.startsWith(`Connected project "${connectedProject.namespace}"`)
                            ? error
                            : new Error(
                                  `Connected project "${connectedProject.namespace}" is unreachable at ${connectedProject.urlInternal}. ${error instanceof Error ? error.message : String(error)}`,
                              );
                }

                if (!lastError) continue;
                if (retryIndex === connectedProjectBootRetryCount) throw lastError;

                console.warn(
                    `[connect] ${lastError.message} Retrying ${retryIndex + 1}/${connectedProjectBootRetryCount} in ${connectedProjectBootRetryDelayMs / 1000}s.`,
                );
                await wait(connectedProjectBootRetryDelayMs);
            }
        }

        return verifiedConnectedProjects;
    }

    private registerConnectedProjectRoutes(routes: express.Express) {
        routes.get(connectedProjectHealthPath, (_req, res) => {
            const response: TConnectedProjectHealthResponse = {
                connectedProjects: Object.keys(this.app.connectedProjects || {}),
                identifier: this.app.identity.identifier,
                name: this.app.identity.name,
                ok: true,
            };

            res.json(response);
        });

        routes.all(`${connectedProjectHealthPath}/*`, (_req, res) => {
            res.status(404).json({ error: 'Unknown Proteum connected-project route.' });
        });

        routes.all(`${connectedProjectProxyPathPrefix}/:namespace/*`, async (req, res, next) => {
            const parsed = parseConnectedProjectProxyPath(req.path);
            if (!parsed) {
                next();
                return;
            }

            const connectedProject = this.app.connectedProjects?.[parsed.namespace];
            if (!connectedProject) {
                res.status(404).json({ error: `Unknown connected project "${parsed.namespace}".` });
                return;
            }

            const search = new URL(req.originalUrl, 'http://proteum.local').search;
            const targetUrl = new URL(`${parsed.httpPath}${search}`, connectedProject.urlInternal).toString();
            const headers = new Headers();

            for (const [key, value] of Object.entries(req.headers)) {
                if (!value) continue;
                if (key === 'content-length' || key === 'host') continue;
                headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
            }

            if (!headers.has('accept')) headers.set('accept', 'application/json');

            const init: RequestInit = {
                method: req.method,
                headers,
            };

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                if (req.files && Object.keys(req.files).length > 0) {
                    res.status(501).json({
                        error: `Connected project proxy does not support multipart payloads for ${parsed.namespace} yet.`,
                    });
                    return;
                }

                const contentType = String(req.headers['content-type'] || '').toLowerCase();

                if (contentType.includes('application/json')) {
                    headers.set('content-type', 'application/json');
                    init.body = JSON.stringify(req.body || {});
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    headers.set('content-type', 'application/x-www-form-urlencoded');
                    init.body = new URLSearchParams(req.body as Record<string, string>).toString();
                } else {
                    headers.delete('content-type');
                    init.body = undefined;
                }
            }

            let response: Response;
            try {
                response = await fetch(targetUrl, init);
            } catch (error) {
                res.status(502).json({
                    error: `Failed to proxy connected request to ${connectedProject.namespace}. ${error instanceof Error ? error.message : String(error)}`,
                });
                return;
            }

            const traceRequestId = response.headers.get(profilerTraceRequestIdHeader);
            if (traceRequestId) res.setHeader(profilerTraceRequestIdHeader, traceRequestId);

            const setCookie = typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
                ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
                : [];
            if (setCookie.length > 0) {
                res.setHeader('set-cookie', setCookie);
            }

            const contentType = response.headers.get('content-type') || '';
            res.status(response.status);
            if (contentType) res.setHeader('content-type', contentType);

            if (contentType.includes('application/json')) {
                res.json(await response.json());
                return;
            }

            res.send(await response.text());
        });
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/

    public async start() {
        const routes = this.express;
        const routeRequest = this.router.middleware.bind(this.router);
        const apiOnly =
            (middleware: express.RequestHandler): express.RequestHandler =>
            (req, res, next) =>
                req.path === '/api' || req.path.startsWith('/api/') ? middleware(req, res, next) : next();
        const apiMultipartOnly =
            (middleware: express.RequestHandler): express.RequestHandler =>
            (req, res, next) =>
                (req.path === '/api' || req.path.startsWith('/api/')) && isMutipart(req)
                    ? middleware(req, res, next)
                    : next();

        /*----------------------------------
        - SECURITÉ DE BASE
        ----------------------------------*/

        // Config
        routes.set('trust proxy', 1); // Indique qu'on est sous le proxy apache
        /*----------------------------------
        - FAST PATH: API
        ----------------------------------*/

        // Keep /api requests off the heavier page middleware stack below.
        routes.use(apiOnly(hpp()));
        routes.use(apiOnly(cookieParser()));
        routes.use(apiOnly(express.json({ limit: bytes(this.config.upload.maxSize) })));
        routes.use(
            apiMultipartOnly(
                fileUpload({
                    debug: false,
                    limits: { fileSize: bytes(this.config.upload.maxSize), abortOnLimit: true },
                }),
            ),
        );
        routes.use(apiMultipartOnly(MiddlewareFormData));
        if (this.config.cors !== undefined) routes.use(apiOnly(cors(this.config.cors)));
        this.registerConnectedProjectRoutes(routes);
        routes.use(apiOnly(routeRequest));

        // Diverses protections (dont le disable x-powered-by)
        routes.use(helmet(this.config.helmet));

        /*----------------------------------
        - FICHIERS STATIQUES
        ----------------------------------*/

        // Fichiers statiques: Eviter un maximum de middlewares inutiles
        // Normalement, seulement utile pour le mode production,
        // Quand mode debug, les ressources client semblent servies par le dev middlewae
        // Sauf que les ressources serveur ne semblent pas trouvées par le dev-middleware
        const disablePublicAssetCaching = this.app.env.profile === 'dev';
        routes.use(compression());
        routes.use('/public', cors());
        routes.use(
            '/public',
            express.static(path.join(Container.path.root, APP_OUTPUT_DIR, 'public'), {
                dotfiles: 'deny',
                etag: !disablePublicAssetCaching,
                lastModified: !disablePublicAssetCaching,
                setHeaders: (res, filePath) => {
                    if (disablePublicAssetCaching) {
                        res.removeHeader('ETag');
                        res.removeHeader('Last-Modified');
                    }

                    res.setHeader(
                        'Cache-Control',
                        resolvePublicAssetCacheControl({
                            res,
                            filePath,
                            profile: this.app.env.profile,
                        }),
                    );
                },
            }),
            (req, res) => {
                res.status(404).send();
            },
        );

        routes.use('/robots.txt', express.static(path.resolve(__dirname, 'public/robots.txt')));

        routes.get('/ping', (req, res) => res.send('pong'));

        /*----------------------------------
        - SESSION & SECURITE
        ----------------------------------*/
        // https://expressjs.com/fr/advanced/best-practice-security.html
        // Protection contre la pollution des reuqtees http
        routes.use(hpp());

        // Init de req.cookies
        routes.use(cookieParser());

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
                    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
                },
            }),

            // Permet de receptionner les données multipart (req.body + req.files)
            // A mettre avant les services, car l'assignement de req.socket fait planter les uploads
            fileUpload({ debug: false, limits: { fileSize: bytes(this.config.upload.maxSize), abortOnLimit: true } }),

            // Décodage des requetes multipart
            // Peut-être requis par le résolver api
            MiddlewareFormData,
        );

        /*----------------------------------
        - PAGES / API
        ----------------------------------*/

        if (this.config.cors !== undefined) routes.use(cors(this.config.cors));

        routes.use(helmet.contentSecurityPolicy(createContentSecurityPolicy(this.config.csp)));

        this.registerDevTraceRoutes(routes);
        routes.use(routeRequest);

        /*----------------------------------
        - BOOT SERVICES
        ----------------------------------*/
        const verifiedConnectedProjects = await this.verifyConnectedProjectsBeforeStart();

        this.http.listen(this.config.port, () => {
            if (__DEV__ && typeof process.send === 'function') {
                process.send({
                    type: serverHotReloadMessageType.ready,
                    connectedProjects: verifiedConnectedProjects,
                    publicUrl: this.publicUrl,
                });
                return;
            }

            console.info(`Web server ready on ${this.publicUrl}`);
        });
    }

    public async cleanup() {
        this.http.close();
    }

    private registerDevTraceRoutes(routes: express.Express) {
        if (!__DEV__ || this.app.env.profile !== 'dev') return;

        if (this.app.container.Trace.isDevTraceEnabled()) {
            routes.get('/__proteum/trace/requests', (req, res) => {
                const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
                const parsedLimit = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : NaN;
                const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

                res.json({ requests: this.app.container.Trace.listRequests(limit) });
            });

            routes.get('/__proteum/trace/latest', (_req, res) => {
                const request = this.app.container.Trace.getLatestRequest();
                if (!request) {
                    res.status(404).json({ error: 'No request trace is available yet.' });
                    return;
                }

                res.json({ request });
            });

            routes.get('/__proteum/trace/requests/:id', (req, res) => {
                const request = this.app.container.Trace.getRequest(req.params.id);
                if (!request) {
                    res.status(404).json({ error: `Trace ${req.params.id} was not found.` });
                    return;
                }

                res.json({ request });
            });

            routes.post('/__proteum/trace/arm', (req, res) => {
                const rawCapture = typeof req.body.capture === 'string' ? req.body.capture : 'deep';
                const capture = this.app.container.Trace.armNextRequest(rawCapture);

                res.json({ armed: true, capture });
            });
        }

        routes.get('/__proteum/explain', (req, res) => {
            const rawSections = [
                ...(Array.isArray(req.query.section) ? req.query.section : req.query.section ? [req.query.section] : []),
                ...(Array.isArray(req.query.sections)
                    ? req.query.sections.flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
                    : typeof req.query.sections === 'string'
                      ? req.query.sections.split(',')
                      : []),
            ]
                .map((value) => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean);

            try {
                const diagnostics = this.app.getDevDiagnostics();
                const sections = diagnostics.normalizeExplainSections(rawSections);
                res.json(diagnostics.explain(sections));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const isBadRequest = explainSectionNames.some((sectionName) => message.includes(sectionName)) || message.includes('Unknown explain section');
                res.status(isBadRequest ? 400 : 500).json({ error: message });
            }
        });

        routes.get('/__proteum/explain/owner', (req, res) => {
            const query = Array.isArray(req.query.query) ? req.query.query[0] : req.query.query;

            try {
                res.json(this.app.getDevDiagnostics().explainOwner(typeof query === 'string' ? query : ''));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                res.status(message.includes('required') ? 400 : 500).json({ error: message });
            }
        });

        routes.get('/__proteum/doctor', (req, res) => {
            const rawStrict = Array.isArray(req.query.strict) ? req.query.strict[0] : req.query.strict;
            const strict = rawStrict === '1' || rawStrict === 'true';

            try {
                res.json(this.app.getDevDiagnostics().doctor(strict));
            } catch (error) {
                res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.get('/__proteum/doctor/contracts', (req, res) => {
            const rawStrict = Array.isArray(req.query.strict) ? req.query.strict[0] : req.query.strict;
            const strict = rawStrict === '1' || rawStrict === 'true';

            try {
                res.json(this.app.getDevDiagnostics().doctorContracts(strict));
            } catch (error) {
                res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.get('/__proteum/logs', (req, res) => {
            const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
            const rawLevel = Array.isArray(req.query.level) ? req.query.level[0] : req.query.level;
            const limit = Math.max(0, Math.min(500, Number(rawLimit) || 100));
            const level = typeof rawLevel === 'string' ? (rawLevel as TDevConsoleLogLevel) : 'log';

            try {
                res.json(this.app.getDevDiagnostics().readLogs(limit, level));
            } catch (error) {
                res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.get('/__proteum/diagnose', (req, res) => {
            const readString = (value: unknown) => (Array.isArray(value) ? value[0] : value);
            const readNumber = (value: unknown, fallback: number) => {
                const parsed = Number(readString(value));
                return Number.isFinite(parsed) ? parsed : fallback;
            };

            try {
                res.json(
                    this.app.getDevDiagnostics().diagnose({
                        logsLevel:
                            typeof readString(req.query.logsLevel) === 'string'
                                ? (readString(req.query.logsLevel) as TDevConsoleLogLevel)
                                : 'warn',
                        logsLimit: readNumber(req.query.logsLimit, 40),
                        path: typeof readString(req.query.path) === 'string' ? readString(req.query.path) : undefined,
                        query: typeof readString(req.query.query) === 'string' ? readString(req.query.query) : undefined,
                        requestId: typeof readString(req.query.requestId) === 'string' ? readString(req.query.requestId) : undefined,
                        strict: readString(req.query.strict) === '1' || readString(req.query.strict) === 'true',
                    }),
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                res.status(message.includes('required') || message.includes('Diagnose requires') ? 400 : 500).json({ error: message });
            }
        });

        routes.get('/__proteum/perf/top', (req, res) => {
            const readString = (value: unknown) => (Array.isArray(value) ? value[0] : value);
            const readNumber = (value: unknown, fallback: number) => {
                const parsed = Number(readString(value));
                return Number.isFinite(parsed) ? parsed : fallback;
            };

            try {
                res.json(
                    this.app.getDevDiagnostics().perfTop({
                        groupBy: typeof readString(req.query.groupBy) === 'string' ? (readString(req.query.groupBy) as TPerfGroupBy) : undefined,
                        limit: readNumber(req.query.limit, 12),
                        since: typeof readString(req.query.since) === 'string' ? readString(req.query.since) : undefined,
                    }),
                );
            } catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.get('/__proteum/perf/compare', (req, res) => {
            const readString = (value: unknown) => (Array.isArray(value) ? value[0] : value);
            const readNumber = (value: unknown, fallback: number) => {
                const parsed = Number(readString(value));
                return Number.isFinite(parsed) ? parsed : fallback;
            };

            try {
                res.json(
                    this.app.getDevDiagnostics().perfCompare({
                        baseline: typeof readString(req.query.baseline) === 'string' ? readString(req.query.baseline) : undefined,
                        groupBy: typeof readString(req.query.groupBy) === 'string' ? (readString(req.query.groupBy) as TPerfGroupBy) : undefined,
                        limit: readNumber(req.query.limit, 12),
                        target: typeof readString(req.query.target) === 'string' ? readString(req.query.target) : undefined,
                    }),
                );
            } catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.get('/__proteum/perf/memory', (req, res) => {
            const readString = (value: unknown) => (Array.isArray(value) ? value[0] : value);
            const readNumber = (value: unknown, fallback: number) => {
                const parsed = Number(readString(value));
                return Number.isFinite(parsed) ? parsed : fallback;
            };

            try {
                res.json(
                    this.app.getDevDiagnostics().perfMemory({
                        groupBy: typeof readString(req.query.groupBy) === 'string' ? (readString(req.query.groupBy) as TPerfGroupBy) : undefined,
                        limit: readNumber(req.query.limit, 12),
                        since: typeof readString(req.query.since) === 'string' ? readString(req.query.since) : undefined,
                    }),
                );
            } catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.get('/__proteum/perf/request', (req, res) => {
            const query = Array.isArray(req.query.query) ? req.query.query[0] : req.query.query;

            try {
                res.json(this.app.getDevDiagnostics().perfRequest(typeof query === 'string' ? query : ''));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                res.status(message.includes('Could not find') || message.includes('required') ? 404 : 400).json({ error: message });
            }
        });

        routes.get('/__proteum/cron/tasks', (_req, res) => {
            const cron = this.getCronManager();
            res.json({
                automaticExecution: cron?.isAutomaticExecutionEnabled() ?? false,
                tasks: cron?.listTasks() ?? [],
            });
        });

        routes.get('/__proteum/commands', (_req, res) => {
            res.json({ commands: this.app.getDevCommands().list() });
        });

        routes.post('/__proteum/commands/run', async (req, res) => {
            const commandPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
            if (!commandPath) {
                res.status(400).json({ error: 'Command path is required.' });
                return;
            }

            try {
                const execution = await this.app.getDevCommands().run(commandPath);
                res.json({ execution });
            } catch (error) {
                const execution =
                    error instanceof Error && 'execution' in error && typeof error.execution === 'object'
                        ? error.execution
                        : undefined;
                const statusCode = error instanceof Error && error.name === 'NotFound' ? 404 : 500;

                res.status(statusCode).json({
                    error: error instanceof Error ? error.message : String(error),
                    execution,
                });
            }
        });

        routes.post('/__proteum/session/start', async (req, res) => {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
            const requiredRole = typeof req.body?.role === 'string' ? req.body.role.trim() : '';

            if (!email) {
                res.status(400).json({ error: 'Email is required.' });
                return;
            }

            try {
                const auth = this.resolveDevSessionAuthService();
                const user = await auth.decodeSession({ email }, req);

                if (!user) {
                    res.status(404).json({ error: `No user could be resolved for "${email}".` });
                    return;
                }

                if (requiredRole && !user.roles.includes(requiredRole)) {
                    res.status(403).json({ error: `User "${email}" does not have required role "${requiredRole}".` });
                    return;
                }

                const token = auth.createSession(
                    { email },
                    {
                        id: `proteum-session:${Date.now()}`,
                        res,
                    },
                );
                const issuedAt = new Date().toISOString();
                const expiresAt = new Date(Date.now() + auth.config.jwt.expiration).toISOString();
                const response: TDevSessionStartResponse = {
                    user: this.summarizeDevSessionUser(user),
                    session: {
                        token,
                        cookieName: 'authorization',
                        expiresInMs: auth.config.jwt.expiration,
                        issuedAt,
                        expiresAt,
                    },
                };

                res.json(response);
            } catch (error) {
                res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });

        routes.post('/__proteum/cron/tasks/run', async (req, res) => {
            const cron = this.getCronManager();
            if (!cron) {
                res.status(404).json({ error: 'Cron service is not registered for this app.' });
                return;
            }

            const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            if (!name) {
                res.status(400).json({ error: 'Cron task name is required.' });
                return;
            }

            let task: CronTask;
            try {
                task = cron.get(name);
            } catch (error) {
                res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
                return;
            }

            try {
                await cron.exec(name);
                res.json({ task: task.toProfilerTask() });
            } catch (error) {
                res.status(500).json({
                    error: error instanceof Error ? error.message : String(error),
                    task: task.toProfilerTask(),
                });
            }
        });
    }

    private getCronManager() {
        return (this.app as typeof this.app & { Cron?: CronManager }).Cron;
    }
}
