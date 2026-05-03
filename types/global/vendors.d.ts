declare module 'accepts' {
    const accepts: any;
    export default accepts;
}

declare module '@babel/generator' {
    const generate: any;
    export default generate;
}

declare module '@babel/traverse' {
    export type Binding = any;
    export type NodePath<T = any> = any;
    const traverse: any;
    export default traverse;
}

declare module 'bytes' {
    const bytes: (value: string | number) => number;
    export default bytes;
}

declare module 'compression' {
    const compression: any;
    export default compression;
}

declare module 'cookie-parser' {
    const cookieParser: any;
    export default cookieParser;
}

declare module 'cors' {
    export type CorsOptions = any;
    const cors: any;
    export default cors;
}

declare module 'escape-html' {
    export default function escapeHtml(value: string): string;
}

declare module 'escape-regexp' {
    export default function escapeRegexp(value: string): string;
}

declare module 'express-fileupload' {
    const fileUpload: any;
    export default fileUpload;
}

declare module 'hpp' {
    const hpp: any;
    export default hpp;
}

declare module 'jsonwebtoken' {
    const jwt: any;
    export default jwt;
}

declare module 'md5' {
    export default function md5(value: string): string;
}

declare module 'morgan' {
    const morgan: any;
    export default morgan;
}

declare module 'object-hash' {
    export type ObjectHashOptions = {
        unorderedArrays?: boolean;
        unorderedObjects?: boolean;
    };
    export type ObjectHashValue =
        | string
        | number
        | boolean
        | null
        | undefined
        | Date
        | ObjectHashValue[]
        | { [key: string]: ObjectHashValue };

    const objectHash: (value: ObjectHashValue, options?: ObjectHashOptions) => string;
    export default objectHash;
}

declare module 'fs-extra' {
    type FsJsonValue =
        | string
        | number
        | boolean
        | null
        | FsJsonValue[]
        | { [key: string]: FsJsonValue };
    type FsExtraModule = {
        createReadStream: typeof import('fs').createReadStream;
        ensureDirSync(path: import('fs').PathLike): void;
        existsSync: typeof import('fs').existsSync;
        moveSync(source: import('fs').PathLike, destination: import('fs').PathLike, options?: { overwrite?: boolean }): void;
        outputFileSync(
            file: import('fs').PathOrFileDescriptor,
            data: string | NodeJS.ArrayBufferView,
            options?: import('fs').WriteFileOptions | { encoding?: string },
        ): void;
        readdir: typeof import('fs/promises').readdir;
        readdirSync: typeof import('fs').readdirSync;
        readFile: typeof import('fs/promises').readFile;
        readFileSync: typeof import('fs').readFileSync;
        readJSONSync<TValue = FsJsonValue>(path: import('fs').PathLike): TValue;
        readJsonSync<TValue = FsJsonValue>(path: import('fs').PathLike): TValue;
        removeSync(path: import('fs').PathLike): void;
        statSync: typeof import('fs').statSync;
        writeJSONSync(path: import('fs').PathLike, data: FsJsonValue | object, options?: Record<string, unknown>): void;
    };

    const fsExtra: FsExtraModule;
    export default fsExtra;
    export const createReadStream: FsExtraModule['createReadStream'];
    export const ensureDirSync: FsExtraModule['ensureDirSync'];
    export const existsSync: FsExtraModule['existsSync'];
    export const moveSync: FsExtraModule['moveSync'];
    export const outputFileSync: FsExtraModule['outputFileSync'];
    export const readdir: typeof import('fs/promises').readdir;
    export const readdirSync: FsExtraModule['readdirSync'];
    export const readFile: typeof import('fs/promises').readFile;
    export const readFileSync: FsExtraModule['readFileSync'];
    export const readJSONSync: FsExtraModule['readJSONSync'];
    export const readJsonSync: FsExtraModule['readJsonSync'];
    export const removeSync: FsExtraModule['removeSync'];
    export const statSync: FsExtraModule['statSync'];
    export const writeJSONSync: FsExtraModule['writeJSONSync'];
}

declare module 'jstoxml' {
    export const toXML: (value: Record<string, unknown>, options?: Record<string, unknown>) => string;
}

declare module 'stopword' {
    export const eng: string[];
    export function removeStopwords(words: string[], stopwords?: string[]): string[];
}
