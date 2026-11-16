# History

Notable framework changes, newest first. Commit messages hold the rest.

## 2.8.0 (unreleased)

Page weight and first byte for public pages. Nothing to change in apps to keep today's behavior, except where a line says so. See [client-assets.md](client-assets.md).

- Production pages no longer ship `preact/debug`: the client entry loads it only when `__DEV__` and `window.dev` are both true.
- The generated API client builds one Proxy node per connected project instead of writing out every connected leaf (the website: 417 leaves, 84 KB of every page). A connected leaf is `POST /api/<accessor with slashes>`; a leaf whose path differs, or whose accessor uses a key a node reserves (`then`, `toJSON`, `toString`, `call`…), stays written out. Local controllers and the `TControllers` type are unchanged. Code that enumerates a connected node (`Object.keys(context.Product)`) now sees nothing.

## 2.7.0 (2026-11-12)

- Security headers on every answer of Proteum's stack: helmet now runs first in `HttpServer.start()`, before the `/api` fast path, so answers under `/api` carry the base headers and no `X-Powered-By`. Under `/api`, HTML gets the app policy, other answers helmet's default policy, and a 304 none; outside `/api` every router answer keeps the app policy as before, and a route's own policy still wins. `http.csp` gains `directives`, `policy` and `reportOnly` (sent wherever the app policy goes), and a malformed policy now fails at boot. Nothing to change in apps to keep today's policy. See [http-security-headers.md](http-security-headers.md).
- Client assets (the changes committed as 2.6.1, never published on their own): production entry files, entry and page CSS and fonts are named with a content hash and served immutable, responsive images are served immutable, a `/public` 404 answers `Cache-Control: no-store`, and a page reloads once per build when a deploy removed a chunk it needs. Code or tests that name `client.js`, `client.css`, `runtime.js`, `framework.js` or `vendors.js` must read the names from the manifest. See [client-assets.md](client-assets.md).
