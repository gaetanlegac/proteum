import fs from 'fs-extra';
import path from 'path';
import type { Stats } from '@rspack/core';

export type TClientManifestChunkAssets = { assets: string[]; css: string[]; js: string[] };

export type TClientManifestPreloadFont = { href: string; type: string };

export type TClientBuildManifest = {
    publicPath: string;
    entries: Record<string, TClientManifestChunkAssets>;
    chunks: Record<string, TClientManifestChunkAssets>;
    // The fonts `proteum.config.ts` lists in `preloadFonts`, by their hashed public path.
    preloadFonts: TClientManifestPreloadFont[];
};

const fontTypes: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
// Preferred first: a browser that takes the preload takes woff2.
const fontExtensionsByPreference = ['woff2', 'woff', 'otf', 'ttf'];
// `fonts/[name].[contenthash:8][ext]`, the name the font rule gives (cli/compiler/common/files/autres.ts).
const emittedFontPattern = /^fonts\/(.+)\.[0-9a-f]{8}\.(woff2|woff|ttf|otf)$/;

/**
 * The emitted file of each declared font, in declaration order. A name with no emitted file is
 * returned in `missing`: the production build fails on it (cli/commands/build.ts).
 */
export const resolvePreloadFonts = (assetNames: string[], declared: string[] = []) => {
    const emitted = new Map<string, Map<string, string>>();
    for (const assetName of assetNames) {
        const match = emittedFontPattern.exec(assetName);
        if (!match) continue;
        const byExtension = emitted.get(match[1]) || new Map<string, string>();
        byExtension.set(match[2], assetName);
        emitted.set(match[1], byExtension);
    }

    const preloadFonts: TClientManifestPreloadFont[] = [];
    const missing: string[] = [];
    for (const name of declared) {
        const byExtension = emitted.get(name);
        const extension = fontExtensionsByPreference.find((candidate) => byExtension?.has(candidate));
        if (!byExtension || !extension) {
            missing.push(name);
            continue;
        }
        preloadFonts.push({ href: byExtension.get(extension) as string, type: fontTypes[extension] });
    }

    return { preloadFonts, missing };
};

const filterAsset = (asset: string) => !asset.endsWith('.map');

const classifyAssets = (assets: string[]): TClientManifestChunkAssets => {
    const filtered = assets.filter(filterAsset);

    return {
        assets: filtered,
        css: filtered.filter((asset) => asset.endsWith('.css')),
        js: filtered.filter((asset) => asset.endsWith('.js')),
    };
};

const normalizePublicPath = (publicPath?: string) => {
    if (!publicPath || publicPath === 'auto') return '/public/';

    return publicPath.endsWith('/') ? publicPath : `${publicPath}/`;
};

export const getClientManifestPath = (outputPath: string) => path.join(outputPath, 'client-manifest.json');

export const writeClientManifest = (stats: Stats, outputPath: string, declaredPreloadFonts: string[] = []) => {
    const statsJson = stats.toJson({
        assets: true,
        assetsByChunkName: true,
        entrypoints: true,
        namedChunkGroups: true,
        publicPath: true,
    });
    const publicPath = normalizePublicPath(statsJson.publicPath);

    const buildChunkAssets = (chunkGroup: { assets?: Array<string | { name?: string | null }> } | undefined) => {
        const assets = (chunkGroup?.assets || [])
            .map((asset) => (typeof asset === 'string' ? asset : asset.name || ''))
            .filter(Boolean);

        return classifyAssets(assets);
    };

    const entries = Object.fromEntries(
        Object.entries(statsJson.entrypoints || {}).map(([name, chunkGroup]) => [name, buildChunkAssets(chunkGroup)]),
    );

    const chunks = Object.fromEntries(
        Object.entries(statsJson.namedChunkGroups || {}).map(([name, chunkGroup]) => [
            name,
            buildChunkAssets(chunkGroup),
        ]),
    );

    const { preloadFonts, missing } = resolvePreloadFonts(
        (statsJson.assets || []).map((asset) => asset.name),
        declaredPreloadFonts,
    );
    const manifest: TClientBuildManifest = { publicPath, entries, chunks, preloadFonts };

    fs.writeJsonSync(getClientManifestPath(outputPath), manifest, { spaces: 2 });

    return { manifest, missingPreloadFonts: missing };
};
