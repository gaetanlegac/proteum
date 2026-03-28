# Route Contract

This is the canonical route-area contract for Proteum-based projects.
Role: keep only manual-route rules here.
Keep here: explicit HTTP route guidance, public/crawlable endpoint rules, absolute URL generation, and route-specific catalog placement.
Do not put here: controller contracts, service-layer business logic, page SSR rules, or broad project workflow already defined elsewhere.

Optimization source of truth: project-root `optimizations.md`.
Diagnostics source of truth: project-root `diagnostics.md`.

- Use `server/routes/**` only for explicit HTTP behavior that should not be generated from controllers.
- If the endpoint is a normal app API, prefer `server/controllers/**/*.ts`.
- Good fits include redirects, resources, OAuth callbacks, webhooks, sitemap-like output, and custom public endpoints.
- If a route needs a curated registry, keep server-only data in `/server/catalogs/**` and shared data in `/common/catalogs/**`.

## Absolute URLs

Use `Router.url('/relative/path')` to generate absolute URLs.
