/*----------------------------------
- DEPENDANCES
----------------------------------*/

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';

/*----------------------------------
- CONSTANTS
----------------------------------*/

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

/**
 * Every regular file under `directory`, without recursion (a folder of icons can hold tens of thousands).
 * Symlinks are not followed: the production build copies the app's public files, and a link in them is
 * the app's own business.
 */
const listFiles = async (directory: string): Promise<string[]> => {
    const files: string[] = [];
    const directories = [directory];

    while (directories.length > 0) {
        const current = directories.pop() as string;
        const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);

        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) directories.push(entryPath);
            else if (entry.isFile()) files.push(entryPath);
        }
    }

    return files;
};

export const shouldPrecompress = (filepath: string) =>
    precompressedExtensions.includes(path.extname(filepath).toLowerCase());

/*----------------------------------
- WORKER
----------------------------------*/

// Runs in each worker thread: Brotli 11 on its share of the files, one at a time, then reports its totals.
const workerSource = `
const fs = require('fs');
const zlib = require('zlib');
const { parentPort, workerData } = require('worker_threads');
const report = { written: 0, skipped: 0, bytesBefore: 0, bytesAfter: 0 };
for (const filepath of workerData.files) {
    const content = fs.readFileSync(filepath);
    const compressed = zlib.brotliCompressSync(content, {
        params: {
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
            [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length,
        },
    });
    const twinPath = filepath + workerData.twinExtension;
    if (compressed.length >= content.length) {
        fs.rmSync(twinPath, { force: true });
        report.skipped++;
        continue;
    }
    fs.writeFileSync(twinPath, compressed);
    report.written++;
    report.bytesBefore += content.length;
    report.bytesAfter += compressed.length;
}
parentPort.postMessage(report);
`;

const runWorker = (files: string[]) =>
    new Promise<TPrecompressReport>((resolve, reject) => {
        const worker = new Worker(workerSource, { eval: true, workerData: { files, twinExtension: brotliTwinExtension } });
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`Brotli worker exited with code ${code}.`));
        });
    });

/*----------------------------------
- PRECOMPRESS
----------------------------------*/

/**
 * Writes a Brotli 11 twin (`client.1a2b3c4d.js.br`) beside each text file of the production `public/`,
 * which the router serves to clients that accept `br` (server/services/router/http/precompressed.ts).
 * Cloudflare compresses at level 4 on the fly; level 11 saves another 13 to 22% on the website's JS and
 * CSS, too slow to run per request. A twin that is not smaller than its file is not written.
 *
 * Node's own zlib does the work, one worker thread per core: level 11 costs about 3 ms even for a small
 * file, and zlib's async calls share libuv's 4 threads (34 s for Product's 12,500 icons; 7 s for 12,500
 * small SVGs with one worker per core on a 10-core machine). No npm package fits: compression-webpack-plugin sees only the bundler's assets (not the
 * files copied from the app's `public/`), and the others are command-line tools.
 */
export const precompressPublicAssets = async (publicDirectory: string): Promise<TPrecompressReport> => {
    const files = (await listFiles(publicDirectory)).filter(shouldPrecompress);
    const report: TPrecompressReport = { written: 0, skipped: 0, bytesBefore: 0, bytesAfter: 0 };
    if (files.length === 0) return report;

    // Dealt round-robin, so each worker gets a mix of large and small files.
    const workerCount = Math.max(1, Math.min(os.availableParallelism?.() || os.cpus().length, Math.ceil(files.length / 16)));
    const shares: string[][] = Array.from({ length: workerCount }, () => []);
    files.forEach((file, index) => shares[index % workerCount].push(file));

    for (const share of await Promise.all(shares.map(runWorker))) {
        report.written += share.written;
        report.skipped += share.skipped;
        report.bytesBefore += share.bytesBefore;
        report.bytesAfter += share.bytesAfter;
    }

    return report;
};

/*----------------------------------
- END OF A PRODUCTION BUILD
----------------------------------*/

/**
 * What `proteum build` does once the bundles are written: fail on a declared font it could not preload, wait
 * for the identity assets, then write the Brotli twins of `<output>/public`.
 */
export const finishProductionBuild = async ({
    outputPath,
    preloadFontErrors,
    waitForIdentityAssets,
}: {
    outputPath: string;
    preloadFontErrors?: string;
    waitForIdentityAssets: () => Promise<void>;
}) => {
    if (preloadFontErrors) throw new Error(preloadFontErrors);

    await waitForIdentityAssets();
    return await precompressPublicAssets(path.join(outputPath, 'public'));
};
