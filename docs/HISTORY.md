# History

Notable framework changes, newest first. Commit messages hold the rest.

## Unreleased

- Security headers on every answer of Proteum's stack: helmet now runs first in `HttpServer.start()`, before the `/api` fast path, so answers under `/api` carry the base headers and no `X-Powered-By`. Under `/api`, HTML gets the app policy, other answers helmet's default policy, and a 304 none; outside `/api` every router answer keeps the app policy as before, and a route's own policy still wins. `http.csp` gains `directives`, `policy` and `reportOnly` (sent wherever the app policy goes), and a malformed policy now fails at boot. Nothing to change in apps to keep today's policy. See [http-security-headers.md](http-security-headers.md).
