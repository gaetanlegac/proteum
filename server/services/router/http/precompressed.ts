/*----------------------------------
- DEPENDANCES
----------------------------------*/

import fs from 'fs';
import path from 'path';
import accepts from 'accepts';
import express from 'express';

/*----------------------------------
- CONSTANTS
----------------------------------*/

// The twin `proteum build` writes beside a file (cli/compiler/common/precompress.ts).
const brotliTwinExtension = '.br';

// Express 4's own type table, so a twin answers the type its file would (`application/javascript; charset=UTF-8`).
const mime = (express.static as unknown as { mime: { lookup(file: string): string; charsets: { lookup(type: string): string | undefined } } })
    .mime;

/*----------------------------------
- TWINS
----------------------------------*/

/**
 * The public paths (`/client.1a2b3c4d.js`) that have a `.br` twin under `root`. Read once when the server
 * starts: the build writes the twins before. Links are not followed and an unreadable folder is skipped,
 * so a broken entry in `public/` never stops the boot.
 */
export const listBrotliTwins = (root: string) => {
    const twins = new Set<string>();
    const directories = [''];

    while (directories.length > 0) {
        const relative = directories.pop() as string;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const entryPath = relative + '/' + entry.name;
            if (entry.isDirectory()) directories.push(entryPath);
            else if (entry.isFile() && entry.name.endsWith(brotliTwinExtension))
                twins.add(entryPath.slice(0, -brotliTwinExtension.length));
        }
    }

    return twins;
};

/** True when the request accepts `br`. Parameter and coding names are case-insensitive (RFC 9110). */
const acceptsBrotli = (req: express.Request) => {
    const header = req.headers['accept-encoding'];
    if (typeof header !== 'string' || header === '') return false;

    return accepts({ headers: { 'accept-encoding': header.toLowerCase() } } as any).encoding(['br']) === 'br';
};

/*----------------------------------
- MIDDLEWARE
----------------------------------*/

/**
 * `express.static` for `/public`, plus the Brotli 11 twins: a GET or HEAD for a file that has one, from a
 * client that accepts `br`, is answered with the twin (`Content-Encoding: br`, the file's own type, and its
 * cache policy through `setHeaders`). Every response for a file with a twin carries `Vary: Accept-Encoding`.
 * When the twin cannot be served, the request goes on as it came, without the encoding headers.
 *
 * Custom rather than `express-static-gzip`: that package (2.x and 3.x) answers a malformed URL with a 400,
 * leaves `Content-Encoding: br` on the 404 of a missing twin or a POST, keys twins by the first `.br` of a
 * path (`jquery.browser.min.js` never gets its twin), serves `br;q=0` clients, turns any `.gz` file into an
 * encoding of its neighbour, and stops the boot on a broken link, as its own `fs.statSync` walk follows it.
 */
export const createPublicStaticHandler = (
    root: string,
    options: Parameters<typeof express.static>[1],
    { precompressed }: { precompressed: boolean },
): express.RequestHandler => {
    const serveStatic = express.static(root, options);
    const twins = precompressed ? listBrotliTwins(root) : new Set<string>();

    return (req, res, next) => {
        if (twins.size === 0 || (req.method !== 'GET' && req.method !== 'HEAD')) return serveStatic(req, res, next);

        let filePath: string;
        try {
            filePath = decodeURIComponent(req.path);
        } catch {
            return serveStatic(req, res, next);
        }
        if (!twins.has(filePath)) return serveStatic(req, res, next);

        res.vary('Accept-Encoding');
        if (!acceptsBrotli(req)) return serveStatic(req, res, next);

        const originalUrl = req.url;
        const queryIndex = originalUrl.indexOf('?');
        req.url =
            queryIndex === -1
                ? originalUrl + brotliTwinExtension
                : originalUrl.slice(0, queryIndex) + brotliTwinExtension + originalUrl.slice(queryIndex);

        const type = mime.lookup(filePath);
        const charset = mime.charsets.lookup(type);
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));

        serveStatic(req, res, (error?: unknown) => {
            // The twin was removed after the server started: the request goes on as it came.
            req.url = originalUrl;
            res.removeHeader('Content-Encoding');
            res.removeHeader('Content-Type');
            next(error);
        });
    };
};
