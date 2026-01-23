// Source: https://github.com/binance-exchange/binance-websocket-examples/blob/master/src/lib/socketClient.js
// Exmeple utilisation: https://github.com/binance-exchange/binance-websocket-examples/blob/master/src/monitor-spot.js

import WebSocket from 'ws';

type THandler = (message: any) => void;

class SocketClient {

    private url: string;

    private ws!: WebSocket;
    private handlers: THandler[] = [];

    constructor(url: string) {
        this.url = url;
    }

    private log = (...args: any[]) => console.log('[socket][client]['+ this.url +']', ...args);

    public connecter(): Promise<this> {
        return new Promise((resolve, reject) => {

            this.log('Connexion');

            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                this.log('Connecté.');

                resolve(this);
            };

            this.ws.onmessage = (msg) => {
                try {
                    const message = JSON.parse(msg.data);
                    for (const handler of this.handlers)
                        handler(message);
                } catch (e) {
                    this.log('Parse message failed', e);
                }
            };

            this.ws.onerror = (err) => {
                this.log('Erreur', err);

                reject(err);
            };

            this.ws.onclose = (e) => {
                this.log('Fermé', e.reason);
            };

            this.ws.on('pong', () => {
                this.log('Le serveur a envoyé pong');
            });

            this.ws.on('ping', () => {
                if (this.ws.readyState === WebSocket.OPEN)
                    this.ws.pong();
            });

            //this.heartBeat();
            
        })
    }

    /*public heartBeat() {
        setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
                this.log("Ping serveur");
            }
        }, 5000);
    }*/

    public send(data: object) {
        this.ws.send( JSON.stringify(data) );
        return this;
    }

    public handle(handler: THandler) {
        this.handlers.push(handler);
        return this;
    }

    public close() {
        this.ws.close();
    }
}

export default SocketClient;