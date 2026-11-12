# History

Notable framework changes, newest first. Commit messages hold the rest.

## Unreleased

- Security headers on every answer: helmet now runs before the `/api` fast path, so answers under `/api` carry the base headers and no `X-Powered-By`; HTML answers get the app policy wherever they are served, other answers keep helmet's default policy, and a route's own policy still wins. `http.csp` gains `directives`, `policy` and `reportOnly`; the four old lists keep producing the same header, and a malformed policy now fails at boot. Nothing to change in apps to keep today's policy. See [http-security-headers.md](http-security-headers.md).
