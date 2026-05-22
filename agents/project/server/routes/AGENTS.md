# Route Contract

This is the canonical route-area contract for Proteum-based projects.
Role: keep only manual-route rules here.
Keep here: explicit HTTP route guidance, public/crawlable endpoint rules, absolute URL generation, and route-specific catalog placement.
Do not put here: controller contracts, service-layer business logic, page SSR rules, or broad project workflow already defined elsewhere.

Optimization source of truth: root-level `optimizations.md`.
Diagnostics source of truth: root-level `diagnostics.md`.

- Use `server/routes/**` only for explicit HTTP behavior that should not be generated from controllers.
- If the endpoint is a normal app API, prefer `server/controllers/**/*.ts`.
- Good fits include redirects, resources, OAuth callbacks, webhooks, sitemap-like output, and custom public endpoints.
- Route files default-export `defineServerRoute({ method, path, options, handler })` or `defineServerRoutes([...])`.
- Keep `method`, `path`, and `options` static. Runtime services are received through the route factory or handler context.
- Do not import `@app` in route files. Use `defineServerRoutes((app) => [...])` when routes need app services.
- Use `expressHandler(...)` only when a route needs raw Express `req`, `res`, or `next`.
- If a route needs a curated registry, keep server-only data in `/server/catalogs/**` and shared data in `/common/catalogs/**`.

Example route file; replace `ProjectApp` with the concrete app type exported from `server/index.ts`.

```ts
import { defineServerRoute, defineServerRoutes, expressHandler } from '@common/router/definitions';
import type { ProjectApp } from '@/server/index';

export default defineServerRoutes((app: ProjectApp) => [
    defineServerRoute({
        method: 'GET',
        path: '/health',
        options: {},
        handler: ({ response }) => response.json({ ok: true }),
    }),
    defineServerRoute({
        method: 'POST',
        path: '/webhook',
        options: {},
        handler: expressHandler((request, response) => {
            app.Webhooks.handle(request.body);
            response.status(204).send('');
        }),
    }),
]);
```

## Absolute URLs

Use `context.Router.url('/relative/path')` inside handlers, or `app.Router.url('/relative/path')` inside `defineServerRoutes((app) => ...)`, to generate absolute URLs.
