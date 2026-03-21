import fs from "fs-extra";
import path from "path";

type TClientManifestAssets = {
  assets?: string[];
  css?: string[];
  js?: string[];
};

export type TClientBuildManifest = {
  publicPath?: string;
  entries?: Record<string, TClientManifestAssets>;
  chunks?: Record<string, TClientManifestAssets>;
};

const manifestPath = path.join(__dirname, "client-manifest.json");
let cachedManifest: TClientBuildManifest | undefined;

export const getClientBuildManifest = (): TClientBuildManifest => {
  if (!__DEV__) {
    if (!cachedManifest) {
      cachedManifest = fs.existsSync(manifestPath)
        ? fs.readJSONSync(manifestPath)
        : {};
    }

    return cachedManifest ?? {};
  }

  return fs.existsSync(manifestPath) ? fs.readJSONSync(manifestPath) : {};
};
