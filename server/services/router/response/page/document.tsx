/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import renderToString from 'preact-render-to-string';
const safeStringify = require('fast-safe-stringify'); // remplace les références circulairs par un [Circular]

// Core
import type { TServerRouter, Response as ServerResponse } from '@server/services/router';
import type Page from '.';
import { getClientBuildManifest } from './clientManifest';

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- SERVICE
----------------------------------*/
export default class DocumentRenderer<TRouter extends TServerRouter> {
    public constructor(
        public router: TRouter,
        public app = router.app,
    ) {}

    public staticDocument() {
        const routesForClient = JSON.stringify(this.router.ssrRoutes);
        return (
            '<!doctype html>' +
            renderToString(
                <html lang="en">
                    <head>
                        {/* Format */}
                        <meta charSet="utf-8" />
                        <meta name="viewport" content="width=device-width, initial-scale=1" />

                        {/* CSS */}
                        {this.clientStyles()}

                        {/* JS */}
                        <script
                            type="text/javascript"
                            dangerouslySetInnerHTML={{
                                __html:
                                    `window.routes=${routesForClient};` +
                                    (this.app.env.profile === 'dev' ? 'window.dev = true;' : ''),
                            }}
                        />
                        {this.clientScripts()}
                    </head>
                    <body></body>
                </html>,
            )
        );
    }

    public async page(html: string, page: Page<TRouter>, response: ServerResponse<TRouter>) {
        let attrsBody = { className: [...page.bodyClass].join(' ') };

        return (
            '<!doctype html>' +
            renderToString(
                <html lang="en">
                    <head>
                        {/* Format */}
                        <meta charSet="utf-8" />
                        <meta content="IE=edge" httpEquiv="X-UA-Compatible" />
                        <meta name="viewport" content="width=device-width, initial-scale=1" />

                        {/* Mobile */}
                        <meta name="application-name" content={this.app.identity.web.title} />
                        <meta name="apple-mobile-web-app-title" content={this.app.identity.web.title} />
                        <meta name="apple-mobile-web-app-title" content={this.app.identity.web.title} />
                        <meta content={this.app.identity.author.name} name="author" />
                        <meta name="theme-color" content={this.app.identity.maincolor} />
                        <meta name="msapplication-TileColor" content={this.app.identity.maincolor} />
                        <meta name="apple-mobile-web-app-capable" content="yes" />
                        <meta name="mobile-web-app-capable" content="yes" />

                        {/* https://stackoverflow.com/questions/48956465/favicon-standard-2019-svg-ico-png-and-dimensions */}
                        {/*<link rel="manifest" href={RES['manifest.json']} />*/}
                        <link rel="shortcut icon" href={this.publicAssetUrl('app/favicon.ico', true)} />
                        <link
                            rel="icon"
                            type="image/png"
                            sizes="16x16"
                            href={this.publicAssetUrl('app/favicon-16x16.png', true)}
                        />
                        <link
                            rel="icon"
                            type="image/png"
                            sizes="32x32"
                            href={this.publicAssetUrl('app/favicon-32x32.png', true)}
                        />
                        <link
                            rel="apple-touch-icon"
                            sizes="180x180"
                            href={this.publicAssetUrl('app/apple-touch-icon-180x180.png', true)}
                        />
                        <meta name="msapplication-config" content={this.publicAssetUrl('app/browserconfig.xml', true)} />

                        {/* Page */}
                        <title>{page.title}</title>
                        <meta content={page.description} name="description" />
                        <link rel="canonical" href={String(response.canonicalUrl)} />

                        {/* SEO, social medias, OG tags, ...  */}
                        {page.head.map(({ $, ...attrs }) => React.createElement($, attrs))}

                        {this.styles(page)}

                        {await this.scripts(response, page)}

                        {/* Rich Snippets: https://schema.org/docs/full.html + https://jsonld.com/ */}
                        <script
                            type="application/ld+json"
                            dangerouslySetInnerHTML={{
                                __html: JSON.stringify({ '@context': 'http://schema.org', '@graph': page.jsonld }),
                            }}
                        />
                    </head>
                    <body {...attrsBody} dangerouslySetInnerHTML={{ __html: html }}></body>
                </html>,
            )
        );
    }

    private styles(page: Page<TRouter>) {
        return (
            <>
                {this.clientStyles()}

                {page.style.map((style) =>
                    'url' in style ? (
                        <>
                            <link rel="preload" href={style.url} as="style" />
                            <link rel="stylesheet" type="text/css" href={style.url} />
                        </>
                    ) : (
                        <>
                            <style id={style.id} dangerouslySetInnerHTML={{ __html: style.inline }} />
                        </>
                    ),
                )}
            </>
        );
    }

    private clientStyles() {
        const styles = this.clientEntryAssets('css');

        return (
            <>
                {styles.map((style) => {
                    const href = this.clientAssetUrl(style);

                    return (
                        <React.Fragment key={style}>
                            <link rel="preload" href={href} as="style" />
                            <link rel="stylesheet" type="text/css" href={href} />
                        </React.Fragment>
                    );
                })}
            </>
        );
    }

    private clientScripts() {
        const scripts = this.clientEntryAssets('js');

        return (
            <>
                {scripts.map((script) => {
                    const src = this.clientAssetUrl(script);

                    return (
                        <React.Fragment key={script}>
                            <link rel="preload" href={src} as="script" />
                            <script defer type="text/javascript" src={src} />
                        </React.Fragment>
                    );
                })}
            </>
        );
    }

    private async scripts(response: ServerResponse<TRouter>, page: Page<TRouter>) {
        const ssrData = response.forSsr(page);
        const context = safeStringify(ssrData);
        const routesForClient = JSON.stringify(this.router.ssrRoutes);
        const customContextKeys = Object.keys(ssrData).filter((key) => !['request', 'page', 'user', 'domains'].includes(key));

        this.app.container.Trace.record(
            response.request.id,
            'ssr.payload',
            {
                chunkId: page.chunkId || '',
                topLevelKeys: Object.keys(ssrData),
                requestDataKeys: Object.keys(ssrData.request.data || {}),
                pageDataKeys: Object.keys(ssrData.page.data || {}),
                customContextKeys,
                serializedBytes: Buffer.byteLength(context, 'utf8'),
                routeCount: this.router.ssrRoutes.length,
                source: {
                    filepath: page.route.options.filepath || '',
                    line: page.route.options.sourceLocation?.line || 0,
                    column: page.route.options.sourceLocation?.column || 0,
                },
            },
            'resolve',
        );

        return (
            <>
                {/* JS */}
                <script
                    type="text/javascript"
                    dangerouslySetInnerHTML={{
                        __html:
                            `window.ssr=${context}; window.routes=${routesForClient};` +
                            (this.app.env.profile === 'dev' ? 'window.dev = true;' : ''),
                    }}
                />

                {this.clientScripts()}

                {page.scripts.map((script) =>
                    'url' in script ? (
                        <>
                            <link rel="preload" href={script.url} as="script" />
                            <script type="text/javascript" src={script.url} {...(script.attrs || {})} />
                        </>
                    ) : (
                        <>
                            <script
                                type="text/javascript"
                                {...(script.attrs || {})}
                                id={script.id}
                                dangerouslySetInnerHTML={{ __html: script.inline }}
                            />
                        </>
                    ),
                )}
            </>
        );
    }

    private clientEntryAssets(kind: 'assets' | 'css' | 'js' = 'assets'): string[] {
        const manifest = getClientBuildManifest();
        const entry = manifest.entries?.client;
        const assets = entry?.[kind];

        return Array.isArray(assets) ? assets : [];
    }

    private clientAssetUrl(asset: string, withBuildId = false) {
        return this.publicAssetUrl(asset, withBuildId);
    }

    private publicAssetUrl(asset: string, withBuildId = false) {
        return `/public/${asset}${withBuildId ? `?v=${BUILD_ID}` : ''}`;
    }
}
