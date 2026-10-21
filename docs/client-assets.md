# Client assets: names, caching and stale builds

## File names

| Output | Dev | Production |
| --- | --- | --- |
| Entry JS (`runtime`, `framework`, `vendors`, `client`) | `[name].js` | `[name].[contenthash:8].js` |
| Async JS chunks | `[name].js` | `[id].[contenthash:8].js` |
| Entry and page CSS | `[name].css` | `[name].[contenthash:8].css` |
| Images and other modules | `[hash][ext]` | `[hash][ext]` |

Source: `cli/compiler/client/outputNames.ts`. Entries carry a hash since 2.6.1.

Nothing may name these files by hand. The server reads every entry and page asset from `client-manifest.json` (written after each client build by `cli/compiler/common/clientManifest.ts`), and the document renders the tags from it.

## Cache headers

`/public` files are served by the router with `cache.publicAssets` (`server/services/router/http/cache.ts`):

- `versioned` (default `public, max-age=31536000, immutable`): a file whose name ends in `.<hex hash>.<ext>`, or a request with `?v=`. In production this covers every entry, chunk and stylesheet the HTML names.
- `unversioned` (default `public, max-age=0, must-revalidate`): any other file, such as icons or fonts served under their own name.
- `dev` (default `no-store`).
- A `/public` 404 is always `no-store`, so a CDN never keeps a 404 for a file that a newer instance serves.

A CDN can rewrite these headers. Cloudflare's zone setting Browser Cache TTL, for example, raises any lower `max-age` to its value (4 hours by default) unless it is set to "Respect Existing Headers". Hashed names make that harmless for the files the HTML names; an app that wants the unversioned files never cached can set `unversioned` to `no-store`.

## Stale builds

A tab opened before a deploy runs the previous build. When it navigates to a page whose chunk the deploy removed, the chunk request fails with a `ChunkLoadError` (or a CSS chunk error). The client router then reloads the page once (`client/app/staleBuild.ts`): the new HTML names the new hashed files, so the reload runs the new build.

- One reload per build id, remembered in `sessionStorage` under `proteum:stale-build-reload`. If the same build misses a chunk again, or `sessionStorage` is unavailable, the router calls the app's `handleUpdate()` and throws "A new version of the website is available. Please refresh the page.", as it does for any other route load failure.
- A route module that loaded but failed for another reason never reloads; it goes straight to `handleUpdate()`.
- `handleUpdate()` should not reload on its own without a guard: the router has already made the one reload, and an unguarded second one can loop.
