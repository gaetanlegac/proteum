# Server Routes

This file adds route-area local rules on top of the canonical framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

- Use `/server/routes/**` only for explicit custom HTTP behavior that should not be generated from controllers.
- If the endpoint is just a normal app API, prefer `/server/controllers/**/*.ts`.
- Good fits include redirects, resources, OAuth callbacks, webhooks, sitemap-like output, and custom public endpoints.
- If a route needs a curated registry, keep server-only data in `/server/catalogs/**` and shared data in `/common/catalogs/**`.

## Absolute URLs

Use `Router.url('/relative/path')` to generate absolute URLs.
