/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import renderToString from "preact-render-to-string"; 

// Core
import { default as Router, TRouterContext } from "@server/services/router";
import type { Layout, TRoute, TErrorRoute, TClientOrServerContext } from '@common/router';
import PageResponse, { TFrontRenderer } from "@common/router/response/page";

// Composants UI
import App from '@client/app/component';

// Caches
const chunks = require('./chunk-manifest.json');

/*----------------------------------
- TYPES
----------------------------------*/

const seoLimits = {
    title: 70,
    description: 255
}

/*----------------------------------
- FONCTION
----------------------------------*/

export default class ServerPage<TRouter extends Router = Router> extends PageResponse<TRouter> {

    public constructor(
        public route: TRoute | TErrorRoute,
        public renderer: TFrontRenderer,
        public context: TRouterContext,
        public layout?: Layout,

        public app = context.app,
        public router = context.request.router,
        
    ) {

        super(route, renderer, context)
        
    }

    public render(): Promise<string> {

        // Complete SEO metadatas
        const titleSuffix = ' | ' + this.app.identity.web.titleSuffix
        if (this.title === undefined)
            this.title = this.app.identity.web.fullTitle;
        else if (this.title.length < seoLimits.title - titleSuffix.length)
            this.title += titleSuffix;

        if (this.description === undefined)
            this.description = this.app.identity.web.description;

        // We render page & document separatly,
        // because document needs to access to runtime assigned values
        // Ex: runtime added scripts, title, metas, ....
        
        const html = renderToString(
            <App {...this.context} />
        );

        if (html === undefined)
            throw new Error(`Page HTML is empty (undefined)`);

        // Metas
        this.buildMetas();
        this.buildJsonLd();

        // Un chunk peut regrouper plusieurs fihciers css / js
        // L'id du chunk est injecté depuis le plugin babel
        this.addChunks();

        /*if (page.classeBody)
            attrsBody.className += ' ' + page.classeBody.join(' ');

        if (page.theme)
            attrsBody.className += ' ' + page.theme;*/

        return this.router.render.page(html, this, this.context.response);
    }

    // Define which chunks (script / style) to load
    private addChunks() {
        const pageChunks = [this.route.options["id"]];
        for (const chunk of pageChunks) {

            if (!chunk) continue;

            const assets = chunks[chunk];
            if (!assets) {
                console.warn(`Chunk ${chunk} was not found. Indexed chunks: ${Object.keys(chunks).join(', ')}`);
                continue;
            }

            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];

                if (asset.endsWith('.css'))
                    this.style.push({
                        id: chunk,
                        url: '/public/' + asset
                    })
                else
                    this.scripts.push({
                        id: chunk,
                        url: '/public/' + asset
                    });
            }

        }
    }

    private buildMetas() {

        const shouldIndex = this.context.response.statusCode < 300;

        const metas = {

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

            ...this.metas
        };

        for (const key in metas) {
            const value = metas[key];
            if (value === "") continue;
            this.head.push({ $: 'meta', property: key, content: value });
        }
    }

    private buildJsonLd() {
        this.jsonld.push({
            '@type': 'Organization',
            '@id': this.router.url('/#organization'),
            name: this.app.identity.author.name,
            url: this.app.identity.author.url,
            logo: {
                '@type': 'ImageObject',
                '@id': this.router.url('/#logo'),
                url: this.router.url('/public/brand/1024.png'),
                width: "1024px",
                height: "1024px",
                caption: this.app.identity.name
            },
            sameAs: []
        }, {
            '@type': 'WebSite',
            '@id': this.router.url('/#website'),
            url: this.router.url('/'),
            name: this.app.identity.name,
            description: this.app.identity.description,
            "publisher": {
                "@id": this.router.url('/#organization'),
            },
            inLanguage: this.app.identity.locale,
            potentialAction: [],

            ...(this.app.identity.web.jsonld || {}),
        }, {
            '@type': "WebPage",
            '@id': this.url,
            url: this.url,

            "isPartOf": {
                "@id": this.router.url('/#website'),
            },

            name: this.title,
            description: this.description,
            inLanguage: this.app.identity.locale,
        });
    }
}