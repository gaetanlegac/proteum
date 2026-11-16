/*----------------------------------
- CONTENU TRANSFORMÉ
----------------------------------*/

// Contenu brut + métadonnées
declare module '*.sql' {
    const value: String & { id: string; sourcefile: string };
    export = value;
}

// Contenu brut + métadonnées
declare module '*.json' {
    const value: any;
    export = value;
}

/*----------------------------------
- CONTENU BRUT
----------------------------------*/

// Contenu brut
declare module '*.md' {
    const value: string;
    export = value;
}

/*----------------------------------
- ASSETS: CHEMIN PUBLIC
----------------------------------*/

declare module '*.svg' {
    const value: string;
    export = value;
}

declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.webp';
// The file's public URL (or a data URL under 4 KB): cli/compiler/common/files/images.ts.
declare module '*.avif' {
    const value: string;
    export = value;
}
declare module '*.gif';
declare module '*.bmp';

declare module '*.mp3' {
    const value: string;
    export = value;
}
