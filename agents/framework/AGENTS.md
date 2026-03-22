# Proteum Framework Guide

This document is the framework-level contract for building and maintaining a Proteum project.

It is based on the current Proteum core plus the two real apps used as the reference surface:

- `crosspath/platform`
- `unique.domains/website`

Use this guide for new work. Treat older patterns in the apps as legacy unless they are explicitly described here as still-supported.

# What Proteum is

Proteum is a server-first SSR framework with:

- explicit `Router.page(...)` client page registration
- explicit `*.controller.ts` server API entrypoints
- service classes for business logic
- generated controller trees and generated route modules
- request-scoped server context
- strong bias toward SEO-friendly SSR HTML and minimal client runtime assumptions

The main rule for new work is:

- keep routing, data loading, validation, request access, and service boundaries explicit

# Non-negotiable rules

- Client pages live in `client/pages/**` and register routes with `Router.page(...)` or `Router.error(...)`.
- Page URLs come from the explicit `Router.page('/path', ...)` call, not from the file path.
- Server business logic lives in service classes that extend `Service`.
- Callable API entrypoints live only in `*.controller.ts` files that extend `Controller`.
- Controllers validate input with `this.input(schema)` inside the method body.
- Call `this.input(...)` at most once per controller method.
- Controller methods are exposed to the client under `/api/...` and are always called as `POST` fetchers.
- Manual server routes belong in `server/routes/**` and use `Router.get/post/put/patch/delete(...)`.
- Import Prisma types from `@models/types`.
- Do not import runtime values from `@models`.
- Do not use `@request` runtime globals.
- Do not use `@app` on the client.
- Do not use `api.fetch(...)` inside page route files for SSR data loading.
- Do not edit `.generated` files by hand.

# Source Of Truth Files

The framework actually reads these files and folders:

- `package.json`: CLI scripts and dependency entrypoint
- `identity.yaml`: app identity and web metadata
- `env.yaml`: runtime environment config that Proteum loads directly
- `server/config/*.ts`: service and router registration via `app.setup(...)`
- `server/services/**/service.json`: root service or router-plugin metadata
- `server/services/**/*.controller.ts`: generated API surface
- `server/routes/**/*.ts`: manual server routes
- `client/pages/**/*.ts(x)`: page and error registration
- `client/pages/**/_layout/index.tsx`: generated layouts
- `public/**`: copied or symlinked to dev/build output

Files Proteum generates and owns:

- `client/.generated/routes*`
- `client/.generated/layouts*`
- `client/.generated/context.ts`
- `client/.generated/models.ts`
- `client/.generated/services.d.ts`
- `common/.generated/controllers.ts`
- `common/.generated/models.ts`
- `server/.generated/app.ts`
- `server/.generated/routes*`
- `server/.generated/models.ts`

# Project Structure

Use this shape for real work:

- `client/pages`: route files and page-local UI
- `client/components`: reusable UI
- `client/hooks` or local hooks near the feature
- `common`: shared types, catalogs, utilities safe across client/server
- `server/config`: app bootstrap and service registration
- `server/services`: business services and controller entrypoints
- `server/routes`: manual HTTP routes that should not be generated from controllers
- `public`: static assets
- `prisma`: schema and Prisma assets
- `tests/e2e`: end-to-end tests

The two reference apps both follow this split even when their internal feature folders differ.

# Project Creation Today

What the code says today:

- Proteum exposes `proteum init`.
- The current `init` command expects a `cli/skeleton` directory.
- This repository currently does not contain that `cli/skeleton` directory.

Practical consequence:

- In this checkout, the reliable way to start a new app is to copy a working Proteum project structure from an existing app, then replace the identity, env, config, services, pages, and Prisma schema.

If `proteum init` is restored later, re-check the skeleton before relying on it.

# Required Root Files

## `package.json`

The reference apps use these Proteum commands:

- `proteum dev`
- `npx proteum build prod`
- `npx proteum refresh`
- `npx proteum typecheck`
- `npx proteum lint`
- `npx proteum check`

## `identity.yaml`

Proteum loads `identity.yaml` directly. It must define:

- `name`
- `identifier`
- `description`
- `author`
- `language`
- optional `locale`
- `maincolor`
- optional `iconsPack`
- `web.title`
- `web.titleSuffix`
- `web.fullTitle`
- `web.description`
- `web.version`
- optional `web.metas`
- optional `web.jsonld`

The generated app type uses `identifier`.

## `env.yaml`

Proteum currently loads `env.yaml` directly through `ConfigParser`.

The core parser expects at least:

- `name`
- `profile`
- `router.port`
- `router.domains`
- `console`

Observed reality:

- the apps also keep files like `env.prod.yaml` and `env.testing.yaml`
- the current core parser shown here does not automatically merge those files

So for framework-level correctness:

- treat `env.yaml` as the authoritative runtime config file unless you also own a custom deploy flow around it

# App Bootstrap

Bootstrap lives in `server/config/*.ts`.

Proteum loads every file in that folder during warmup.

Use:

```ts
import app from '@cli/app';

app.setup('Users', 'MyApp/Users', {});

app.setup('Router', 'Core/Router', {
    domains: app.env.router.domains,
    http: {
        domain: 'example.com',
        port: app.env.router.port,
        ssl: true,
        upload: { maxSize: '10mb' },
    },
    context: (request, app) => ({
        user: app.Auth.forSSR(request),
    }),
    plugins: {
        auth: app.setup('Core/Users/Router', {
            users: app.use('Auth'),
        }),
        schema: app.setup('Core/Schema/Router'),
    },
});
```

Important bootstrap rules:

- `app.setup('Name', 'Service/Id', config)` registers a root service on the application.
- `app.use('Name')` returns a reference to an already-registered root service.
- Router plugins are configured inside `Router` service config under `plugins`.
- Router `context(request, app)` returns SSR-safe values exposed to both page setup/render and the client runtime.
- Both reference apps expose a SSR-safe `user` object through `Router.context(...)`.

# Services

## Root service contract

Each root app service normally has:

- `server/services/<Feature>/index.ts`
- `server/services/<Feature>/service.json`

Example `service.json`:

```json
{
    "id": "UniqueDomains/Founder",
    "name": "UniqueDomainsFounder",
    "parent": "app",
    "dependences": []
}
```

Rules:

- `parent` is `"app"` for normal root services.
- `id` is the service identifier used in `app.setup(...)`.
- `name` is metadata for generated registration.
- `priority` is optional and used by some services.

## Service class contract

Service classes extend `Service<Config, Hooks, App, Parent>`.

Use services for:

- database reads and writes
- orchestration
- feature logic
- subservice composition
- startup work in `ready()`

Available on a service instance:

- `this.app`: application instance
- `this.services`: same application instance as a service registry
- `this.models`: runtime Prisma client, if `Models` is registered
- `this.request`: current request context, but only when called during a controller request

Example:

```ts
import Service from '@server/app/service';

export type Config = {
    pageSize: number;
};

export default class FounderService extends Service<Config, {}, MyApp, MyApp> {
    public async ListProjects() {
        const user = await this.request.auth.check('USER');

        return this.models.project.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                name: true,
            },
        });
    }
}
```

Service rules:

- Prefer `this.services.OtherService` over hidden globals.
- Prefer `this.models` or `this.app.Models.client` for Prisma runtime access.
- Keep request-sensitive authorization and input parsing in controllers when possible.
- It is acceptable for service methods called from controllers to use `this.request`, because Proteum binds request context through async storage.
- Still prefer passing explicit values when that makes the contract clearer and easier to test.

## Subservices

Both reference apps use service-owned subservices heavily.

Example:

```ts
export default class DomainsService extends Service<Config, {}, UniqueDomains, UniqueDomains> {
    public search = new DomainsSearchService(this, this.config, this.app);
    public radar = new DomainsRadarService(this, null, this.app);
}
```

Use subservices when:

- a feature has multiple coherent domains
- you want controller paths like `Domains.search.*` or `Founder.projects.*`
- you want smaller files and explicit ownership

# Controllers

## File contract

Controller files must:

- end with `.controller.ts`
- default-export a class extending `Controller`

Example:

```ts
import Controller, { schema } from '@server/app/controller';

export default class FounderProjectsController extends Controller<MyApp> {
    public async createProject() {
        const { Founder } = this.services;

        const data = this.input(
            schema.object({
                name: schema.string(),
            }),
        );

        return Founder.projects.createProject(data);
    }
}
```

## Validation contract

Use `this.input(...)` exactly once per controller method.

Supported forms:

- `this.input(zodSchema)`
- `this.input({ ...shape })`

Do not:

- validate in decorators
- call `this.input(...)` twice
- parse request data manually unless you are in a manual `server/routes` handler

## Request contract

Controllers receive request scope through `this.request`.

Typical values:

- `this.request.request`: raw request object wrapper
- `this.request.response`
- `this.request.user`
- `this.request.auth`
- `this.request.schema`
- `this.request.metrics`
- `this.request.request.data`

The exact plugin fields depend on the router plugins configured in `server/config`.

## Route generation

Proteum generates controller endpoints automatically.

Key facts:

- Only `*.controller.ts` files are indexed.
- Only class methods with bodies become routes.
- The client-facing route is always prefixed with `/api/`.
- Generated client calls use `POST`, even for read methods such as `Get`, `List`, or `Search`.

Route path derivation:

- if the controller lives under a directory with `service.json`, Proteum uses that service alias as the root API namespace
- base path comes from the controller file path
- method name becomes the final route segment
- `export const controllerPath = 'Custom/path'` overrides the base path

Examples from the reference apps:

- `server/services/Users/Auth/Auth.controller.ts#Session()` becomes `Auth.Session()` on the client and maps to `/api/Auth/Session`
- `server/services/Domains/search/search.controller.ts#Search()` becomes `Domains.search.Search()`
- `server/services/Companies/HiringPersons/HiringPersons.controller.ts` overrides the base path with `controllerPath = 'Companies/Persons'`

Naming rule:

- method names become public API names
- choose method names deliberately because client code will call them directly

# Client Pages

## File contract

Client pages live in `client/pages/**`.

Proteum scans page files for top-level `Router.page(...)` and `Router.error(...)` calls.

Important compiler rule:

- the file path controls chunk identity and layout discovery
- the URL comes from the explicit route path string in `Router.page(...)`

Do not hide route registration inside helper abstractions that remove the direct top-level `Router.page(...)` call.

## Import contract

Use:

```ts
import Router from '@/client/router';
```

Do not use `@app` on the client.

## Supported signatures

Proteum supports these `Router.page(...)` signatures:

```ts
Router.page('/path', render);
Router.page('/path', setup, render);
Router.page('/path', options, render);
Router.page('/path', options, setup, render);
```

New work should usually prefer:

```ts
Router.page('/path', setup, render);
```

or:

```ts
Router.page('/path', options, setup, render);
```

## Setup function

`setup` is the SSR contract. It receives:

- router context
- generated controller tree
- custom router context values like `user`
- request query/path params in `data`

Return one flat object.

Proteum splits that object into:

- route options
- SSR data providers

Supported route option keys are:

- `_priority`
- `_preload`
- `_domain`
- `_accept`
- `_raw`
- `_auth`
- `_redirectLogged`
- `_static`
- `_whenStatic`
- `_canonicalParams`
- `_layout`
- `_TESTING`
- `_logging`

The underscore is optional in the framework code, but both reference apps use the underscore form and new work should do the same.

Everything else returned from `setup` is treated as page data.

Example:

```ts
Router.page(
    '/pricing',
    ({ Plans }) => ({
        _auth: false,
        _layout: false,
        plans: Plans.getPlans(),
    }),
    ({ plans }) => <PricingPage plans={plans} />,
);
```

## Data loading rules

Use page `setup` for SSR data.

Good:

```ts
Router.page(
    '/app/projects/:projectId',
    ({ Founder }) => ({
        _auth: 'USER',
        projectsResponse: Founder.projects.getProjects(),
    }),
    ({ projectsResponse }) => <ProjectsPage projects={projectsResponse.projects} />,
);
```

Bad:

- calling `api.fetch(...)` inside the page file to preload SSR data
- moving SSR data fetching into random effects when the page can know it up front

How setup data works:

- controller fetchers and promises are resolved before render
- SSR fetchers are batched through a single `/api` request internally
- plain values can also be returned from `setup`

## Render function

`render` receives:

- the same router context
- resolved setup data
- the generated controller tree
- `page`
- `request`
- `api`
- custom router context like `user`

Use it for:

- page-local React/Preact state
- calling controller methods on interaction
- assigning page metadata on `page`

Example:

```ts
({ request, page, Founder }) => {
    page.metas.robots = 'noindex';

    return <Page />;
}
```

## Error pages

Use `Router.error(code, options, render)` in `client/pages/_messages/**`.

Example:

```ts
Router.error(404, { layout: false }, ({ data }) => <ErrorScreen code={404} data={data} />);
```

# Client Context And Controller Calls

Proteum generates a client context and controller tree.

Use:

```ts
import useContext from '@/client/context';

const { Founder, user, Router, api } = useContext();
```

Generated controller methods are promise-like fetchers:

- `then`
- `catch`
- `finally`
- `run()`

So all of these are valid:

```ts
Founder.projects.getProjects().then(...);
await Founder.projects.updateProject(payload);
await Founder.projects.updateProject(payload).run();
```

Modern usage in both apps is mostly direct `await` or `.then(...)`.

Use `api.reload(...)` and `api.set(...)` only when you intentionally want to refresh or mutate page setup data that already belongs to the active page response.

# Layouts

Layouts come from `client/pages/**/_layout/index.tsx`.

How Proteum resolves them:

- if `_layout: false`, no layout is used
- if `_layout: 'convert'`, a named generated layout with id `convert` is used
- otherwise Proteum picks the nearest matching `_layout` folder by file chunk identity
- if no generated layout matches, the internal root layout is used

Observed patterns:

- CrossPath has root, `convert`, and `employer` layouts
- Unique Domains mostly uses the internal/root layout and sets `_layout: false` for public landing pages

Practical rule:

- use `_layout: false` for standalone landing or embed-like pages
- use a named layout only when a matching `_layout` folder exists

# Manual Server Routes

Use `server/routes/**` for routes that should stay explicit HTTP endpoints rather than generated controller actions.

Typical uses from the reference apps:

- redirects
- webhook-like endpoints
- sitemap and RSS
- landing-page tracking
- public API endpoints with custom semantics
- OAuth callbacks

Example:

```ts
import { Router, Navigation } from '@app';

Router.get('/sitemap.xml', async ({ response }) => {
    return response.xml(await Navigation.Sitemap());
});
```

Manual route rules:

- import server services from `@app`
- use route handler context for request/response and router-plugin services
- validate with `schema.validate(...)` when the schema router plugin is installed
- return `response.redirect(...)`, `response.json(...)`, `response.xml(...)`, `response.html(...)`, `response.file(...)`, or raw serializable data

Route handler context includes:

- `request`
- `response`
- `Router`
- app services
- generated controller tree
- router plugin request services such as `auth`, `schema`, `metrics`
- custom router context values from `Router.context(...)`

# Router Plugins

Router plugins are special services attached under `Router.config.plugins`.

They extend `RouterService`.

Use them for:

- authentication
- validation helpers
- metrics/tracking
- other request-scoped helpers

A router plugin usually has:

- `server/services/<Feature>/router/index.ts`
- optional `server/services/<Feature>/router/request.ts`
- `service.json` with `"parent": "router"`

Example `service.json`:

```json
{
    "id": "UniqueDomains/Users/Metrics/Router",
    "name": "Metrics",
    "parent": "router",
    "dependences": []
}
```

Router plugin rules:

- implement `requestService(request)` to expose a request-scoped helper to route/controller context
- use `this.parent.on('request' | 'resolved' | 'render', ...)` inside `ready()` when you need router lifecycle hooks

# Models And Prisma

For typings:

```ts
import type * as Models from '@models/types';
```

For runtime access:

- `this.models`
- `this.app.Models.client`

Rules:

- do not import runtime values from `@models`
- keep Prisma model access inside services
- prefer explicit `select` or narrow `include`
- do not edit generated Prisma client files

Both apps use `Core/Models` in `server/config`.

# Aliases

These aliases matter in real projects:

- `@/client/...`: app client code
- `@/server/...`: app server code
- `@/common/...`: app shared code
- `@client/...`, `@server/...`, `@common/...`: Proteum core modules
- `@cli/app`: bootstrap registration API inside `server/config`
- `@app`: server-side application services for manual routes
- `@models/types`: Prisma typings only

Import rules:

- client pages: use `@/client/router`, `@/client/context`, app-local components, and generated controller tree from context
- controllers/services: use `@server/app/controller`, `@server/app/service`, app-local services, and `@models/types`
- manual server routes: use `@app` plus app-local utilities

# SEO And Static Output

Proteum is built for SSR and crawlable HTML.

Observed patterns in the apps:

- public landing pages use `Router.page(..., { _layout: false, ... })`
- sitemap is produced explicitly through a service, then exposed with `Router.get('/sitemap.xml', ...)`
- canonical behavior is available through `_canonicalParams`
- static caching exists through `_static`
- manual routes can opt into running even for static pages with `whenStatic: true`

Use these rules:

- prefer SSR page setup for crawlable content
- keep metadata and structured output on the server-rendered path
- use manual routes for sitemap, RSS, redirects, and resource endpoints

# Generated Code Mental Model

Proteum is not magic, but it is generation-heavy.

When you change source files, Proteum regenerates:

- route wrapper modules for client pages and server routes
- layout registries
- controller client tree
- typed app class

Source-to-generated mapping:

- `client/pages/**` -> generated route modules and layout modules
- `server/routes/**` -> generated server route modules
- `server/services/**/*.controller.ts` -> `common/.generated/controllers.ts` and server controller registry
- `server/services/**/service.json` + `server/config/*.ts` -> `server/.generated/app.ts`

LLM rule:

- edit source files only
- never patch generated output directly

# Maintenance Workflow For New Features

When adding a feature, follow this order:

1. Add or extend a root service under `server/services/<Feature>`.
2. Add or extend subservices if the feature has distinct concerns.
3. Add `*.controller.ts` entrypoints for callable app APIs.
4. Register the root service in `server/config/*.ts` if it is new.
5. Add or update `client/pages/**` routes that consume the feature.
6. Load SSR data in page `setup`.
7. Use generated controller methods from page args or `useContext()` for interactions.
8. Add manual `server/routes/**` only if you need explicit HTTP behavior that should not be a controller endpoint.

# Maintenance Checklist For Existing Projects

When maintaining a Proteum app:

- inspect `server/config/*.ts` first to understand which services actually exist
- inspect `service.json` before moving or renaming services
- inspect `*.controller.ts` to understand the public client API
- inspect `client/pages/**` for the real route table
- check `_layout` folders before changing page chrome
- check router plugins before assuming `auth`, `schema`, or `metrics` behavior
- trace generated controller calls back to controller files, not to ad-hoc fetch URLs

# Preferred Patterns For New Work

- `Router.page(path, setup, render)` over page-local fetch hacks
- controller-backed APIs over ad-hoc manual `/api/...` route files
- service classes over random server helpers with hidden dependencies
- `controllerPath` only when the file path would produce the wrong public API shape
- `useContext()` or page render args for controller access on the client
- one clear source of truth for catalogs and shared types

# Legacy Or Discouraged Patterns

These exist in the codebase but should not be the default for new work:

- older pages that overuse `api.reload(...)` and `api.set(...)`
- older pages with deeply mixed UI and data responsibilities
- legacy code that leans on manual `/api/...` routes for app APIs
- any attempt to reintroduce `api.fetch(...)` for SSR page loading
- client-side `@app` imports
- runtime `@models` imports

# Testing And Verification

For app work, verify at the correct layer:

- route additions: boot the app and hit the real URL
- controller changes: exercise the generated client call or `/api/...` endpoint
- SSR changes: load the real page and inspect the rendered HTML and browser console
- router/plugin changes: verify request context behavior, auth, redirects, metrics, and validation on a running app

Use the real app commands already present in the reference projects when possible:

- `proteum dev`
- `npx proteum build prod`
- `npx proteum typecheck`
- `npx proteum lint`
- `npx proteum check`

# Minimal Recipes

## Add a new app API

1. Create or extend `server/services/Feature/index.ts`.
2. Create `server/services/Feature/Feature.controller.ts`.
3. Validate input with `this.input(schema)`.
4. Return data from the service method.
5. Call it from the client as `Feature.MethodName(...)`.

## Add a new SSR page

1. Create `client/pages/.../index.tsx`.
2. Register `Router.page('/real-url', setup, render)`.
3. Return `_auth`, `_layout`, and SSR fetchers from `setup`.
4. Read resolved data in `render`.
5. Use `useContext()` only for interactive follow-up actions.

## Add a new manual route

1. Create `server/routes/.../file.ts`.
2. Import `Router` and needed services from `@app`.
3. Register `Router.get/post/...`.
4. Use `schema.validate(...)` if the schema plugin is installed.
5. Return a response helper or raw JSON-safe data.

# Summary Rule

If you are unsure where code belongs:

- page URL and SSR data: `client/pages`
- reusable business logic: `server/services`
- client-callable app API: `*.controller.ts`
- custom HTTP endpoint: `server/routes`
- request-scoped cross-cutting concern: router plugin
