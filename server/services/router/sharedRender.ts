/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type express from 'express';

/*----------------------------------
- LOOPBACK
----------------------------------*/

/** True for a connection from this machine: the router's own renders and an app's loopback renderer. */
export const isLoopbackAddress = (address: string | undefined) =>
    typeof address === 'string' && /^(127\.|::1$|::ffff:127\.)/.test(address);

/**
 * `bypasscache` (render instead of answering the stored copy) is honoured only on a loopback connection.
 * The socket's own address, never `req.ip`: under `trust proxy` that one comes from `X-Forwarded-For`.
 */
export const acceptsCacheBypass = (req: Pick<express.Request, 'headers' | 'socket'>) =>
    Boolean(req.headers['bypasscache']) && isLoopbackAddress(req.socket?.remoteAddress);

/**
 * The request the router sends itself to render a stored page: over loopback, so no CDN or other instance
 * answers it, with the public host and protocol, so the page's canonical and absolute URLs are the public
 * ones. The same headers as an app's own loopback renderer (the website's `buildInternalSelfRenderRequest`).
 */
export const buildStaticSelfRenderRequest = ({ port, currentDomain, path }: { port: number; currentDomain: string; path: string }) => {
    const publicUrl = new URL(currentDomain);

    return {
        url: new URL(path, `http://127.0.0.1:${port}`).toString(),
        headers: {
            host: publicUrl.host,
            'x-forwarded-host': publicUrl.host,
            'x-forwarded-proto': publicUrl.protocol.replace(':', ''),
            accept: 'text/html',
            bypasscache: '1',
            'x-proteum-static-warmup': '1',
        },
    };
};

/*----------------------------------
- WHAT THE PAGE CACHE STORES
----------------------------------*/

type TSharedRenderRequest = Pick<express.Request, 'method' | 'originalUrl' | 'protocol' | 'hostname' | 'body'> & {
    get(name: string): string | undefined;
    files?: unknown;
};

/**
 * True when a render may become every visitor's copy of its path. The stored page carries what its request
 * put in it (`window.ssr.request.data`, the canonical and `og:url`), and the cache key is the path alone, so
 * only a request with nothing of its own is kept: a GET, no signed-in user, no query string at all (`?=x`
 * included), no body and no file, on the app's own protocol and host (a forged `Host` or `X-Forwarded-Host`
 * would go into the canonical).
 */
export const isSharedPageRender = (
    req: TSharedRenderRequest,
    { signedIn, currentDomain }: { signedIn: boolean; currentDomain: string },
) => {
    if (req.method !== 'GET' || signedIn) return false;
    if (req.originalUrl.includes('?')) return false;

    const body = req.body;
    if (body !== undefined && body !== null && (typeof body !== 'object' || Object.keys(body).length > 0)) return false;
    if (req.files !== undefined && req.files !== null && Object.keys(req.files as object).length > 0) return false;

    const own = new URL(currentDomain);
    return `${req.protocol}:` === own.protocol && req.get('host') === own.host && req.hostname === own.hostname;
};
