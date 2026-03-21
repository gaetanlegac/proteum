import type { Options } from "@babel/preset-env";

import type { App } from "../../app";

export type TClientRuntimeTarget = "modern" | "legacy";

type TClientBuildContract = {
  target?: TClientRuntimeTarget;
};

const modernClientTargets: NonNullable<Options["targets"]> = {
  esmodules: true,
};

const getClientBuildContract = (app: App): TClientBuildContract => {
  const contract = app.packageJson?.proteum?.client;

  if (!contract || typeof contract !== "object") return {};

  return contract as TClientBuildContract;
};

export const getClientRuntimeTarget = (app: App): TClientRuntimeTarget => {
  const target = getClientBuildContract(app).target;

  if (target === undefined) return "modern";

  if (target === "modern" || target === "legacy") return target;

  throw new Error(
    `Invalid package.json proteum.client.target value: ${JSON.stringify(target)}. Expected "modern" or "legacy".`,
  );
};

export const isLegacyClientRuntimeTarget = (app: App) =>
  getClientRuntimeTarget(app) === "legacy";

export const createClientPresetEnvOptions = (
  app: App,
  dev: boolean,
): Options => {
  const target = getClientRuntimeTarget(app);

  if (target === "legacy") {
    return {
      targets: {
        browsers: dev ? "last 2 versions" : app.packageJson.browserslist,
      },
      useBuiltIns: dev ? false : "usage",
      corejs: dev ? undefined : 3,
      forceAllTransforms: !dev,
      modules: false,
      debug: false,
      bugfixes: !dev,
    };
  }

  return {
    targets: modernClientTargets,
    useBuiltIns: false,
    corejs: undefined,
    forceAllTransforms: false,
    modules: false,
    debug: false,
    bugfixes: true,
  };
};

