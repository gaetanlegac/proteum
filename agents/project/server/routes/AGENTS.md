# Server routes

Use `/server/routes/**` only for explicit custom routes that should not be generated from controllers.

- Callable app APIs belong in `*.controller.ts` files under `/server/services`
- `/server/routes/**` is for manual `Router.get/post/...` routes, redirects, resources, OAuth callbacks, etc.

## Generate absolute urls

The absolute urls are generated via `Router.url()`:

`const absoluteUrl = Router.url('/relative/path')`
