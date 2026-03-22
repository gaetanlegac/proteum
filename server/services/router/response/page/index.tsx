/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import renderToString from 'preact-render-to-string';

// Core
import { type TServerRouter, TRouterContext } from '@server/services/router';
import type { Layout, TRoute, TErrorRoute, TClientOrServerContext } from '@common/router';
import PageResponse, { TFrontRenderer, TPageRenderContext } from '@common/router/response/page';
import { getClientBuildManifest } from './clientManifest';

// Composants UI
import App from '@client/app/component';

/*----------------------------------
- CONSTANTS
----------------------------------*/

const seoLimits = { title: 70, description: 255 };

/*----------------------------------
- CLASS
----------------------------------*/

export default class ServerPage<TRouter extends TServerRouter = TServerRouter> extends PageResponse<
    TRouter,
    TRoute | TErrorRoute,
    TRouterContext<TRouter>
> {
    public app: TRouter['app'];
    public router: TRouter;

    /*----------------------------------
    - PUBLIC API
    ----------------------------------*/

    public constructor(
        public route: TRoute | TErrorRoute,
        public renderer: TFrontRenderer,
        context: TRouterContext<TRouter>,
        public layout?: Layout,
    ) {
        super(route, renderer, context);

        this.app = context.app;
        this.router = context.request.router;
    }

    public render(): Promise<string> {
        // Complete SEO metadatas
        const titleSuffix = ' | ' + this.app.identity.web.titleSuffix;
        if (this.title === undefined) this.title = this.app.identity.web.fullTitle;
        else if (this.title.length < seoLimits.title - titleSuffix.length) this.title += titleSuffix;

        if (this.description === undefined) this.description = this.app.identity.web.description;

        // We render page & document separatly,
        // because document needs to access to runtime assigned values
        // Ex: runtime added scripts, title, metas, ....

        const context = this.context as TPageRenderContext & TRouterContext<TRouter>;
        const html = renderToString(
            <App context={context as Parameters<typeof App>[0]['context'] & TRouterContext<TRouter>} />,
        );

        if (html === undefined) throw new Error(`Page HTML is empty (undefined)`);

        // Metas
        this.buildMetas();
        this.buildJsonLd();

        // A page chunk can group multiple CSS and JS assets.
        // Route ids come from the generated route wrapper modules.
        this.addChunks();

        /*if (page.classeBody)
            attrsBody.className += ' ' + page.classeBody.join(' ');

        if (page.theme)
            attrsBody.className += ' ' + page.theme;*/

        return this.router.render.page(html, this, context.response);
    }

    /*----------------------------------
    - HELPERS
    ----------------------------------*/

    // Define which chunks (script / style) to load
    private addChunks() {
        const manifest = getClientBuildManifest();
        const pageChunks = [this.route.options['id']];
        for (const chunk of pageChunks) {
            if (!chunk) continue;

            const assets = manifest.chunks?.[chunk];
            if (!assets) {
                console.warn(
                    `Chunk ${chunk} was not found. Indexed chunks: ${Object.keys(manifest.chunks || {}).join(', ')}`,
                );
                continue;
            }

            for (const asset of assets.css || []) {
                this.style.push({ id: chunk, url: '/public/' + asset });
            }

            for (const asset of assets.js || []) {
                this.scripts.push({ id: chunk, url: '/public/' + asset });
            }
        }
    }

    private buildMetas() {
        const context = this.context as TPageRenderContext & TRouterContext<TRouter>;
        const shouldIndex = context.response.statusCode < 300;

        const metas: Record<string, string | undefined> = {
            robots: shouldIndex ? 'index' : 'noindex',

            'og:type': 'website',
            'og:locale': this.app.identity.locale,
            'og:site_name': this.app.identity.web.title,
            'og:url': this.url,

            'og:title': this.title,
            'og:description': this.description,

            'twitter:url': this.url,
            'twitter:card': 'summary_large_image',
            'twitter:title': this.title,
            'twitter:description': this.description,

            ...(this.app.identity.web.metas || {}),

            ...this.metas,
        };

        for (const key in metas) {
            const value = metas[key];
            if (value === '') continue;
            this.head.push({ $: 'meta', property: key, content: value });
        }
    }

    private buildJsonLd() {
        this.jsonld.push(
            {
                '@type': 'Organization',
                '@id': this.router.url('/#organization'),
                name: this.app.identity.author.name,
                url: this.app.identity.author.url,
                logo: {
                    '@type': 'ImageObject',
                    '@id': this.router.url('/#logo'),
                    url: this.router.url('/public/brand/1024.png'),
                    width: '1024px',
                    height: '1024px',
                    caption: this.app.identity.name,
                },
                sameAs: [],
            },
            {
                '@type': 'WebSite',
                '@id': this.router.url('/#website'),
                url: this.router.url('/'),
                name: this.app.identity.name,
                description: this.app.identity.description,
                publisher: { '@id': this.router.url('/#organization') },
                inLanguage: this.app.identity.locale,
                potentialAction: [],

                ...(this.app.identity.web.jsonld || {}),
            },
            {
                '@type': 'WebPage',
                '@id': this.url,
                url: this.url,

                isPartOf: { '@id': this.router.url('/#website') },

                name: this.title,
                description: this.description,
                inLanguage: this.app.identity.locale,
            },
        );
    }
}
