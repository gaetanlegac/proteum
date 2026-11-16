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

Pictures: `avif`, `bmp`, `gif`, `ico`, `jpg`, `png`, `svg` and `webp` imports are asset modules (inlined under 4 KB, else a URL). AVIF since 2.8: Express 4's type table does not know it, so the `/public` handler sets `image/avif` itself.

## Source maps

| `sourceMaps` in `proteum.config.ts` | Production client maps |
| --- | --- |
| `'hidden'` (default) | `bin/sourcemaps/<file>.map`, no `sourceMappingURL` comment: kept for error reports and profiling tools, never served |
| `'public'` | `bin/public/<file>.map` with the comment, as before 2.8 |
| `false` | none |

Dev keeps `eval-cheap-module-source-map`. Source: `getClientSourceMapOptions` in `cli/compiler/client/outputNames.ts`. The server bundle keeps its own maps in `bin/`, outside `public/`.

## Compression

`proteum build` ends by writing a Brotli 11 twin beside every `.js`, `.css`, `.svg` and `.json` of `bin/public` (`cli/compiler/common/precompress.ts`, node's zlib), after the identity assets are written. A twin that is not smaller than its file is not written. Symlinks are skipped.

`/public` is served by `express-static-gzip` (2.x, on Express 4's serve-static): when the request accepts `br` and a twin exists, the answer is the twin with `Content-Encoding: br`, the type of the original file, its cache policy and `Vary: Accept-Encoding`; its ETag is the twin's own. Otherwise the file is answered as before and `compression()` compresses it on the fly for gzip. The twins are listed when the server starts: a file added to `bin/public` later is served without one.

Nothing may name these files by hand. The server reads every entry and page asset from `client-manifest.json` (written after each client build by `cli/compiler/common/clientManifest.ts`), and the document renders the tags from it.

## What the client bundle leaves out

- `preact/debug` is required only under `if (__DEV__ && window.dev)` (`client/app/index.ts`). The bundler folds `__DEV__` to `false` in production and drops the require; a test bundles that line both ways (`tests/client-preact-debug.test.cjs`).
- The generated API client (`.proteum/common/controllers.ts`, from `cli/compiler/artifacts/controllers.ts`) writes out local controllers leaf by leaf, but gives each connected project one node, `createConnectedControllerNode(api, namespace, literal)` (`common/router/request/connectedControllers.ts`). Reading a property returns the next node; calling one posts to `/api/<accessor with slashes>` with its `connected` target, as the written leaf did. The generator writes a connected leaf out (in `literal`, which wins) only when its `httpPath` is not that path or a segment of its accessor is a key the node reserves: `then` and `toJSON` (answered `undefined`, so a node is never awaited as a promise or serialised), `arguments`, `caller`, and the names of `Function.prototype` (answered as the function, so `String(node)` never calls a controller). A node lists no keys: spreading or enumerating it gives an empty object. The root stays a plain object, so apps can spread it into the router context.

## The document

`server/services/router/response/page/document.tsx` renders, in this order:

- `<head>`: charset and viewport, then the preloads, then the icons, title, canonical, `page.head`, the stylesheets, the entry scripts and page chunks (`defer`, or `async` when a `page.scripts` entry asks), inline `page.scripts`, the JSON-LD.
- `<body>`: the page HTML, then one inline script with `window.ssr` and `window.routes` (and `window.dev` in dev). The client hydrates `<body>`; Preact leaves that trailing script alone. A script that reads `window.ssr` must be `defer` or come after it: an inline `page.scripts` entry runs before it.

Preloads:

- `preloadFonts: ['figtree-latin']` in `proteum.config.ts` names fonts by their source file name without extension. The client build writes their hashed paths to `client-manifest.json` (`preloadFonts`, woff2 preferred when several formats exist) and `proteum build` fails on a name it did not emit. Every page links them with `as="font"`, their type and `crossorigin="anonymous"`.
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

- `urls` lists the paths rendered at boot and stored. `['*']` stores any path the route matches when it first renders, and keeps the `maxEntries` least recently served (default 100, `server/services/router/pageCache.ts`); the key order of `router.cache` is that LRU order.
- A hit is answered from the stored copy, after the routes marked `whenStatic` ran. Once the copy is older than `refresh` (default 1 hour), the hit still answers it and starts one background render through `router.renderStatic`, which an app may wrap; the hourly sweep also re-renders expired pages. A render that answers anything but 200, throws or takes over 60 s leaves the stored copy in place.
- Only a 200 is stored. A hit sends the `Link` header of the stored document's preloads, read back from its `<link rel="preload">` tags.

The edge cache (`edgeCache: { maxAge, staleWhileRevalidate }`, seconds or a duration such as `'1 hour'`) tells a CDN it may keep the answer: a 200 to GET or HEAD, stored or freshly rendered, is sent `Cache-Control: public, max-age=0, s-maxage=<maxAge>, stale-while-revalidate=<staleWhileRevalidate>`, with no `Surrogate-Control` and no `Expires`. Browsers still revalidate each time. An answer that carries `Set-Cookie` when it is sent is refused: it keeps the default HTML policy (`no-store`) and the router logs the cookie names, because a CDN would store one visitor's cookie with the page. Any other answer (404, 503, a redirect, a route without `edgeCache`) keeps the default policy. A malformed value fails the route registration. The `response.send` trace event records the decision (`edgeCache: 'applied' | 'refused-cookie' | 'not-cacheable'`), and a stale hit shows as `cache.hit` with `cachePhase: 'stale'`.

The edge does not purge itself: an app that caches HTML at the edge purges its CDN at each deploy, because a cached page names the previous build's hashed files.

## Stale builds

A tab opened before a deploy runs the previous build. When it navigates to a page whose chunk the deploy removed, the chunk request fails with a `ChunkLoadError` (or a CSS chunk error). The client router then reloads the page once (`client/app/staleBuild.ts`): the new HTML names the new hashed files, so the reload runs the new build.

- One reload per build id, remembered in `sessionStorage` under `proteum:stale-build-reload` (every build id that reloaded, so two builds answering during a rollout reload once each). If the same build misses a chunk again, or `sessionStorage` is unavailable, the router calls the app's `handleUpdate()` and throws "A new version of the website is available. Please refresh the page.", as it does for any other route load failure.
- A route chunk that loads clears the list, so a reload spent on a network blip does not take the recovery away from a real deploy later in the same tab.
- Offline (`navigator.onLine === false`) a failed chunk is the network: no reload, the error shows.
- A route module that loaded but failed for another reason never reloads; it goes straight to `handleUpdate()`.
- `handleUpdate()` should not reload on its own without a guard: the router has already made the one reload, and an unguarded second one can loop.
