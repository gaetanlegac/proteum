/*----------------------------------
- PAGE JSON-LD DEFAULTS
----------------------------------*/

/*----------------------------------
- TYPES
----------------------------------*/

type TJsonLdNode = { '@type'?: string | string[]; '@id'?: string; [key: string]: unknown };

type TIdentity = {
    name: string;
    description: string;
    locale: string;
    author: { name: string; url: string };
    web: { jsonld?: Record<string, unknown> };
};

export type TDefaultJsonLdInput = {
    /** The nodes the page pushed itself, before the defaults are added. */
    pageJsonLd: readonly TJsonLdNode[];
    url: string;
    title: string;
    description: string;
    identity: TIdentity;
    resolveUrl: (path: string) => string;
};

/*----------------------------------
- HELPERS
----------------------------------*/

const hasType = (node: TJsonLdNode, type: string): boolean =>
    Array.isArray(node['@type']) ? node['@type'].includes(type) : node['@type'] === type;

/**
 * The publisher identity every page carries (`#organization`, `#website`) plus a generic
 * `WebPage` for pages that describe none themselves.
 *
 * A page that already pushed a `WebPage` keeps its own: a second node for the same URL
 * with another name and description reads as two contradictory pages to a consumer.
 * Empty `sameAs` and `potentialAction` arrays are left out for the same reason: they say
 * "no profiles" and "no actions" where the app said nothing. `identity.web.jsonld` can
 * still add either to the `WebSite` node.
 */
export const buildDefaultJsonLd = ({
    pageJsonLd,
    url,
    title,
    description,
    identity,
    resolveUrl,
}: TDefaultJsonLdInput): TJsonLdNode[] => {
    const nodes: TJsonLdNode[] = [
        {
            '@type': 'Organization',
            '@id': resolveUrl('/#organization'),
            name: identity.author.name,
            url: identity.author.url,
            logo: {
                '@type': 'ImageObject',
                '@id': resolveUrl('/#logo'),
                url: resolveUrl('/public/brand/1024.png'),
                width: '1024px',
                height: '1024px',
                caption: identity.name,
            },
        },
        {
            '@type': 'WebSite',
            '@id': resolveUrl('/#website'),
            url: resolveUrl('/'),
            name: identity.name,
            description: identity.description,
            publisher: { '@id': resolveUrl('/#organization') },
            inLanguage: identity.locale,
            ...(identity.web.jsonld || {}),
        },
    ];

    if (!pageJsonLd.some((node) => hasType(node, 'WebPage'))) {
        nodes.push({
            '@type': 'WebPage',
            '@id': url,
            url,
            isPartOf: { '@id': resolveUrl('/#website') },
            name: title,
            description,
            inLanguage: identity.locale,
        });
    }

    return nodes;
};
