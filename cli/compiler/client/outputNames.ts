/*----------------------------------
- CLIENT OUTPUT NAMES
----------------------------------*/

export type TClientOutputNames = {
    // Entry files: `runtime`, `framework`, `vendors`, `client`
    entry: string;
    // Async JS chunks
    chunk: string;
    // Entry and page CSS
    css: string;
};

/*
 * Production files carry a content hash, entries included. An unhashed `runtime.js` that a
 * browser or CDN keeps after a deploy still maps chunk ids to files that no longer exist
 * (21 Oct 2026: a 4 h CDN browser TTL served the old runtime, its chunks 404ed). The same holds
 * for CSS: a page chunk keeps its name across builds, so new HTML could pair with a stylesheet
 * from the previous build. The HTML reads every name from `client-manifest.json`, so nothing
 * names these files, and the router's public cache classifies `name.<hash>.ext` as versioned.
 *
 * Dev keeps stable names: HMR and the dev middleware rely on them, and dev serves `no-store`.
 * `[name]` stays before the hash so the network panel and bundle analysis stay readable.
 */
export const getClientOutputNames = (dev: boolean): TClientOutputNames =>
    dev
        ? { entry: '[name].js', chunk: '[name].js', css: '[name].css' }
        : { entry: '[name].[contenthash:8].js', chunk: '[id].[contenthash:8].js', css: '[name].[contenthash:8].css' };
