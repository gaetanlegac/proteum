/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type { ClientContext } from '../../context';

import type { TDialogControls } from '@client/components/Dialog/Manager';

/*----------------------------------
- TYPE
----------------------------------*/

type TEventsList = {[name: string]: TEventCallback[]};

type TEventCallback = (data: any) => void

let netwokrStatusToast: TDialogControls;

/*----------------------------------
- SERVICE
----------------------------------*/
class SocketScope {

    public ws?: WebSocket;
    public events: TEventsList = {}

    public constructor( 
        public path: string, 
        public context: ClientContext, 
        events: {[name: string]: TEventCallback} = {} 
    ) {
        this.connect();

        for (const event in events)
            this.events[event] = [events[event]];
    }
    
    private connect() {
        
        const protocol = window.location.protocol === 'http:' ? 'ws:' : 'wss:';
        const url = protocol + '//' + this.context.request.host + this.path;

        try {
            this.ws = new WebSocket(url);
        } catch (error) {
            console.warn(`[socket] Connection failed for ${url}`, error);
            return;
        }

        this.ws.onopen = () => {
            console.log(`[socket] Connected to the live data provider:`, url);

            if (netwokrStatusToast) {
                netwokrStatusToast.close(true);
                this.context.toast.success("Your connection has been restored", null, null, {
                    autohide: 3
                });
            }
        }

        this.ws.onmessage = (event: MessageEvent<any>) => {

            const [name, rawData] = event.data.split('>');
            if (this.events[name] === undefined) {
                console.warn("Unknown command: " + name + `. Raw command:`, event.data);
                return;
            }

            let data;
            try {
                data = JSON.parse(rawData);
            } catch (error) {
                console.warn(`[socket] Error decoding data`, rawData, error);
                return;
            }

            for (const callback of this.events[name])
                callback(data);

        }

        this.ws.onerror = (event) => {
            console.log(`[socket] Network error for ${url}`, event);
            this.close();
        }

        this.ws.onclose = (event) => {

            // Fermeture volontaire = on ne retente pas de se connecter
            if (event.wasClean) {
                console.log(`[socket] Disconnected from ${url}. Reason: `, event.reason);
                return;
            }

            if (!netwokrStatusToast)
                netwokrStatusToast = this.context.toast.error("You're offline", "Please check your connection", null, {
                    autohide: false, 
                    prison: true
                });
            console.log(`[socket] Disconnected from ${url}. Retry in 5 seconds ...`, event);
            setTimeout(() => this.connect(), 5000);
        }

    }

    public close() {
        if (this.ws)
            this.ws.close();
    }

    public on(event: string, callback: TEventCallback) {

        if (this.events[event] === undefined)
            this.events[event] = [callback]
        else
            this.events[event].push(callback)

        return this;
    }

    public off(event: string) {

        delete this.events[event];

        return this;
    }

}

export default class SocketClient {

    public scopes: { [name: string]: SocketScope } = {}

    public constructor( public context: ClientContext ) {

        
    }

    public open(path: string, commands: {[name: string]: TEventCallback} = {}) {

        if (!(path in this.scopes))
            this.scopes[path] = new SocketScope(path, this.context, commands);

        return this.scopes[path]
    }

}