/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type { TPagePreload } from '@common/router/response/page';

/*----------------------------------
- TYPES
----------------------------------*/

type TManifestPreloadFont = { href: string; type: string };

/*----------------------------------
- RULES
----------------------------------*/

/** The fonts `preloadFonts` declares, as preloads. Fonts are always fetched in CORS mode, so the preload must be too. */
export const fontPreloads = (fonts: TManifestPreloadFont[] = [], publicPath = '/public/'): TPagePreload[] =>
    fonts.map((font) => ({ href: publicPath + font.href, as: 'font', type: font.type, crossorigin: 'anonymous' }));

/** One preload per `as` and `href`, first one kept: fonts first, then the page's own in call order. */
export const dedupePreloads = (preloads: TPagePreload[]) => {
    const seen = new Set<string>();

    return preloads.filter((preload) => {
        const key = `${preload.as} ${preload.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/** The `<link>` attributes of a preload, in a fixed order. */
export const preloadLinkAttributes = (preload: TPagePreload) => ({
    rel: 'preload',
    href: preload.href,
    as: preload.as,
    ...(preload.type ? { type: preload.type } : {}),
    ...(preload.crossorigin ? { crossorigin: preload.crossorigin } : {}),
    ...(preload.imagesrcset ? { imagesrcset: preload.imagesrcset } : {}),
    ...(preload.imagesizes ? { imagesizes: preload.imagesizes } : {}),
    ...(preload.fetchpriority ? { fetchpriority: preload.fetchpriority } : {}),
    ...(preload.media ? { media: preload.media } : {}),
});

// Node refuses a header value with a control character or a character above 0xFF, and the whole
// answer would fail: a preload that is not plain printable ASCII stays in the HTML only.
const headerSafe = /^[\x20-\x7E]*$/;

const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;

/**
 * The `Link` header mirroring the preloads (RFC 8288), which Cloudflare turns into a 103 Early Hint:
 * `</public/fonts/a.1a2b3c4d.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous`.
 */
export const buildPreloadLinkHeader = (preloads: TPagePreload[]) =>
    preloads
        .map((preload) => {
            const params = [
                `<${preload.href}>`,
                'rel=preload',
                `as=${preload.as}`,
                ...(preload.type ? [`type=${quote(preload.type)}`] : []),
                ...(preload.crossorigin ? [`crossorigin=${preload.crossorigin}`] : []),
                ...(preload.imagesrcset ? [`imagesrcset=${quote(preload.imagesrcset)}`] : []),
                ...(preload.imagesizes ? [`imagesizes=${quote(preload.imagesizes)}`] : []),
                ...(preload.fetchpriority ? [`fetchpriority=${preload.fetchpriority}`] : []),
                ...(preload.media ? [`media=${quote(preload.media)}`] : []),
            ].join('; ');

            return headerSafe.test(params) && !/[<>]/.test(preload.href) ? params : undefined;
        })
        .filter((value): value is string => value !== undefined)
        .join(', ');
