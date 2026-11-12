# History

Notable framework changes, newest first. Commit messages hold the rest.

## 2.7.0 (2026-11-12)

- Security headers on every answer of Proteum's stack: helmet now runs first in `HttpServer.start()`, before the `/api` fast path, so answers under `/api` carry the base headers and no `X-Powered-By`. Under `/api`, HTML gets the app policy, other answers helmet's default policy, and a 304 none; outside `/api` every router answer keeps the app policy as before, and a route's own policy still wins. `http.csp` gains `directives`, `policy` and `reportOnly` (sent wherever the app policy goes), and a malformed policy now fails at boot. Nothing to change in apps to keep today's policy. See [http-security-headers.md](http-security-headers.md).
- Client assets (the changes committed as 2.6.1, never published on their own): production entry files, entry and page CSS and fonts are named with a content hash and served immutable, responsive images are served immutable, a `/public` 404 answers `Cache-Control: no-store`, and a page reloads once per build when a deploy removed a chunk it needs. Code or tests that name `client.js`, `client.css`, `runtime.js`, `framework.js` or `vendors.js` must read the names from the manifest. See [client-assets.md](client-assets.md).
