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

declare module 'stopword' {
    export const eng: string[];
    export function removeStopwords(words: string[], stopwords?: string[]): string[];
}
