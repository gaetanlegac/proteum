/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import { Server as WebSocketServer, ServerOptions } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { IncomingMessage } from 'http';
import cookie from 'cookie';

// Core
import type { Application } from '@server/app';
import Service, { AnyService, TRegisteredService } from '@server/app/service';
import SocketScope, { WebSocket } from './scope';
import type Router from '@server/services/router';
export type { WebSocket, default as SocketScope } from './scope';
import type UsersManagementService from '../auth';

/*----------------------------------
- TYPES
----------------------------------*/


export type Config<TUser extends {}> = {
    debug?: boolean,
    //server: ServerOptions["server"],
    //users: UsersManagementService<TUser>,
    port: number,

    users: UsersManagementService<TUser, Application>,
    router: Router
}

export type Hooks = {

}

/*----------------------------------
- MANAGER
----------------------------------*/
export default class WebSocketCommander<
    TUser extends {},
    TConfig extends Config<TUser>= Config<TUser>
> extends Service<TConfig, Hooks, Application> {

    // Services
    public ws!: WebSocketServer;
    public users!: TConfig["users"];
    public router!: TConfig["router"];

    // Context
    public scopes: {[path: string]: SocketScope<TUser>} = {}

    public constructor(
        parent: AnyService, 
        config: TConfig,
        app: TApplication, 
    ) {
        super(parent, config, app);
        
        this.users = this.config.users;
        this.router = this.config.router;
        
    }
    
    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public loading: Promise<void> | undefined = undefined;
    protected async ready() {

        this.users.on('disconnect', async (userId: string) => {
            this.disconnect(userId, 'Logout');
        });

        console.info(`Loading socket commander`);
        this.ws = new WebSocketServer({ server: this.router.http.http })
            .on('connection', (socket: WebSocket, req: IncomingMessage) => {

                // Resolve scope
                const path = req.url;
                let scope: SocketScope<TUser> | undefined;
                for (const scopePath in this.scopes)
                    if (path === scopePath) {
                        scope = this.scopes[path];
                        break;
                    }

                if (scope === undefined) {
                    console.warn("Unknown scope path:", path);
                    socket.close();
                    return;
                }

                socket.id = uuidv4();

                // req.headers['x-forwarded-for'] = IP réelle du client quand on passe par un porxy apache
                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                if (typeof ip !== 'string') {
                    console.warn("Invalid IP address", ip);
                    socket.close();
                    return;
                }
                socket.ip = ip;

                // Cookies
                if (req.headers.cookie) {
                    req.cookies = cookie.parse(req.headers.cookie);
                }

                scope.newClient(socket, req);

            })

        console.info(`Socket commander bound to http server.`);
    }

    public async shutdown() {
        this.closeAll();
    }

	/*----------------------------------
    - ACTIONS
    ----------------------------------*/

    public open(path: string) {

        if (!(path in this.scopes)) {

            console.info("Registering socket scope:", path);
            this.scopes[path] = new SocketScope(path, this);

        }

        return this.scopes[path];

    }


    public send(scopename: string, usernames: string | string[], command: string, data?: any) {

        const scope = this.scopes[scopename];
        if (scope === undefined)
            return console.warn("No scope with name", scopename);

        scope.send(usernames, command, data);

    }

    public disconnect( usernames: string | string[], reason: string, data?: any ) {
        console.log(`Disconnecting ${usernames} from all scopes`);
        for (const path in this.scopes)
            this.scopes[path].disconnect( usernames, reason );
    }

    public closeAll() {
        console.log("Closing All connections");
        for (const path in this.scopes)
            this.scopes[path].close();
    }
}