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

/*----------------------------------
- SOURCE MAPS
----------------------------------*/

export type TClientSourceMapsSetting = 'hidden' | 'public' | false;

/** Where production maps go with `sourceMaps: 'hidden'`, relative to the build output (`bin/`). */
export const hiddenSourceMapsDirectory = 'sourcemaps';

/*
 * Production used to write `client.<hash>.js.map` into `public/` with a `sourceMappingURL` comment, so
 * anyone could download the full client source. `hidden` (the default) keeps the maps for error reports
 * in `bin/sourcemaps/` and leaves the comment out; nothing under `/public` names or serves them.
 * `sourceMapFilename` is relative to `output.path` (`bin/public`), hence the `../`.
 */
export const getClientSourceMapOptions = (
    dev: boolean,
    setting: TClientSourceMapsSetting = 'hidden',
): { devtool: false | string; sourceMapFilename?: string } => {
    // The cheapest practical maps in dev, for fast rebuilds.
    if (dev) return { devtool: 'eval-cheap-module-source-map' };
    if (setting === false) return { devtool: false };
    if (setting === 'public') return { devtool: 'source-map' };

    return { devtool: 'hidden-source-map', sourceMapFilename: `../${hiddenSourceMapsDirectory}/[file].map` };
};
