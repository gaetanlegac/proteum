# History

Notable framework changes, newest first. Commit messages hold the rest.

## Unreleased

- Security headers on every answer: helmet now runs before the `/api` fast path, so answers under `/api` carry the base headers and no `X-Powered-By`. HTML and scripts from the router get the app policy, `/api` included; other answers carry helmet's default policy (outside `/api` too, where they used to carry the app policy); a 304 carries none, and a route's own policy still wins. `http.csp` gains `directives`, `policy` and `reportOnly`, and a malformed policy now fails at boot. Pages keep today's policy with no change in apps. See [http-security-headers.md](http-security-headers.md).
