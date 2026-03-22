// Npm
import { createHash } from 'crypto';
import path from 'path';
import favicons from 'favicons';
import fs from 'fs-extra';

// Type
import type { App } from '../../app';
import { logVerbose } from '../../runtime/verbose';

export default async (app: App, outputDir: string, enabled: boolean = true) => {
    if (!enabled) return;

    const logoPath = path.join(app.paths.root, 'client', 'assets', 'identity', 'logo.svg');
    const metadataPath = path.join(outputDir, '.proteum-identity-assets.json');
    const options = createIdentityAssetsOptions(app);
    const cacheKey = createHash('sha1').update(fs.readFileSync(logoPath)).update(JSON.stringify(options)).digest('hex');

    const currentMetadata = readIdentityAssetsMetadata(metadataPath);
    if (
        currentMetadata?.cacheKey === cacheKey &&
        currentMetadata.files.length > 0 &&
        currentMetadata.files.every((file) => fs.existsSync(path.join(outputDir, file)))
    )
        return;

    logVerbose(`Generating identity assets ...`);
    fs.emptyDirSync(outputDir);

    const response = await favicons(logoPath, options);
    const generatedFiles = [...response.images.map((image) => image.name), ...response.files.map((file) => file.name)];

    await Promise.all([
        // Enregistrement images
        ...response.images.map((image) => {
            let destimg = outputDir + '/' + image.name;
            return fs.writeFile(destimg, image.contents);
        }),

        // Enregistrement fichiers
        ...response.files.map((fichier) => {
            let destfichier = outputDir + '/' + fichier.name;
            return fs.writeFile(destfichier, fichier.contents);
        }),

        fs.writeJSON(metadataPath, { cacheKey, files: generatedFiles }, { spaces: 2 }),
    ]);
};

function createIdentityAssetsOptions(app: App) {
    const identity = app.identity;

    return {
        path: '/assets/img/identite/favicons/',
        appName: identity.name,
        appShortName: identity.name,
        appDescription: identity.description,
        developerName: identity.author.name,
        developerURL: identity.author.url,
        dir: 'auto',
        lang: identity.language,
        background: '#fff',
        theme_color: identity.maincolor,
        appleStatusBarStyle: 'default',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        version: identity.web.version,
        logging: false,
        pixel_art: false,
        icons: {
            android: true,
            appleIcon: true,
            appleStartup: false,
            coast: false,
            favicons: true,
            windows: true,
            yandex: false,
        },
    };
}

function readIdentityAssetsMetadata(metadataPath: string): null | { cacheKey: string; files: string[] } {
    if (!fs.existsSync(metadataPath)) return null;

    try {
        const metadata = fs.readJSONSync(metadataPath);
        if (
            !metadata ||
            typeof metadata.cacheKey !== 'string' ||
            !Array.isArray(metadata.files) ||
            !metadata.files.every((file: unknown) => typeof file === 'string')
        )
            return null;

        return metadata;
    } catch {
        return null;
    }
}
