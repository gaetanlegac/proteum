/*----------------------------------
- DEPENDANCES
----------------------------------*/

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

/*----------------------------------
- CONSTANTS
----------------------------------*/

const brotliCompress = promisify(zlib.brotliCompress);

/** Text files the router may answer with a `.br` twin. Pictures, fonts and videos are compressed already. */
export const precompressedExtensions = ['.js', '.css', '.svg', '.json'];

export const brotliTwinExtension = '.br';

export type TPrecompressReport = {
    written: number;
    // Files whose Brotli copy was not smaller: served as they are.
    skipped: number;
    bytesBefore: number;
    bytesAfter: number;
};

/*----------------------------------
- HELPERS
----------------------------------*/

/** Every regular file under `directory`. Symlinks are left alone: in dev they point into the app's own `public/`. */
const listFiles = async (directory: string): Promise<string[]> => {
    if (!(await fs.stat(directory).catch(() => undefined))?.isDirectory()) return [];

    const files: string[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
        else if (entry.isFile()) files.push(entryPath);
    }

    return files;
};

export const shouldPrecompress = (filepath: string) =>
    precompressedExtensions.includes(path.extname(filepath).toLowerCase());

/*----------------------------------
- PRECOMPRESS
----------------------------------*/

/**
 * Writes a Brotli 11 twin (`client.1a2b3c4d.js.br`) beside each text file of the production `public/`,
 * which `express-static-gzip` serves to clients that accept `br` (server/services/router/http/index.ts).
 * Cloudflare compresses at level 4 on the fly; level 11 saves another 13 to 22% on JS and CSS, too slow
 * to run per request. A twin that is not smaller than its file is not written.
 *
 * Node's own zlib does the work: the npm candidates either see only the bundler's assets
 * (compression-webpack-plugin misses the files copied from the app's `public/` and the identity
 * assets) or are command-line tools.
 */
export const precompressPublicAssets = async (publicDirectory: string): Promise<TPrecompressReport> => {
    const files = (await listFiles(publicDirectory)).filter(shouldPrecompress);
    const report: TPrecompressReport = { written: 0, skipped: 0, bytesBefore: 0, bytesAfter: 0 };
    let next = 0;

    const work = async () => {
        while (next < files.length) {
            const filepath = files[next++];
            const twinPath = filepath + brotliTwinExtension;
            const content = await fs.readFile(filepath);
            const compressed = await brotliCompress(content, {
                params: {
                    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                    [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length,
                },
            });

            if (compressed.length >= content.length) {
                await fs.rm(twinPath, { force: true });
                report.skipped++;
                continue;
            }

            await fs.writeFile(twinPath, compressed);
            report.written++;
            report.bytesBefore += content.length;
            report.bytesAfter += compressed.length;
        }
    };

    // zlib runs on libuv's pool; one reader per core keeps it busy without holding every file in memory.
    const concurrency = Math.max(1, Math.min(files.length, os.availableParallelism?.() || os.cpus().length));
    await Promise.all(Array.from({ length: concurrency }, work));

    return report;
};
