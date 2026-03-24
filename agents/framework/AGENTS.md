# Proteum App Contract

This is the canonical framework contract for Proteum-based projects.

Local project `AGENTS.md` files should only add project-specific deltas. They should not restate the framework contract.

## Fast Start

When you enter a Proteum app, inspect it in this order:

1. Run `npx proteum explain --json` or read `./.proteum/manifest.json`.
2. Inspect `./server/index.ts` and `./server/config/*.ts`.
3. Inspect the touched `./server/controllers/**/*.ts`, `./server/services/**`, `./server/routes/**`, and `./client/pages/**` files.
4. Run `npx proteum doctor` if routing or generation looks suspicious.
5. For request-time issues in dev, use `npx proteum trace` before adding temporary logs.

## Non-Negotiable Rules

- Client pages live in `client/pages/**` and register routes with top-level `Router.page(...)` or `Router.error(...)` calls.
- Page URLs come from the explicit `Router.page('/path', ...)` call, not from the file path.
- Callable app APIs live only in `server/controllers/**/*.ts` files that extend `Controller`.
- Manual HTTP endpoints live in `server/routes/**`.
- Controllers validate input with `this.input(schema)` inside the method body.
- Call `this.input(...)` at most once per controller method.
- Request-scoped state exists only on `this.request` and router/manual-route context objects.
- SSR page data belongs in the page `setup` return object, not in `api.fetch(...)`.
- Normal service methods do not read request state directly.
- Do not import runtime values from `@models`.
- Do not use `@request` runtime globals.
- Do not use `@app` on the client.
- Do not edit generated files under `.proteum` by hand.
- Prefer type inference rooted in the explicit application graph in `server/index.ts`.

## Source Of Truth

Proteum reads these source files directly:

- `package.json`
- `identity.yaml`
- `env.yaml`
- `server/config/*.ts`
- `server/index.ts`
- `server/services/**/service.json`
- `server/controllers/**/*.ts`
- `server/routes/**/*.ts`
- `client/pages/**/*.ts(x)`
- `client/pages/**/_layout/index.tsx`
- `public/**`

Proteum generates and owns:

- `.proteum/manifest.json`
- `.proteum/client/*`
- `.proteum/common/*`
- `.proteum/server/*`

Project code should use:

- `@generated/client/*`
- `@generated/common/*`
- `@generated/server/*`
- `@/client/context` for the generated client context entrypoint

Use the structured CLI surfaces instead of re-deriving framework facts from source whenever possible:

- `npx proteum explain --json`: app structure, services, controllers, routes, layouts, diagnostics
- `npx proteum doctor --json`: manifest-backed diagnostics
- `npx proteum trace ...`: live dev-only request traces

## App Bootstrap And Services

`server/index.ts` is the canonical type root and the explicit application graph.

Rules:

- `server/index.ts` must default-export the app `Application` subclass
- root services are public class fields instantiated with `new ServiceClass(this, config, this)`
- typed root-service config lives in `server/config/*.ts` via `Services.config(ServiceClass, { ... })`
- router plugins are instantiated explicitly inside the `Router` config `plugins` object
- `server/services/**/service.json` plus `server/index.ts` drive generated service typings and manifest service entries

Service rules:

- business logic lives in classes that extend `Service`
- use `this.services`, `this.models`, and `this.app`
- keep auth, input parsing, locale, cookies, and request-derived values in controllers, then pass explicit typed arguments into services
- use subservices when a feature has multiple coherent domains and the root class is growing

## Controllers

Controller rules:

- files live under `server/controllers/**/*.ts`
- each file default-exports a class extending `Controller`
- methods with bodies become generated client-callable endpoints
- route path comes from the controller file path plus the method name
- `export const controllerPath = 'Custom/path'` can override the base path when needed
- generated client calls use `POST`

Controller workflow:

1. destructure the service or router helper you need
2. validate once with `this.input(schema)`
3. resolve auth and other request-derived values from `this.request`
4. pass explicit typed values into a service method

## Client Pages

Compiler rules:

- Proteum scans page files for top-level `Router.page(...)` and `Router.error(...)` calls
- the file path controls chunk identity and layout discovery
- the route path comes from the explicit string in `Router.page(...)`

Supported signatures:

```ts
Router.page('/path', render);
Router.page('/path', setup, render);
Router.page('/path', options, render);
Router.page('/path', options, setup, render);
```

For new work, prefer:

```ts
Router.page('/path', setup, render);
Router.page('/path', options, setup, render);
```

`setup` rules:

- return one flat object
- keys like `_auth`, `_layout`, `_static`, `_redirectLogged`, and other reserved setup keys are route options
- every other key is SSR data
- controller fetchers and promises are resolved before render
- plain values may also be returned

`render` rules:

- consume resolved setup data there
- use generated controller methods from the render args or `@/client/context`
- use `api.reload(...)` or `api.set(...)` only when intentionally mutating active page setup state

Error pages:

- use `Router.error(code, options, render)` in `client/pages/_messages/**`

## Client Context And Controller Calls

Use the generated client context entrypoint:

```ts
import useContext from '@/client/context';
```

Then call generated controllers directly:

```ts
const { Founder } = useContext();
await Founder.projects.updateProject(payload);
```

Use direct controller calls for interactions. Do not recreate fake runtime imports or client-side `@app` access.

## Manual Server Routes

Use `server/routes/**` only for explicit HTTP behavior that should not be a generated controller action.

Good fits:

- redirects
- sitemap or RSS
- OAuth callbacks
- webhooks
- public resources with custom semantics

Rules:

- import server-side app services from `@app`
- use route handler context for `request`, `response`, router plugins, and custom router context
- if the route is just a normal app API, prefer a controller instead

## Models And Aliases

Use Prisma typings from:

```ts
import type * as Models from '@models/types';
```

Use runtime models through:

- `this.models`
- `this.app.Models.client`

Rules:

- do not import runtime values from `@models`
- keep Prisma runtime access inside services when possible
- prefer explicit `select` or narrow `include`
- do not edit generated Prisma client files

Relevant aliases:

- `@/client/...`, `@/server/...`, `@/common/...`: app code
- `@client/...`, `@server/...`, `@common/...`: Proteum core modules
- `@app`: server-side application services for manual routes only
- `@generated/*`: generated app surfaces

## Task Playbooks

### Add A New App API

1. Add or extend a root service under `server/services/<Feature>/index.ts`.
2. Add or update `server/services/<Feature>/service.json`.
3. Add a controller under `server/controllers/**`.
4. Validate once with `this.input(schema)`.
5. Resolve auth and request-derived values in the controller.
6. Call the service from the client through the generated controller tree.

### Add A New SSR Page

1. Create or update `client/pages/.../index.tsx`.
2. Register `Router.page('/real-url', setup, render)`.
3. Return `_auth`, `_layout`, and SSR data from `setup`.
4. Read resolved data in `render`.
5. Use `@/client/context` or render args only for interactive follow-up actions.

### Add A New Manual Route

1. Create `server/routes/...`.
2. Import `Router` and needed app services from `@app`.
3. Register `Router.get/post/put/patch/delete(...)`.
4. Return response helpers or raw serializable data.

### Diagnose A Runtime Issue

1. Run `npx proteum explain --json`.
2. Run `npx proteum doctor`.
3. If the issue is request-time behavior in dev, run:
   - `npx proteum trace arm --capture deep`
   - reproduce the failing request once
   - `npx proteum trace latest` or `npx proteum trace show <requestId>`
4. Inspect the touched controller, service, route, or page source.
5. Only add temporary logging if the trace is insufficient.

For the full trace reference, see `node_modules/proteum/docs/request-tracing.md` in installed apps or `docs/request-tracing.md` in the framework repository.

## Preferred Patterns

- explicit `server/index.ts` bootstrap over hidden registration
- `Router.page(path, setup, render)` over page-local fetch hacks
- controller-backed app APIs over ad hoc manual `/api/...` route files
- service classes over random server helpers with hidden dependencies
- one canonical source of truth for catalogs, registries, and shared types
- project-local Shadcn-based UI primitives when the app already provides them

## Discouraged Patterns

- `api.fetch(...)` inside page files for SSR loading
- client-side `@app` imports
- runtime `@models` imports
- request-scoped state inside normal service methods
- hiding route registration behind abstractions that remove the top-level `Router.page(...)` call
- editing `.proteum` directly

## Verification

Verify at the correct layer:

- route additions: boot the app and hit the real URL
- controller changes: exercise the generated client call or the generated `/api/...` endpoint
- SSR changes: load the real page and inspect rendered HTML plus browser console
- router/plugin changes: verify request context, auth, redirects, metrics, and validation on a running app

Useful app commands:

- `proteum dev`
- `npx proteum refresh`
- `npx proteum typecheck`
- `npx proteum lint`
- `npx proteum check`
- `npx proteum build prod`
