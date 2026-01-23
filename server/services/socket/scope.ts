/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import ws from 'ws';
import type { IncomingMessage } from 'http';

// Core
import type SocketService from '.';
import context from '@server/context';

/*----------------------------------
- TYPES
----------------------------------*/

export type WebSocket = ws & {
    ip: string,
    id: string,
    username: string,
    activity: number | false,
    disconnect: (reason: string) => void
}

type TConnectCallback = (client: WebSocket, req: IncomingMessage) => Promise<void | false>;

type TEventCallback = (data: any, socket: WebSocket) => Promise<void>

type TCommands = { [command: string]: TEventCallback }

const activityDelay = 10 * 1000; // Clearn broken connections veery 10s

/*----------------------------------
- SCOPE
----------------------------------*/
export default class SocketScope<TUser extends {}> {

    private connectEvent?: TConnectCallback;
    private disconnectEvent?: TConnectCallback;
    public commands: TCommands = {};
    public users: { [username: string]: WebSocket[] } = {}

    public constructor(
        public path: string,
        private socket: SocketService<TUser>,
        private app = socket.app
    ) {

    }

    private cleaner = setInterval(() => {
        const now = Date.now();
        for (const username in this.users) {
            for (const socket of this.users[username]) {
                
                // If the client did not sent any rsponse to the ping
                if (socket.activity === false) {
                    
                    // We consider it as a dead connection (discnnected, but no terminate packet was sent. Ex: internet disabled)
                    console.log(this.path + ':', username, socket.ip, socket.id, "is dead");
                    socket.terminate();

                // If user has not been active since x seconds
                } else if (socket.activity < now - activityDelay) {

                    // We consider hil a dead, until he responds to a ping
                    socket.activity = false;
                    socket.ping();

                }
            }
        }
    }, activityDelay);

    public newClient(socket: WebSocket, req: IncomingMessage) {
        context.run({ channelType: 'socket', channelId: this.path }, async () => {

        // Auth
        const username = await this.socket.config.users.decode(req);
        if (!username) {
            console.log(`Rejecting connection on ${this.path} for client ${socket.ip} (${socket.id})}: Not authenticated`);
            socket.close(4004, "auth");
            return;
        }

        socket.username = username;
        socket.disconnect = (reason: string) => socket.close(4004, reason);

        // On connect event
        if (this.connectEvent && await this.connectEvent(socket, req) === false) {
            return;
        }

        // Indexage
        if (this.users[username] === undefined) {
            this.users[username] = [socket];
        } else {
            this.users[username].push(socket);
        }

        console.log(`Client ${socket.username} (${socket.ip}) connected on ${this.path}. Connections number for this user: ` + this.users[username].length);
        // Indique au cient que sa connexion a bien été acceptée
        socket.send("ok>ok")

        // Détection déconnexion
        socket.activity = Date.now();
        socket.on('pong', () => {
            socket.activity = Date.now();
        });

        // Ecoute résolution des challenges
        socket.on('message', (m: ws.Data) => {

            const response = m.toString();
            var i = response.indexOf('>');
            if (i === -1) {
                return console.warn(`Bad data structure:`, response.substring(0, 100) + '...');
            }

            const command = response.slice(0, i);
            const strData = response.slice(i + 1);

            let data;
            try {
                data = JSON.parse(strData);
            } catch (error) {
                console.warn(`Error decoding data`, error);
                this.send(socket.username, 'log', `Invalid data format.`);
                return;
            }

            const handler = this.commands[command];
            if (handler === undefined)
                return console.error('Command « ' + command + ' » does not exists.');

            socket.activity = Date.now();

            handler(data, socket);


        });

        socket.on('close', () => {

            if (this.users[username].length > 1)
                this.users[username] = this.users[username].filter(s => s.id !== socket.id);
            else
                this.users[username] = [];

            console.log(`Client ${socket.ip} (${socket.id}) disconnected from ${this.path}. Connections number for this user: ` + this.users[username].length);

            if (this.disconnectEvent !== undefined)
                this.disconnectEvent(socket, req);

        });
    });
    }

    public isConnected(username: string) {
        return this.users[username] !== undefined && this.users[username].length !== 0;
    }

    public send(usernames: string | string[], command: string, data: any = true) {

        if (usernames === '*')
            usernames = Object.keys(this.users);
        else if (!Array.isArray(usernames))
            usernames = [usernames];

        for (const username of usernames) {

            const user = this.users[username];
            if (user === undefined)
                return console.warn("User", username, "is not connected to", this.path);

            for (const client of user) {
                client.send(command + '>' + JSON.stringify(data));
            }

            console.log("Sent event " + command + " to " + username + " on " + this.path)

        }
    }

    public disconnect(usernames: string | string[], reason: string, data?: any) {

        if (usernames === '*')
            usernames = Object.keys(this.users);
        else if (!Array.isArray(usernames))
            usernames = [usernames];

        for (const username of usernames) {

            const user = this.users[username];
            if (user === undefined)
                return console.warn("User", username, "is not connected to", this.path);

            for (const client of user) {
                client.disconnect(reason);
            }

            console.log("Disconnected " + username + " from " + this.path + " fo the following reason: " + reason)

        }
    }

    public onConnect(cb: TConnectCallback) {
        this.connectEvent = cb;
        return this;
    }

    public on(event: string, cb: TEventCallback) {
        this.commands[event] = cb;
        return this;
    }

    public onDisconnect(cb: TConnectCallback) {
        this.disconnectEvent = cb;
        return this;
    }

    public close() {
        clearInterval(this.cleaner);
    }

}