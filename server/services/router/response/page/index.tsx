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
import { buildMetaTags } from './metas';
import { buildDefaultJsonLd } from './jsonld';

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
        const requestId = context.response.request.id;
        this.app.container.Trace.record(
            requestId,
            'render.start',
            {
                chunkId: this.chunkId || '',
                title: this.title || '',
                routeId: this.route.options['id'] || '',
                source: {
                    filepath: this.route.options.filepath || '',
                    line: this.route.options.sourceLocation?.line || 0,
                    column: this.route.options.sourceLocation?.column || 0,
                },
            },
            'summary',
        );
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

        return this.router.render.page(html, this, context.response).then((document) => {
            this.app.container.Trace.record(
                requestId,
                'render.end',
                {
                    chunkId: this.chunkId || '',
                    htmlLength: html.length,
                    documentLength: document.length,
                    styleCount: this.style.length,
                    scriptCount: this.scripts.length,
                    source: {
                        filepath: this.route.options.filepath || '',
                        line: this.route.options.sourceLocation?.line || 0,
                        column: this.route.options.sourceLocation?.column || 0,
                    },
                },
                'summary',
            );

            return document;
        });
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

        this.head.push(...buildMetaTags(metas, this.head));
    }

    private buildJsonLd() {
        this.jsonld.push(
            ...buildDefaultJsonLd({
                pageJsonLd: this.jsonld,
                url: this.url,
                title: this.title,
                description: this.description,
                identity: this.app.identity,
                resolveUrl: (path) => this.router.url(path),
            }),
        );
    }
}
