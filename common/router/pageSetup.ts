/*----------------------------------
- TYPES
----------------------------------*/

import type { TRouteOptions } from ".";

export const routeSetupOptionKeys = [
  "priority",
  "preload",
  "domain",
  "accept",
  "raw",
  "auth",
  "redirectLogged",
  "static",
  "whenStatic",
  "canonicalParams",
  "layout",
  "TESTING",
  "logging",
] as const satisfies (keyof TRouteOptions)[];

export const reservedRouteSetupKeys = [
  "id",
  "filepath",
  "bodyId",
  "data",
  "setup",
] as const;

const routeSetupOptionKeysSet = new Set<string>(routeSetupOptionKeys);
const reservedRouteSetupKeysSet = new Set<string>(reservedRouteSetupKeys);

export const getRouteSetupOptionKey = (key: string) => {
  const normalizedKey = key.startsWith("_") ? key.substring(1) : key;

  if (reservedRouteSetupKeysSet.has(normalizedKey))
    throw new Error(`"${key}" is a reserved Router.page setup key.`);

  return routeSetupOptionKeysSet.has(normalizedKey)
    ? (normalizedKey as keyof TRouteOptions)
    : null;
};

export const splitRouteSetupResult = (result: TObjetDonnees | undefined) => {
  const options: Partial<TRouteOptions> = {};
  const data: TObjetDonnees = {};

  if (!result) return { options, data };

  for (const key in result) {
    const optionKey = getRouteSetupOptionKey(key);

    if (optionKey) options[optionKey] = result[key];
    else data[key] = result[key];
  }

  return { options, data };
};
