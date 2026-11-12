# HTTP Security Headers

Proteum's HTTP server sends the same security headers on every answer, whatever the path, and decides the Content-Security-Policy by the kind of answer, when the headers are written.

Source: `server/services/router/http/index.ts` (`HttpServer.start()`) and `server/services/router/http/securityHeaders.ts`. Tests: `tests/http-server-security-headers.test.cjs`.

## The Contract

| Answer | Base headers | `Content-Security-Policy` | `-Report-Only` | `X-Powered-By` |
|---|---|---|---|---|
| HTML from the router, outside `/api` (pages, their 404, the error page, a cached static page) | yes | the app policy | the app's, when configured | absent |
| HTML from the router under `/api` (pages, their 404, the error page) | yes | the app policy | the app's, when configured | absent |
| Non-HTML from the router, anywhere (JSON, Markdown, text, redirects, feeds) | yes | helmet's default policy | none | absent |
| A route that set its own `Content-Security-Policy` | yes | the route's own, untouched | none added | absent |
| Static files (`/public/*`, `/robots.txt`, `/favicon.ico`), `/ping` | yes | helmet's default policy | none | absent |

"Base headers" are helmet 4.6's defaults: `Strict-Transport-Security: max-age=15552000; includeSubDomains`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`, `Expect-CT: max-age=0`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0`. `http.helmet` changes them (for example `referrerPolicy`). helmet 4.6 sends no `Cross-Origin-*` header, and the tests pin that.

How it is wired:

- `x-powered-by` is disabled on the Express app, and `helmet(http.helmet)` is mounted once, before the `/api` fast path, so every answer starts with the base headers and helmet's default policy.
- A policy writer runs when the headers are about to be written, so it knows the final `Content-Type`:
  - when the `Content-Security-Policy` value is no longer the one helmet wrote, a route chose its own: everything is left as it is;
  - when the answer is `text/html`: the app policy, plus the report-only policy when one is configured and the route did not set one;
  - otherwise: helmet's default stays.
- The writer is mounted for `/api` before the fast path, and for every other path after the static files, so static files keep helmet's headers byte for byte (an `.html` file under `/public` included).

Rule: a route's own policy wins. A controller that sets `Content-Security-Policy` itself (for example a strict policy with a nonce) keeps it, under `/api` or anywhere else.

## Config

`http.csp` in the app's router config. All header strings are built once, at boot: a malformed config fails the boot with an `[http.csp]` error, never a broken header in production.

```ts
csp: {
    // The four historical lists, unchanged. Proteum adds `'unsafe-inline' 'self' 'unsafe-eval'` to the scripts,
    // and sends no `default-src` when `default` is empty.
    scripts: ['cdn.example.com'],
    styles: ["'self'", "'unsafe-inline'"],
    images: ["'self'", 'data:', 'https:'],
    default: [],

    // More enforced directives, by their real names, appended after the lists.
    directives: {
        'frame-ancestors': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
    },

    // A second complete policy, sent as Content-Security-Policy-Report-Only on HTML answers only.
    reportOnly: {
        policy: { 'default-src': ["'self'"], 'connect-src': ["'self'", 'api.example.com'] },
        reportUri: '/csp-report',
    },
},
```

Or a complete enforced policy, written in full by the app (Proteum adds nothing, so no silent `'unsafe-eval'`):

```ts
csp: {
    policy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'frame-ancestors': ["'self'"],
    },
    reportOnly: { policy: { 'default-src': ["'self'"] }, reportUri: '/csp-report' },
},
```

Boot errors:

- `policy` together with `scripts`, `styles`, `images`, `default` or `directives`;
- `directives` naming `default-src`, `script-src`, `style-src` or `img-src` (the lists own them, filled or not);
- a directive name that is not the real lowercase name (`frameAncestors` is refused, write `'frame-ancestors'`);
- a directive with no source, except `upgrade-insecure-requests`, `block-all-mixed-content` and `sandbox`;
- a source that is empty or holds whitespace, `;` or `,`; a value that is not an array;
- an empty `policy` or `reportOnly.policy`; `reportUri` together with a `report-uri` entry in `reportOnly.policy`.

## Migration From 2.6

Nothing to change to keep today's policy: the four lists produce the same header, byte for byte. What changes by itself:

- answers under `/api` now carry the base headers, no `X-Powered-By`, and, when they are HTML, the app policy;
- non-HTML router answers outside `/api` (`.md`, `llms.txt`, feeds, text) now carry helmet's default policy instead of the app policy; a policy does nothing on a non-document;
- connected-project answers (`/api/__proteum/connected/*`) now carry the base headers too, and the policy by their kind like any other answer.

To add the frame, plugin and base directives, add `csp.directives`. To trial a stricter policy, add `csp.reportOnly`; to enforce it, move it to `csp.policy`.
