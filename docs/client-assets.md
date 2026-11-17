# Client assets: names, caching and stale builds

## File names

| Output | Dev | Production |
| --- | --- | --- |
| Entry JS (`runtime`, `framework`, `vendors`, `client`) | `[name].js` | `[name].[contenthash:8].js` |
| Async JS chunks | `[name].js` | `[id].[contenthash:8].js` |
| Entry and page CSS | `[name].css` | `[name].[contenthash:8].css` |
| Fonts | `fonts/[name].[contenthash:8][ext]` | `fonts/[name].[contenthash:8][ext]` |
| Images (responsive-loader, production) | | `<hash>-<width>.<ext>` |
| Other modules | `[hash][ext]` | `[hash][ext]` |

Sources: `cli/compiler/client/outputNames.ts` and `cli/compiler/common/files/*.ts`. Entries, CSS and fonts carry a hash since 2.6.1.

Pictures: `avif`, `bmp`, `gif`, `svg` and `webp` imports are asset modules (inlined under 4 KB, else a URL); in production a `jpg` or `png` import is responsive-loader's object with its `srcSet`, and `ico` is always a file of its own. AVIF since 2.8: Express 4's type table does not know it, so the `/public` handler sets `image/avif` itself (any case of the extension).

## Source maps

| `sourceMaps` in `proteum.config.ts` | Production client maps |
| --- | --- |
| `'hidden'` (default) | `bin/sourcemaps/<file>.map`, no `sourceMappingURL` comment: kept for error reports and profiling tools, never served |
| `'public'` | `bin/public/<file>.map` with the comment, as before 2.8 |
| `false` | none |

Dev keeps `eval-cheap-module-source-map`. Source: `getClientSourceMapOptions` in `cli/compiler/client/outputNames.ts`. The server bundle keeps its own maps in `bin/`, outside `public/`.

## Compression

`proteum build` ends by writing a Brotli 11 twin beside every `.js`, `.css`, `.svg` and `.json` of `bin/public` (`cli/compiler/common/precompress.ts`, node's zlib, one worker thread per core), after the identity assets are written. A twin that is not smaller than its file is not written. Links are not followed.

`/public` is served by `express.static` behind `server/services/router/http/precompressed.ts`, which lists the twins when the server starts (production profile only; links not followed, unreadable folders skipped). A GET or HEAD for a file with a twin, from a client that accepts `br` (`q=0` refused in any casing, `*` accepted), is answered with the twin: `Content-Encoding: br`, the type of the original file, its cache policy, and its own ETag. Every answer for a file with a twin carries `Vary: Accept-Encoding`. Anything else goes on unchanged: `compression()` may still compress it on the fly (br at level 4, or gzip), and a twin removed after the start, a POST or a malformed URL answer as without twins. A file added to `bin/public` after the start is served without a twin; a file edited there keeps its old twin, so edit the build output only by rebuilding. Custom rather than the `express-static-gzip` package, whose lookup mishandles each of those cases and whose start-up walk stops the boot on a broken link.

Nothing may name these files by hand. The server reads every entry and page asset from `client-manifest.json` (written after each client build by `cli/compiler/common/clientManifest.ts`), and the document renders the tags from it.

## What the client bundle leaves out

- `preact/debug` is required only under `if (__DEV__ && window.dev)` (`client/app/index.ts`). The bundler folds `__DEV__` to `false` in production and drops the require; a test bundles that line both ways (`tests/client-preact-debug.test.cjs`).
- The generated API client (`.proteum/common/controllers.ts`, from `cli/compiler/artifacts/controllers.ts`) writes out local controllers leaf by leaf, but gives each connected project one node, `createConnectedControllerNode(api, namespace, literal)` (`common/router/request/connectedControllers.ts`). Reading a property returns the next node (the same one on every read); calling one posts to `/api/<accessor with slashes>` with its `connected` target, the request the written leaf built when called as typed (an argument given to an action without input is now sent as `data`). The generator writes a connected leaf out (in `literal`, which wins) only when its `httpPath` is not that path or a segment of its accessor is a key the node reserves: `then`, `toJSON`, `arguments` and `caller` (answered `undefined`, so a node is never awaited as a promise or serialised), and the names of `Function.prototype` and `Object.prototype` (answered as the function, so `String(node)`, `node + ''` or `node.hasOwnProperty(...)` never builds a fetcher). A branch under a reserved key is served as the plain object written out. What changes for code that inspects a node: it is a function (`typeof` says so), it lists no keys (spreading or enumerating gives nothing, `in` answers false), and a misspelt path is callable and fails at Product as a 404, not as a `TypeError`. The root stays a plain object, so apps can spread it into the router context. The types still catch drift: the generated file keeps every connected leaf as types only (`TConnectedContract_<namespace>`) and checks them against the connected types both ways (`TConnectedContractCheck_<namespace>`), so an action on one side only, or a leaf that takes input typed `() =>`, fails the app's typecheck as the written tree did. An accessor that is both an action and the parent of another fails the generator.

## The document

`server/services/router/response/page/document.tsx` renders, in this order:

- `<head>`: charset and viewport, then the preloads, then the icons, title, canonical, `page.head`, the stylesheets, the entry scripts and page chunks (`defer`, or `async` when a `page.scripts` entry asks), inline `page.scripts`, the JSON-LD.
- `<body>`: the page HTML, then one inline script with `window.ssr` and `window.routes` (and `window.dev` in dev). The JSON in it, and in the JSON-LD, has `<`, U+2028 and U+2029 escaped (`escapeInlineJson`), so no value can close the script. The client hydrates `<body>`; Preact leaves that trailing script alone. A script that reads `window.ssr` must be `defer` or come after it: an inline `page.scripts` entry runs before it.

Preloads:

- `preloadFonts: ['figtree-latin']` in `proteum.config.ts` names fonts by their source file name without extension. The client build writes their hashed paths to `client-manifest.json` (`preloadFonts`, woff2 preferred, then woff, then ttf) and `proteum build` fails on a name it did not emit in one of those formats, or that two source files share. Every page links them with `as="font"`, their type and `crossorigin="anonymous"`.
- `page.preload({ href, as, type, crossorigin, imagesrcset, imagesizes, fetchpriority, media })` (from `render` or `data`) adds the page's own, for its LCP picture mostly: pass the `srcset` and `sizes` of the `<img>`, so the browser fetches the same file.
- Fonts first, then the page's preloads in call order; a second preload of the same `as` and `href` is dropped. Each one is mirrored in the `Link` response header (`</public/fonts/…woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous`), after any `Link` the route set, so a CDN can send them as a 103 Early Hint. A preload that is not printable ASCII stays in the HTML only.

## Cache headers

`/public` files are served by the router with `cache.publicAssets` (`server/services/router/http/cache.ts`):

- `versioned` (default `public, max-age=31536000, immutable`): a file whose name ends in `.<hex hash>.<ext>` or `<hex hash>-<width>.<ext>`, or a request with `?v=`. In production this covers every entry, chunk, stylesheet, font and responsive image the build emits.
- `unversioned` (default `public, max-age=0, must-revalidate`): any other file, mostly what the app ships in its own `public/` folder (icons, Open Graph images, videos).
- `dev` (default `no-store`).
- A `/public` 404 is always `no-store`, so a CDN never keeps a 404 for a file that a newer instance serves.

A CDN can rewrite these headers. Cloudflare's zone setting Browser Cache TTL, for example, raises any lower `max-age` to its value (4 hours by default) unless it is set to "Respect Existing Headers". Hashed names make that harmless for the files the HTML names; an app that wants the unversioned files never cached can set `unversioned` to `no-store`.

## HTML caching

Two layers, both per route, in `server/services/router/index.ts`.

The page cache (`static: { urls, refresh, maxEntries }`) keeps rendered pages in the process (`router.cache`, a plain object keyed by path, query string ignored):

- `urls` lists the paths rendered at boot and stored. `['*']` stores any path the route matches when it first renders, and keeps the `maxEntries` (a positive integer, default 100, `server/services/router/pageCache.ts`) least recently served or re-rendered; the key order of `router.cache` is that LRU order.
- Only a render every visitor could get is stored (`server/services/router/sharedRender.ts`): a 200 to a GET with no signed-in user, no query string at all (`?=x` and a bare `?` included), no body and no file, on the app's own protocol and host (`currentDomain`; a forged `Host` or `X-Forwarded-Host` would go into the canonical). The page data written into the page carries the request's data and URL, and every later visitor of the path gets the stored copy.
- A hit is answered from the stored copy, after the routes marked `whenStatic` ran. Once the copy is older than `refresh` (default 1 hour), the hit still answers it and starts a background render through `router.renderStatic`, which an app may wrap: one per path at a time, at most 4 started by hits at once, and none for 5 minutes after one failed. The hourly sweep re-renders every expired page, sharing the per-path guard. A render that answers 5xx, throws or takes over 60 s leaves the stored copy in place; a 404 or 410 removes it.
- A hit sends the `Link` header of the stored document's preloads, read back from its `<link rel="preload">` tags.
- `router.renderStatic` without stored HTML renders over loopback (`http://127.0.0.1:<port>`), with the public host and protocol in `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto`, so no CDN or other instance answers it and the page keeps its public canonical. It sends `bypasscache: 1`, which the router honours on a loopback connection only: from anywhere else the header is ignored and the stored copy is answered. It does not follow a redirect: a 3xx keeps the stored copy, so a page behind a sign-in redirect never stores the sign-in page.

The edge cache (`edgeCache: { maxAge, staleWhileRevalidate }`, seconds or a duration such as `'1 hour'`) tells a CDN it may keep the answer: a 200 to GET or HEAD, stored or freshly rendered, for a visitor who is not signed in and whose answer set no `Cache-Control` of its own (in any letter case, in its headers or on the Express response), is sent `Cache-Control: public, max-age=0, s-maxage=<maxAge>, stale-while-revalidate=<staleWhileRevalidate>`, with no `Surrogate-Control` and no `Expires`. Browsers still revalidate each time. An answer that carries `Set-Cookie` is refused, whether the cookie is there when the policy is set or arrives later in any way (`res.cookie`, `setHeader`, the prototype's `setHeader`, a listener that writes it with the headers, or the headers given to `writeHead`: the HTTP server's first middleware wraps `writeHead` innermost and checks once more before the headers leave): it is sent `private, no-store` with `Surrogate-Control: no-store`, and the router logs the cookie names, because a CDN would store one visitor's cookie with the page. Any other answer (404, 503, a redirect, a route without `edgeCache`) keeps the default HTML policy. A malformed value fails the route registration. A stored hit takes the policy of the first HTML route, by priority, whose path matches. The `response.send` trace event records the decision (`edgeCache: 'applied' | 'refused-cookie' | 'not-cacheable'`), and a stale hit shows as `cache.hit` with `cachePhase: 'stale'`.

The edge does not purge itself: an app that caches HTML at the edge purges its CDN at each deploy, because a cached page names the previous build's hashed files.

## Stale builds

A tab opened before a deploy runs the previous build. When it navigates to a page whose chunk the deploy removed, the chunk request fails with a `ChunkLoadError` (or a CSS chunk error). The client router then reloads the page once (`client/app/staleBuild.ts`): the new HTML names the new hashed files, so the reload runs the new build.

- One reload per build id, remembered in `sessionStorage` under `proteum:stale-build-reload` (every build id that reloaded, so two builds answering during a rollout reload once each). If the same build misses a chunk again, or `sessionStorage` is unavailable, the router calls the app's `handleUpdate()` and throws "A new version of the website is available. Please refresh the page.", as it does for any other route load failure.
- A route chunk that loads clears the list, so a reload spent on a network blip does not take the recovery away from a real deploy later in the same tab.
- Offline (`navigator.onLine === false`) a failed chunk is the network: no reload, the error shows.
- A route module that loaded but failed for another reason never reloads; it goes straight to `handleUpdate()`.
- `handleUpdate()` should not reload on its own without a guard: the router has already made the one reload, and an unguarded second one can loop.
