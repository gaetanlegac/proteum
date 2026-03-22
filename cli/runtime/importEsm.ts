// The CLI still boots through ts-node in CommonJS mode, but Ink ships as ESM-only.
// Use Node's native dynamic import so presentation code can depend on Ink safely.
const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as <T = unknown>(
    specifier: string,
) => Promise<T>;

export const importEsm = <T = unknown>(specifier: string) => nativeDynamicImport(specifier) as Promise<T>;
