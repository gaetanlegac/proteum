# Optimization Rules

This file is the canonical source of truth for bundle size, performance, SEO, and SSR page-size guidance across Proteum-based projects.

## Priority Order

When tradeoffs exist inside optimization work, optimize in this order:

1. Reduce shipped client bundle size and unnecessary runtime code.
2. Improve build-time, server-time, and browser-time performance.
3. Improve SEO output and crawlable, semantic HTML.

## Bundle Size And Runtime Cost

- Reduce shipped client bundle size and unnecessary runtime code.
- When you need evidence for a bundle-size regression, run `npx proteum build --prod --analyze` for static artifacts or `npx proteum build --prod --analyze --analyze-serve --analyze-port auto` for a local analyzer URL.
- Before inventing a new helper, runtime, plugin, abstraction, primitive, parser, formatter, SDK wrapper, or build-time tool, first check whether the repo already depends on a suitable package.
- If the repo does not already depend on one, search npm before writing a custom implementation.
- Prefer established, flexible, well-typed, widely adopted, actively maintained packages.
- Build custom or keep custom infrastructure only when packages would clearly hurt bundle size, SSR behavior, performance, typing quality, flexibility, licensing, explicit contracts, or long-term maintainability.
- If you choose custom over a package, state briefly why.

## SSR And Page Size

- SSR page data belongs in page `setup`, not in `api.fetch(...)`.
- Prefer `Router.page(path, setup, render)` for normal SSR pages.
- `setup` returns one flat object.
- `_`-prefixed keys are route options. Every other key is SSR data and should be consumed from `render`.
- If a page needs route data, return it from `setup` and read it in `render`.
- Controller fetchers and promises returned from `setup` resolve before render.
- Never use `api.fetch(...)` in page files for SSR loading.
- Synchronous or SSR data calls must return only the strictly necessary data for the current render path to minimize SSR payload size.
- If an existing controller or data method returns a broader shape than the SSR path needs, create a dedicated proxy controller method with a narrower typed contract instead of reusing the oversized payload.
- Keep Prisma runtime access inside services when possible and prefer explicit `select` or narrow `include` in database queries.

## SEO And Crawlable Output

- Improve SEO output and crawlable, semantic HTML.
- For explicit crawl surfaces such as redirects, sitemap or RSS output, and public resources with custom semantics, prefer `server/routes/**` over generated controller actions when the endpoint is not a normal app API.

## Validation

- Do not stop at static analysis for SSR, routing, emitted assets, or rendered HTML.
- After implementing a feature or change, verify that performance, load size, and SEO output did not materially regress before finishing.
- When runtime cost, hot paths, or memory can change, use the relevant `npx proteum perf ...` command against the affected request or route and compare to the pre-change behavior when possible.
- For browser or SSR changes, load the real page, inspect the rendered HTML, and confirm the change does not ship unnecessary client code or oversized SSR payloads.
- Treat clearly worse bundle size, runtime cost, or crawlable HTML quality as regressions to fix or justify explicitly, not as optional follow-up cleanup.
- Build-only checks are supplementary.
- For SSR changes, load the real page and inspect the rendered HTML plus browser console.
