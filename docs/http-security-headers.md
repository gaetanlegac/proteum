# HTTP Security Headers

Proteum's HTTP server sends the same security headers on every answer, whatever the path, and picks the Content-Security-Policy by the kind of answer, at the moment the headers are written.

Source: `server/services/router/http/index.ts` (`HttpServer.start()`) and `server/services/router/http/securityHeaders.ts`. Tests: `tests/http-server-security-headers.test.cjs`.

## The Contract

| Answer | Base headers | `Content-Security-Policy` | Report-only policy | `X-Powered-By` |
|---|---|---|---|---|
| HTML or a script from the router, outside `/api` (pages, their 404, the error page, a cached static page, a worker a route serves) | yes | the app policy | the app's, when configured | absent |
| HTML or a script from the router under `/api` (pages, their 404, the error page, a cached static page) | yes | the app policy | the app's, when configured | absent |
| Any other answer from the router (JSON, Markdown, text, feeds, images, most redirects) | yes | helmet's default policy | none | absent |
| A 304 Not Modified from the router | yes | none: the browser keeps the policy its stored copy came with | none | absent |
| A route or controller that set its own `Content-Security-Policy` | yes | the route's own, untouched | none added | absent |
| An error that escapes the router to Express (for example a malformed JSON body under `/api`) | yes | Express's own `default-src 'none'` | none | absent |
| Static files (`/public/*`, `/robots.txt`, `/favicon.ico`), `/ping` | yes | helmet's default policy | none | absent |

"HTML or a script" means a `Content-Type` of `text/html`, `application/xhtml+xml`, or JavaScript (`text/javascript`, `application/javascript` and their `x-` and `ecmascript` forms). Scripts are included because a worker runs under the policy of its own answer: a worker served by a route with helmet's default policy could not fetch from another host.

"Base headers" are helmet 4.6's defaults: `Strict-Transport-Security: max-age=15552000; includeSubDomains`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`, `Expect-CT: max-age=0`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0`. `http.helmet` changes them (for example `referrerPolicy`). helmet 4.6 sends no `Cross-Origin-*` header, and the tests pin that.

helmet's default policy is `default-src 'self';base-uri 'self';block-all-mixed-content;font-src 'self' https: data:;frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests` (256 bytes). `http.helmet.contentSecurityPolicy` replaces it; with `false`, other answers carry no policy, and HTML and scripts still get the app policy.

How it is wired:

- `x-powered-by` is disabled on the Express app, and `helmet(http.helmet)` is mounted once, at the very top, so every answer starts with the base headers and helmet's default policy.
- A policy writer runs when the headers are about to be written, so it knows the final status and `Content-Type`:
  - when the `Content-Security-Policy` value is no longer the one helmet wrote, a route chose its own: everything is left as it is;
  - when the status is 304: the policy header is removed, so the browser keeps the policy of the copy it stored (helmet's default there would replace the page's policy);
  - when the answer is HTML or a script: the app policy, plus the report-only policy when one is configured and the route did not set one;
  - otherwise: helmet's default stays.
- The writer is mounted twice: for `/api` before the API fast path (the short middleware stack `/api` requests take, ahead of the static files), and for every other path after the static files. So static files keep helmet's headers byte for byte, an `.html` or `.js` file under `/public` included.

Rule: a route's own policy wins. A route or controller that sets `Content-Security-Policy` itself (for example a strict policy with a nonce) keeps it, under `/api` or anywhere else, and no report-only header is added to it.

## Config

`http.csp` in the app's router config, required. All header strings are built once, at boot: a config the checks below refuse fails the boot with an `[http.csp]` error, never a broken header on a response.

The list form (`scripts` is required, an empty array is fine):

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

    // A second complete policy, sent as Content-Security-Policy-Report-Only beside the enforced one.
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
        'style-src': ["'self'", "'unsafe-inline'"],
        'frame-ancestors': ["'self'"],
    },
    reportOnly: { policy: { 'default-src': ["'self'"] }, reportUri: '/csp-report' },
},
```

`reportUri` is appended to the report-only policy only, as `report-uri <value>`. The enforced policy gets a report address only from a `report-uri` entry in `directives` or `policy`.

In dev, Proteum's client build uses eval source maps and its reload channel listens on another port: when you write `policy`, or a `default-src` or `connect-src`, add `'unsafe-eval'` to `script-src` and the dev event address (`http://localhost:<port>`) to `connect-src` in the dev profile.

Boot errors:

- `csp` absent or not an object; the list form without `scripts`;
- `policy` together with `scripts`, `styles`, `images`, `default` or `directives`;
- `directives` naming `default-src`, `script-src`, `style-src` or `img-src` (the lists own them, filled or not);
- a directive name that is not a CSP 3 directive (`frameAncestors` and `frame-ancestor` are refused, write `'frame-ancestors'`);
- a directive with no source, except `upgrade-insecure-requests` and `block-all-mixed-content` (which take none and refuse any), `sandbox` and `trusted-types` (which may be empty);
- a source that is not a string, is empty, or holds anything but printable ASCII with no whitespace, `;` or `,` (write international hosts in punycode);
- in `directives`, `policy` and `reportOnly.policy`: a bare keyword (`self`, `none`, `unsafe-inline`, `unsafe-eval`, `unsafe-hashes`, `strict-dynamic`, `report-sample`, `wasm-unsafe-eval`) that would name a host, and a source with unbalanced single quotes;
- an empty `policy`, a `reportOnly` without `policy` or with an empty one, a `reportUri` that is empty or not printable ASCII, and `reportUri` together with a `report-uri` entry in `reportOnly.policy`.

The four lists keep their 2.6 leniency: an entry holding several sources separated by spaces still writes the same header, and bare keywords are not checked there.

## Migration From 2.6

Nothing to change to keep today's page policy: the four lists produce the same header, byte for byte. What changes by itself:

- answers under `/api` now carry the base headers and no `X-Powered-By`; HTML and scripts there get the app policy, other answers helmet's default policy (256 bytes on each API answer);
- non-HTML, non-script router answers outside `/api` (`.md`, `llms.txt`, feeds, text, JSON) now carry helmet's default policy instead of the app policy; a policy has no effect on them;
- a 304 from the router no longer carries a policy;
- connected-project answers (`/api/__proteum/connected/*`) now carry the base headers too, and the policy by their kind like any other answer;
- a list entry with a character Node cannot put in a header (a typographic quote, a non-ASCII host) now stops the boot instead of failing each response.

A redirect sent from the router's static page cache is typed `text/html` by Express and so carries the app policy; other router redirects carry helmet's default.

To add `frame-ancestors`, `object-src` and `base-uri`, add `csp.directives`. To trial a stricter policy, add `csp.reportOnly`; to enforce it, move it to `csp.policy`.
