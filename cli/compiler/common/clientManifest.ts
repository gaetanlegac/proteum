import fs from "fs-extra";
import path from "path";
import type { Stats } from "@rspack/core";

export type TClientManifestChunkAssets = {
  assets: string[];
  css: string[];
  js: string[];
};

export type TClientBuildManifest = {
  publicPath: string;
  entries: Record<string, TClientManifestChunkAssets>;
  chunks: Record<string, TClientManifestChunkAssets>;
};

const filterAsset = (asset: string) => !asset.endsWith(".map");

const classifyAssets = (assets: string[]): TClientManifestChunkAssets => {
  const filtered = assets.filter(filterAsset);

  return {
    assets: filtered,
    css: filtered.filter((asset) => asset.endsWith(".css")),
    js: filtered.filter((asset) => asset.endsWith(".js")),
  };
};

const normalizePublicPath = (publicPath?: string) => {
  if (!publicPath || publicPath === "auto") return "/public/";

  return publicPath.endsWith("/") ? publicPath : `${publicPath}/`;
};

export const getClientManifestPath = (outputPath: string) =>
  path.join(outputPath, "client-manifest.json");

export const writeClientManifest = (stats: Stats, outputPath: string) => {
  const statsJson = stats.toJson({
    assets: true,
    assetsByChunkName: true,
    entrypoints: true,
    namedChunkGroups: true,
    publicPath: true,
  });
  const publicPath = normalizePublicPath(statsJson.publicPath);

  const buildChunkAssets = (
    chunkGroup:
      | {
          assets?: Array<string | { name?: string | null }>;
        }
      | undefined,
  ) => {
    const assets = (chunkGroup?.assets || [])
      .map((asset) => (typeof asset === "string" ? asset : asset.name || ""))
      .filter(Boolean);

    return classifyAssets(assets);
  };

  const entries = Object.fromEntries(
    Object.entries(statsJson.entrypoints || {}).map(([name, chunkGroup]) => [
      name,
      buildChunkAssets(chunkGroup),
    ]),
  );

  const chunks = Object.fromEntries(
    Object.entries(statsJson.namedChunkGroups || {}).map(([name, chunkGroup]) => [
      name,
      buildChunkAssets(chunkGroup),
    ]),
  );

  const manifest: TClientBuildManifest = {
    publicPath,
    entries,
    chunks,
  };

  fs.writeJsonSync(getClientManifestPath(outputPath), manifest, { spaces: 2 });

  return manifest;
};
