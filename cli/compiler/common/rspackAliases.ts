import fs from "fs-extra";

type TWebpackAliases = Record<string, string | string[]>;

export const toRspackAliases = (aliases: TWebpackAliases) =>
  Object.fromEntries(
    Object.entries(aliases).map(([alias, value]) => {
      const candidates = Array.isArray(value) ? value : [value];
      const selectedCandidate =
        candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];

      return [alias, selectedCandidate];
    }),
  );
