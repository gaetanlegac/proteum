/*----------------------------------
- PAGE METAS
----------------------------------*/

/*----------------------------------
- TYPES
----------------------------------*/

type TMetaValue = string | Date | undefined | null;
export type TMetaTag = { $: string } & { [key: string]: TMetaValue };

/*----------------------------------
- HELPERS
----------------------------------*/

/**
 * Open Graph and its extensions are RDFa vocabularies read from `property`. Everything
 * else (`robots`, `description`, `twitter:*`, `theme-color`...) is only honoured as
 * `name`: emitted as `property="robots"`, the default robots meta was inert on every page.
 */
export const isOpenGraphMetaKey = (key: string): boolean => /^(og|article|fb|profile|book|music|video):/.test(key);

/**
 * Turns the page's meta dictionary into head tags, skipping the keys the page already
 * pushed into `head` itself (a `noindex` on a faceted view, a per-page social image):
 * a second tag with the same key would leave crawlers to pick between the two.
 */
export const buildMetaTags = (metas: { [key: string]: TMetaValue }, head: readonly TMetaTag[]): TMetaTag[] => {
    const pushedMetaKeys = new Set(
        head
            .filter((tag) => tag.$ === 'meta')
            .map((tag) => tag.name || tag.property)
            .filter((key): key is string => typeof key === 'string'),
    );
    const tags: TMetaTag[] = [];

    for (const key in metas) {
        const value = metas[key];
        if (value === '' || value === undefined || value === null || pushedMetaKeys.has(key)) continue;

        tags.push({ $: 'meta', [isOpenGraphMetaKey(key) ? 'property' : 'name']: key, content: value });
    }

    return tags;
};
