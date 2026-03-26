# Proteum App Contract

This is the canonical contract for Proteum-based projects. Local project `AGENTS.md` files should add deltas only, not restate these rules.

## First Pass

Inspect apps in this order:

1. Run `npx proteum explain --json` or read `./.proteum/manifest.json`.
2. Inspect `./server/index.ts`, `./server/config/*.ts`, and the touched files under `./commands`, `./server/controllers`, `./server/services`, `./server/routes`, and `./client/pages`.
3. Run `npx proteum doctor` if routing or generation looks suspicious.
4. For request-time issues in dev, read the default port from `PORT` or `./.proteum/manifest.json`; if a server is already running there, inspect `npx proteum trace` output before reproducing the issue or adding logs.
5. If existing traces are insufficient, run `npx proteum trace arm --capture deep`, reproduce once, then inspect the captured request.

## Non-Negotiable Rules

- Client pages live in `client/pages/**` and register routes with top-level `Router.page(...)` or `Router.error(...)`.
- Page URLs come from the explicit `Router.page('/path', ...)` call, not from the file path.
- Callable app APIs live only in `server/controllers/**/*.ts` files that extend `Controller`.
- Dev-only internal execution lives only in `commands/**/*.ts` files that extend `Commands`.
- Manual HTTP endpoints live only in `server/routes/**`.
- Controllers call `this.input(schema)` inside the method body, at most once per method.
- Request-scoped state lives only on `this.request` and manual-route/router context objects.
- SSR page data belongs in page `setup`, not in `api.fetch(...)`.
- Normal service methods do not read request state directly.
- Do not import runtime values from `@models`.
- Do not use `@request` runtime globals.
- Do not use `@app` on the client.
- Do not edit generated files under `.proteum` by hand.
- Prefer type inference rooted in the explicit application graph in `server/index.ts`.

## Source Of Truth

Proteum reads:

- `package.json`
- `identity.yaml`
- `process.env` via `PORT`, `ENV_*`, `URL`, and `TRACE_*`
- `server/config/*.ts`
- `server/index.ts`
- `server/services/**/service.json`
- `commands/**/*.ts`
- `server/controllers/**/*.ts`
- `server/routes/**/*.ts`
- `client/pages/**/*.ts(x)`
- `client/pages/**/_layout/index.tsx`
- `public/**`

Proteum owns:

- `.proteum/manifest.json`
- `.proteum/client/*`
- `.proteum/common/*`
- `.proteum/server/*`

Project code should consume:

- `@generated/client/*`
- `@generated/common/*`
- `@generated/server/*`
- `@/client/context` as the generated client context entrypoint

Prefer structured CLI surfaces over re-deriving framework facts from source:

- `npx proteum explain --json`
- `npx proteum doctor --json`
- `npx proteum trace ...`
- `npx proteum command ...`
- `npx proteum create ... --dry-run --json`

Prefer scaffold commands before hand-writing boilerplate:

- Use `npx proteum init <directory> --name <name>` for new apps.
- Use `npx proteum init ... --dry-run --json` when an agent needs a machine-readable app plan before writing files.
- Use `npx proteum create page|controller|command|route|service <target>` for new app artifacts before creating the files manually.
- Use `npx proteum create ... --dry-run --json` when an agent needs a machine-readable artifact plan before writing files.

## File Contracts

### App Bootstrap And Services

- `server/index.ts` default-exports the app `Application` subclass and is the canonical type root.
- Root services are public class fields instantiated with `new ServiceClass(this, config, this)`.
- Typed root-service config lives in `server/config/*.ts` via `Services.config(ServiceClass, { ... })`.
- Router plugins are instantiated explicitly inside the `Router` config `plugins` object.
- `server/services/**/service.json` plus `server/index.ts` drive generated service typings and manifest entries.
- Business logic lives in classes that extend `Service` and use `this.services`, `this.models`, and `this.app`.
- Keep auth, input parsing, locale, cookies, and request-derived values in controllers, then pass explicit typed arguments into services.
- Split growing features into explicit subservices.
- `proteum create service ...` scaffolds the service file, its `service.json`, a typed config export under `server/config/*.ts`, and the root registration in `server/index.ts`; review and adapt the generated names before committing.

### Controllers

- Files live under `server/controllers/**/*.ts` and default-export a class extending `Controller`.
- Methods with bodies become generated client-callable endpoints.
- Route path comes from the controller file path plus the method name.
- `export const controllerPath = 'Custom/path'` can override the base path.
- Generated client calls use `POST`.
- Prefer `proteum create controller ...` for new controller boilerplate, then adapt the generated method to real service calls.

### Commands

- Files live under `commands/**/*.ts` and default-export a class extending `Commands` from `@server/app/commands`.
- Methods with bodies become generated dev commands.
- Command path comes from the file path plus the method name.
- `export const commandPath = 'Custom/path'` can override the base path.
- Commands are for dev-only internal execution through `proteum command ...` or the profiler `Commands` tab.
- Keep command logic internal; do not turn it into a normal controller unless it is a real app API.
- Prefer `proteum create command ...` for new command boilerplate.

### Client Pages

- Proteum scans page files for top-level `Router.page(...)` and `Router.error(...)` calls.
- File path controls chunk identity and layout discovery; route path comes from the explicit `Router.page(...)` string.
- Supported page signatures are `Router.page(path, render)`, `Router.page(path, setup, render)`, `Router.page(path, options, render)`, and `Router.page(path, options, setup, render)`.
- For new work, prefer `Router.page(path, setup, render)` or `Router.page(path, options, setup, render)`.
- `setup` returns one flat object. Reserved keys like `_auth`, `_layout`, `_static`, and `_redirectLogged` are route options; all other keys are SSR data.
- Controller fetchers and promises returned from `setup` resolve before render.
- `render` consumes resolved setup data and uses generated controller methods from render args or `@/client/context`.
- Use `api.reload(...)` or `api.set(...)` only when intentionally mutating active page setup state.
- Error pages use `Router.error(code, options, render)` in `client/pages/_messages/**`.
- Prefer `proteum create page ...` for new page boilerplate, then review the explicit route path and setup payload.

### Manual Routes

- Use `server/routes/**` only for explicit HTTP behavior that should not be a generated controller action.
- Good fits include redirects, sitemap or RSS output, OAuth callbacks, webhooks, and public resources with custom semantics.
- Import server-side app services from `@app` and use route handler context for `request`, `response`, router plugins, and custom router context.
- If the route is a normal app API, prefer a controller.
- Prefer `proteum create route ...` for new manual-route boilerplate.

### Models And Aliases

- Use Prisma typings from `@models/types`.
- Use runtime models through `this.models` or `this.app.Models.client`.
- Keep Prisma runtime access inside services when possible and prefer explicit `select` or narrow `include`.
- Do not import runtime values from `@models` or edit generated Prisma client files.
- Aliases:
  - `@/client/...`, `@/server/...`, `@/common/...`: app code
  - `@client/...`, `@server/...`, `@common/...`: Proteum core modules
  - `@app`: server-side application services for manual routes only
  - `@generated/*`: generated app surfaces

## Design Rules

- Prefer explicit `server/index.ts` bootstrap over hidden registration.
- Prefer controller-backed app APIs over ad hoc manual `/api/...` routes.
- Prefer service classes over server helpers with hidden dependencies.
- Keep one canonical source of truth for catalogs, registries, and shared types.
- Reuse project-local Shadcn-based UI primitives when the app already provides them.
- Before inventing a helper, primitive, parser, formatter, SDK wrapper, or build-time tool, first check whether the repo already depends on a suitable package.
- If it does not, search npm before writing a custom implementation.
- Prefer widely adopted, actively maintained, flexible, well-typed packages.
- Only build custom infrastructure when packages would clearly hurt bundle size, SSR behavior, performance, explicit contracts, or long-term maintainability.
- If you choose custom over a package, state briefly why.

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
- controller changes: exercise the generated client call or generated `/api/...` endpoint
- SSR changes: load the real page and inspect rendered HTML plus browser console
- router or plugin changes: verify request context, auth, redirects, metrics, and validation on a running app

When an app may already be running, check the default port from `PORT` or `./.proteum/manifest.json` and inspect `proteum trace requests`, `proteum trace latest`, and `proteum trace show <requestId>` before reproducing the issue. If those traces are not enough, arm `npx proteum trace arm --capture deep`, reproduce once, then inspect the new request.

Useful commands: `npx proteum init <dir> --name <name>`, `npx proteum create <kind> <target>`, `proteum dev`, `npx proteum refresh`, `npx proteum typecheck`, `npx proteum lint`, `npx proteum check`, `npx proteum build prod`, `npx proteum command <path>`.
