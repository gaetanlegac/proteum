/*----------------------------------
- PAGE JSON-LD DEFAULTS
----------------------------------*/

/*----------------------------------
- DEPENDENCIES
----------------------------------*/

import type { Thing } from 'schema-dts';
import type { TApplicationIdentityConfig } from '@common/applicationConfig';

/*----------------------------------
- TYPES
----------------------------------*/

export type TDefaultJsonLdInput = {
    /** The nodes the page pushed itself, before the defaults are added. */
    pageJsonLd: readonly Thing[];
    url: string | undefined;
    title: string | undefined;
    description: string | undefined;
    identity: TApplicationIdentityConfig;
    resolveUrl: (path: string) => string;
};

/*----------------------------------
- HELPERS
----------------------------------*/

/**
 * `WebPage` and the schema.org types that specialise it. A page that describes itself as an
 * `AboutPage` or a `CollectionPage` has described its web page: the generic node beside it
 * would be a second page for the same URL, exactly as beside a plain `WebPage`.
 */
const WEB_PAGE_TYPES: ReadonlySet<string> = new Set([
    'WebPage',
    'AboutPage',
    'CheckoutPage',
    'CollectionPage',
    'ContactPage',
    'FAQPage',
    'ItemPage',
    'MedicalWebPage',
    'ProfilePage',
    'QAPage',
    'RealEstateListing',
    'SearchResultsPage',
]);

const describesWebPage = (node: Thing): boolean => {
    if (typeof node !== 'object' || node === null || !('@type' in node)) return false;

    const declared: unknown = node['@type'];
    return (Array.isArray(declared) ? declared : [declared]).some(
        (type) => typeof type === 'string' && WEB_PAGE_TYPES.has(type),
    );
};

/**
 * The publisher identity every page carries (`#organization`, `#website`) plus a generic
 * `WebPage` for pages that describe none themselves.
 *
 * A page that already pushed a `WebPage`, or one of its subtypes, keeps its own: a second node for the same URL
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
}: TDefaultJsonLdInput): Thing[] => {
    const nodes: Thing[] = [
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

    if (!pageJsonLd.some(describesWebPage)) {
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
