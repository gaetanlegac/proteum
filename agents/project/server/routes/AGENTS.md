# Server routes

Use `/server/routes/**` only for explicit custom routes that should not be generated from controllers.

- Callable app APIs belong in `/server/controllers/**/*.ts`
- `/server/routes/**` is for manual `Router.get/post/...` routes, redirects, resources, OAuth callbacks, etc.
- If a route needs a curated list or registry, keep server-only data in `/server/catalogs/**` and shared data in `/common/catalogs/**`

## Generate absolute urls

The absolute urls are generated via `Router.url()`:

`const absoluteUrl = Router.url('/relative/path')`
