# Proteum

Proteum is an LLM-first SSR / SEO / TypeScript framework for full-stack web applications.

It is built for teams that want explicit server contracts, server-first rendering, deterministic generated artifacts, and a codebase that an AI agent can inspect without reverse-engineering hidden runtime magic.

## Why Proteum

Most full-stack frameworks optimize first for human convenience.

Proteum optimizes first for:

- explicit, typed, machine-readable contracts
- SSR and SEO as framework primitives
- server-first architecture with minimal client runtime
- deterministic generation instead of ambient magic
- codebases that stay explainable to humans and LLMs at the same time

Proteum combines:

- page-first SSR workflows similar to modern React meta-frameworks
- explicit controller and service layers inspired by backend frameworks
- generated manifests and contracts that make routes, services, layouts, and diagnostics easy to inspect

## Core Principles

- **Server-first by default.** Put data loading in the page setup function and keep client code focused on UI.
- **Explicit request entrypoints.** Controllers are classes. Request access is explicit through `this.request`.
- **Local validation.** Validate handler input inside the handler with `this.input(schema)`.
- **Deterministic generation.** Proteum owns `.proteum/` and regenerates it from source.
- **Explainability matters.** `proteum explain` and `proteum doctor` expose the framework view of your app.
- **SEO is not an afterthought.** Identity, routes, layouts, and SSR data are part of the app contract.

## What a Proteum App Looks Like

```text
my-app/
  identity.yaml
  env.yaml
  package.json
  client/
    pages/
      _layout/
    components/
    islands/
    services/
  server/
    config/
    index.ts
    controllers/
    services/
  common/
    models/
    router/
    errors/
  .proteum/
    manifest.json
    client/
    common/
    server/
```

Important files:

- `identity.yaml`: app identity, naming, locale, and SEO-facing metadata defaults
- `env.yaml`: environment contract loaded by the app
- `server/config/*.ts`: plain typed config exports consumed by the explicit app bootstrap
- `server/index.ts`: default-exported `Application` subclass that instantiates root services and router plugins
- `client/pages/**`: SSR page entrypoints registered through `Router.page(...)`
- `server/controllers/**`: request handlers that extend `Controller`
- `server/services/**`: business logic that extends `Service`
- `.proteum/**`: framework-owned generated contracts and manifests

## Example: Server Bootstrap

Proteum app services are declared explicitly through typed config exports plus a concrete `Application` subclass.

```ts
// server/config/user.ts
import { Services, type ServiceConfig } from '@server/app';
import AppContainer from '@server/app/container';
import Router from '@server/services/router';
import Users from '@/server/services/Users';

type RouterBaseConfig = Omit<ServiceConfig<typeof Router>, 'plugins'>;

export const usersConfig = Services.config(Users, {});

export const routerBaseConfig = {
  domains: AppContainer.Environment.router.domains,
  http: {
    domain: 'example.com',
    port: AppContainer.Environment.router.port,
    ssl: true,
    upload: { maxSize: '10mb' },
  },
  context: () => ({}),
} satisfies RouterBaseConfig;
```

```ts
// server/index.ts
import { Application } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';
import Users from '@/server/services/Users';
import * as userConfig from '@/server/config/user';

export default class MyApp extends Application {
  public Users = new Users(this, userConfig.usersConfig, this);
  public Router = new Router(
    this,
    {
      ...userConfig.routerBaseConfig,
      plugins: {
        schema: new SchemaRouter({}, this),
      },
    },
    this
  );
}
```

Proteum reads `server/index.ts` plus `server/services/**/service.json` to derive the installed service graph and generated type contracts.

## Example: Page

Proteum pages are explicit SSR entrypoints.

```tsx
import Router from '@/client/router';

Router.page(
  '/',
  ({ Plans, Stats }) => ({
    _auth: false,
    _layout: false,
    plans: Plans.getPlans(),
    stats: Stats.general(),
  }),
  ({ plans, stats }) => {
    return <LandingPage plans={plans} stats={stats} />;
  }
);
```

What happens here:

- the first argument is the route path
- the optional setup function runs on the server for SSR data loading
- keys prefixed with `_` become route options such as `_auth`, `_layout`, `_static`, or `_redirectLogged`
- every other returned key becomes page data
- the renderer receives the resolved data and the generated controller/service context

## Example: Controller

Proteum controllers are explicit request entrypoints.

```ts
import Controller, { schema } from '@server/app/controller';

export default class AuthController extends Controller<MyApp> {
  public async loginWithPassword() {
    const { Auth } = this.services;
    const data = this.input(
      schema.object({
        email: schema.string().email(),
        password: schema.string().min(8),
      })
    );

    return Auth.loginWithPassword(data, this.request);
  }
}
```

Controller rules:

- read request-scoped values from `this.request`
- validate once with `this.input(schema)`
- call business logic through `this.services`, `this.models`, or `this.app`
- return explicit values instead of relying on ambient globals

## Example: Service

Proteum services keep business logic out of request handlers.

```ts
import Service from '@server/app/service';

export default class StatsService extends Service<Config, {}, MyApp, MyApp> {
  public async general() {
    return {
      totalDomains: await this.models.SQL`SELECT COUNT(*) FROM domains`.value(),
      tlds: Object.keys(this.app.Domains.tlds).length,
    };
  }
}
```

Service rules:

- services extend `Service`
- request context should be resolved in controllers, then passed into services as explicit values
- services can use `this.services`, `this.models`, and `this.app`

## Framework-Owned Generated Contracts

Proteum generates a machine-readable app description in `.proteum/`.

Typical generated artifacts:

- `.proteum/manifest.json`
- `.proteum/client/routes.ts`
- `.proteum/client/controllers.ts`
- `.proteum/client/layouts.ts`
- `.proteum/common/controllers.ts`
- `.proteum/server/routes.ts`
- `.proteum/server/controllers.ts`

These files are not hand-written application code. They are deterministic outputs derived from your app source and used by the runtime, the compiler, and tooling.

This is one of Proteum's most important properties: the framework can explain what it discovered instead of asking you to guess.

## CLI

Proteum ships with a compact CLI focused on the real app lifecycle:

| Command | Purpose |
| --- | --- |
| `proteum dev` | Start the compiler, SSR server, and hot reload loop |
| `proteum refresh` | Regenerate `.proteum` contracts and typings |
| `proteum typecheck` | Refresh generated typings, then run TypeScript |
| `proteum lint` | Run ESLint for the current app |
| `proteum check` | Refresh, typecheck, and lint in one command |
| `proteum build --prod` | Produce the production server and client bundles into `bin/` |
| `proteum doctor` | Inspect manifest diagnostics |
| `proteum explain` | Explain routes, controllers, services, layouts, conventions, and env |
| `proteum init` | Experimental project scaffolding when scaffold assets are installed |

Recommended daily workflow:

```bash
proteum dev
proteum refresh
proteum check
proteum build --prod
```

Useful inspection commands:

```bash
proteum doctor
proteum doctor --json
proteum explain
proteum explain --routes --controllers
proteum explain --all --json
```

## LLM-Friendly By Design

Proteum is built so an agent can answer these questions quickly and reliably:

- What is this app called, and what are its SEO defaults?
- Which routes exist?
- Which controller handles a request?
- Which services are installed?
- Which layouts exist?
- Which diagnostics did the framework detect?

Proteum answers those questions with explicit artifacts:

- `identity.yaml` for app identity
- `env.yaml` for the environment surface
- `server/index.ts` for the explicit root service graph
- `.proteum/manifest.json` for machine-readable app structure
- `proteum explain --json` for structured framework introspection
- `proteum doctor --json` for structured diagnostics

If you are an LLM or automation agent, start here:

1. Read `identity.yaml`.
2. Read `env.yaml`.
3. Inspect `server/index.ts` and `server/config/*.ts` for the explicit app bootstrap.
4. Read `.proteum/manifest.json` or run `proteum explain --json`.
5. Inspect `server/controllers/**` for request entrypoints.
6. Inspect `server/services/**` for business logic.
7. Inspect `client/pages/**` for SSR routes and page setup contracts.

## What Proteum Avoids

Proteum intentionally avoids several patterns that make frameworks harder to inspect and harder to trust:

- hidden runtime globals
- implicit service registration hidden behind bootstrap helpers
- implicit request state inside business services
- controller validation defined far away from the handler
- route systems that cannot be explained without reading the compiler
- generated code that hides where it came from

## Real-World Shape

Proteum is already used on large application surfaces with:

- many controllers and services
- SSR landing pages and authenticated app pages
- generated controller accessors injected into page context
- build, typecheck, lint, and diagnostic workflows run from the CLI

In real apps, the common `package.json` scripts look like this:

```json
{
  "scripts": {
    "dev": "proteum dev",
    "refresh": "proteum refresh",
    "typecheck": "proteum typecheck",
    "check": "proteum check",
    "build": "proteum build --prod",
    "start": "node ./bin/server.js"
  }
}
```

## Installation

Proteum currently targets:

- Node.js `>=20.19.0`
- npm `>=3.10.10`

Install in an app:

```bash
npm install proteum
```

If the scaffold assets are available in your distribution, you can bootstrap a new app with:

```bash
npx proteum init
```

Then use the normal workflow:

```bash
npx proteum dev
npx proteum check
npx proteum build --prod
```

## Repository Structure

This repository is organized around the same explicit framework surface it exposes:

- `cli/`: compiler, commands, diagnostics, and developer workflow
- `client/`: client runtime, page registration, islands, and router behavior
- `server/`: controller base classes, services, runtime, and SSR server behavior
- `common/`: shared router contracts, models, request/response types, and utilities
- `doc/`: focused design notes and internal documentation
- `agents/`: agent-specific conventions and scaffolding used in Proteum-based projects

## Status

Proteum is actively hardening its explicit model.

The direction is deliberate:

- less runtime magic
- more generated and auditable contracts
- clearer controller and service boundaries
- better SSR, SEO, and explainability defaults
- better ergonomics for both humans and AI agents

If you want a framework that treats machine-readable architecture as a first-class feature, Proteum is what this repository is building.
