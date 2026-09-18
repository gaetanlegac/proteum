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
- For agent-facing repeated diagnostics, prefer the read-only Proteum MCP surface over adding broader CLI output. MCP should expose compact single-line `proteum-mcp-v1` JSON with capped, typed, paginated reads; the CLI should stay compact and reproducible. Database diagnostics are limited to one capped `SELECT`, `SHOW`, or `EXPLAIN` read through MCP `db_query` or CLI `proteum db query`.

## SSR And Page Size

- The page `data` / `options` / `render` contract is defined in `client/pages/AGENTS.md`; SSR page data belongs in the route definition `data` function, never in `api.fetch(...)`.
- Synchronous or SSR data calls must return only the strictly necessary data for the current render path to minimize SSR payload size.
- If an existing controller or data method returns a broader shape than the SSR path needs, create a dedicated proxy controller method with a narrower typed contract instead of reusing the oversized payload.
- Keep Prisma runtime access inside services when possible and prefer explicit `select` or narrow `include` in database queries.

## SEO And Crawlable Output

- Improve SEO output and crawlable, semantic HTML.
- The SSR document emits every script (entry and page chunks) as `defer` and never preloads a script or a stylesheet: a `defer` script is already fetched when the parser meets it, and the preloads used to race the render-critical CSS at High priority. A `page.scripts` entry with `attrs: { async: true }` keeps `async` instead of `defer`. Third-party tags that should not compete with the first paint belong in an inline loader that runs after `load`, not in a `url` entry.
- `page.metas` keys are emitted as `name=` unless they belong to an Open Graph vocabulary (`og:`, `article:`, `fb:`, `profile:`, `book:`, `music:`, `video:`), which use `property=`. A key the page already pushed into `page.head` as a `meta` is not emitted a second time, so a page-level `robots` or `og:image` wins over the defaults.
- The default JSON-LD graph (`Organization`, `WebSite`, generic `WebPage`) adds its `WebPage` only when the page pushed none itself, and never emits empty `sameAs` or `potentialAction` arrays: a second `WebPage` for the same URL with another name reads as two contradictory pages, and an empty array says "none" where the app said nothing.
- The SSR router renders the same tree as the client router, idle page loader included: a page-level element that exists on one side only logs a hydration mismatch on every load and costs the Lighthouse Best Practices score.
- Production CSS is minified with the `lightningcss` package (`cli/compiler/common/cssMinimizer.ts`), not rspack's bundled minimizer: the bundled copy drops the semicolon between a declaration and a nested at-rule two levels deep, which is the shape Tailwind v4 emits for every variant with an opacity modifier, and the rule is silently lost in production only.
- For explicit crawl surfaces such as redirects, sitemap or RSS output, and public resources with custom semantics, prefer `server/routes/**` over generated controller actions when the endpoint is not a normal app API.

## Validation

- Do not stop at static analysis for SSR, routing, emitted assets, or rendered HTML.
- After implementing a feature or change, verify that performance, load size, and SEO output did not materially regress before finishing.
- When runtime cost, hot paths, or memory can change, use the relevant `npx proteum perf ...` command against the affected request or route and compare to the pre-change behavior when possible.
- For browser or SSR changes, use the browser MCP to load the real page, inspect the rendered HTML, and confirm the change does not ship unnecessary client code or oversized SSR payloads.
- Treat clearly worse bundle size, runtime cost, or crawlable HTML quality as regressions to fix or justify explicitly, not as optional follow-up cleanup.
- Build-only checks are supplementary.
