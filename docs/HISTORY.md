# History

Notable framework changes, newest first. Commit messages hold the rest.

## 2.8.0 (unreleased)

Page weight and first byte for public pages. Nothing to change in apps to keep today's behavior, except where a line says so. See [client-assets.md](client-assets.md).

- Production pages no longer ship `preact/debug`: the client entry loads it only when `__DEV__` and `window.dev` are both true.
- The generated API client builds one Proxy node per connected project instead of writing out every connected leaf (the website: 417 leaves, 84 KB of every page). A connected leaf is `POST /api/<accessor with slashes>`; a leaf whose path differs, or whose accessor uses a key a node reserves (`then`, `toJSON`, `toString`, `call`…), stays written out. Local controllers and the `TControllers` type are unchanged. Code that enumerates a connected node (`Object.keys(context.Product)`) now sees nothing.
- AVIF pictures can be imported like WebP (the asset rule and a `*.avif` module type) and `/public` serves them as `image/avif`.
- `proteum build` writes a Brotli 11 twin (`.br`) beside every `.js`, `.css`, `.svg` and `.json` of `bin/public` that it makes smaller, and `/public` serves the twin to clients that accept `br`, with `Vary: Accept-Encoding` (the `express-static-gzip` package, on Express 4's own serve-static, so every other header stays as in 2.7). Cloudflare compresses at level 4: 13 to 22% less on the website's JS and CSS.
- Production client source maps are no longer served: `sourceMaps` in `proteum.config.ts` defaults to `'hidden'`, which writes them to `bin/sourcemaps/` with no `sourceMappingURL` comment. `'public'` restores the 2.7 behavior, `false` writes none. Tools that read maps from `bin/public` must read `bin/sourcemaps`.
- The page data (`window.ssr`, `window.routes`) is the last element of `<body>` instead of a script in `<head>`, so the parser reaches the content first. Entry and page chunks are `defer` and still find it; an inline `page.scripts` entry runs in `<head>` before it, so it must not read `window.ssr` at once (neither app does).
- `page.preload({ href, as, imagesrcset, imagesizes, fetchpriority, type, crossorigin, media })` links a resource in `<head>` (the LCP picture), and `preloadFonts` in `proteum.config.ts` preloads the named fonts on every page by their hashed path from `client-manifest.json` (an unknown name fails the build). Both are mirrored in the answer's `Link` header, which Cloudflare sends as a 103 Early Hint.

## 2.7.0 (2026-11-12)

- Security headers on every answer of Proteum's stack: helmet now runs first in `HttpServer.start()`, before the `/api` fast path, so answers under `/api` carry the base headers and no `X-Powered-By`. Under `/api`, HTML gets the app policy, other answers helmet's default policy, and a 304 none; outside `/api` every router answer keeps the app policy as before, and a route's own policy still wins. `http.csp` gains `directives`, `policy` and `reportOnly` (sent wherever the app policy goes), and a malformed policy now fails at boot. Nothing to change in apps to keep today's policy. See [http-security-headers.md](http-security-headers.md).
- Client assets (the changes committed as 2.6.1, never published on their own): production entry files, entry and page CSS and fonts are named with a content hash and served immutable, responsive images are served immutable, a `/public` 404 answers `Cache-Control: no-store`, and a page reloads once per build when a deploy removed a chunk it needs. Code or tests that name `client.js`, `client.css`, `runtime.js`, `framework.js` or `vendors.js` must read the names from the manifest. See [client-assets.md](client-assets.md).
