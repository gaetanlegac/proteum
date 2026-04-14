# Proteum

Proteum is an LLM-first SSR / SEO / TypeScript framework for full-stack web applications.

It is built for teams that want explicit server contracts, server-first rendering, deterministic generated artifacts, and a codebase that an AI agent can inspect without reverse-engineering hidden runtime magic.

Migration guide for older apps: [docs/migrate-from-2.1.3.md](docs/migrate-from-2.1.3.md)

## Sponsor

Proteum is sponsored by [Unique Domains](https://unique.domains/?utm_source=github&utm_medium=referral&utm_campaign=repo_proteum&utm_content=top_sponsor).

[![Unique Domains](docs/assets/unique-domains-chip.png)](https://unique.domains/?utm_source=github&utm_medium=referral&utm_campaign=repo_proteum&utm_content=top_sponsor)

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

- **Server-first by default.** Put data loading in the page data function and keep client code focused on UI.
- **Explicit request entrypoints.** Controllers are classes. Request access is explicit through `this.request`.
- **Local validation.** Validate handler input inside the handler with `this.input(schema)`.
- **Deterministic generation.** Proteum owns `.proteum/` and regenerates it from source.
- **Explainability matters.** `proteum explain`, `proteum doctor`, `proteum diagnose`, `proteum perf`, and `proteum trace` expose the framework view of your app and its live requests, and the profiler renders the same diagnostics and perf surfaces for humans in dev.
- **SEO is not an afterthought.** Identity, routes, layouts, and SSR data are part of the app contract.

## What a Proteum App Looks Like

```text
my-app/
  identity.config.ts
  proteum.config.ts
  .env               # optional file for required local env vars
  package.json
  commands/
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

- `identity.config.ts`: typed app identity, naming, locale, and SEO-facing metadata defaults via `Application.identity({ ... })`
- `proteum.config.ts`: typed Proteum compiler and connection settings such as `transpile` and `connect` via `Application.setup({ ... })`
- `process.env` / optional `.env`: `PORT`, `ENV_*`, `URL`, `URL_INTERNAL`, any app-chosen variables referenced by `proteum.config.ts`, and `TRACE_*` environment variables loaded by the app
- `server/config/*.ts`: plain typed config exports consumed by the explicit app bootstrap
- `server/index.ts`: default-exported `Application` subclass that instantiates root services and router plugins
- `client/pages/**`: SSR page entrypoints registered through `Router.page(path, options, data, render)`
- `server/controllers/**`: request handlers that extend `Controller`
- `commands/**`: dev-only internal commands that extend `Commands`
- `server/services/**`: business logic that extends `Service`
- `.proteum/**`: framework-owned generated contracts and manifests

Required Proteum env vars:

- `ENV_NAME`: `local` or `server`
- `ENV_PROFILE`: `dev`, `testing`, or `prod`
- `PORT`: default router port
- `URL`: canonical absolute base URL for `Router.url(..., true)`
- `URL_INTERNAL`: internal absolute base URL used by SSR and connected-project server calls

If `proteum.config.ts` declares `connect`, Proteum also requires:

- one explicit `connect.<Namespace>.source` value in `proteum.config.ts`
- one explicit `connect.<Namespace>.urlInternal` value in `proteum.config.ts`

Proteum does not provide defaults for required env vars. They must be defined explicitly in `process.env` or `.env`.

Use `proteum explain env` to see the required env vars, their allowed values, and whether each one is currently provided.

Optional trace env vars:

- `TRACE_ENABLE`
- `TRACE_REQUESTS_LIMIT`
- `TRACE_EVENTS_LIMIT`
- `TRACE_CAPTURE`
- `TRACE_PERSIST_ON_ERROR`

Optional `proteum.config.ts` fields:

- `transpile`: array of package names that Proteum should compile from `node_modules/` instead of treating as prebuilt vendor code
- `connect`: connected project namespaces that should be merged into generated controller helpers

Example:

```ts
import { Application } from 'proteum/config';

const PRODUCT_CONNECTED_SOURCE = process.env.PRODUCT_CONNECTED_SOURCE;
const PRODUCT_URL_INTERNAL = process.env.PRODUCT_URL_INTERNAL;

export default Application.setup({
  transpile: ['@acme/components'],
  connect: {
    Product: {
      source: PRODUCT_CONNECTED_SOURCE,
      urlInternal: PRODUCT_URL_INTERNAL,
    },
  },
});
```

Connected contract sources are provided explicitly through `proteum.config.ts` instead of being inferred from the namespace:

- local typed source value: `file:../product`
- remote runtime-only source value: `github:owner/repo?ref=<sha-or-branch>&path=proteum.connected.json`

Use this for linked or workspace-local TypeScript packages that ship source files and must flow through Proteum's alias and SSR compilation pipeline.

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
  currentDomain: AppContainer.Environment.router.currentDomain,
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

Proteum reads `server/index.ts` as the source of truth for installed root services and router plugins, and reads `server/config/*.ts` `Services.config(...)` exports for typed config such as service priority overrides.

## Example: Page

Proteum pages are explicit SSR entrypoints.

```tsx
import Router from '@/client/router';

Router.page(
  '/',
  {
    auth: false,
    layout: false,
  },
  ({ Plans, Stats }) => ({
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
- the second argument is the explicit route-options object
- the third argument is the page data function or `null`
- route behavior such as `auth`, `layout`, `static`, or `redirectLogged` lives in the options object
- every key returned from the data function becomes page data
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

## Example: Command

Proteum commands are explicit dev-only internal entrypoints.

```ts
import { Commands } from '@server/app/commands';

export default class DiagnosticsCommands extends Commands {
  public async ping() {
    const { Stats } = this.services;

    return {
      app: this.app.identity.identifier,
      domains: await Stats.general(),
    };
  }
}
```

Command rules:

- files live under `commands/**/*.ts`
- each file default-exports a class extending `Commands` from `@server/app/commands`
- methods with bodies become generated dev commands
- command path comes from the file path plus the method name
- `export const commandPath = 'Custom/path'` can override the base path when needed
- `commands/tsconfig.json` and `.proteum/server/commands.d.ts` give `/commands` its own dev-only alias and app typing surface
- commands run only in dev contexts: `proteum command ...`, the dev profiler, or dev-only `__proteum/commands` endpoints

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
- `.proteum/server/commands.ts`
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
| `proteum build --prod` | Produce the production server and client bundles into `bin/`, with optional static or served bundle analysis |
| `proteum connect` | Inspect connected-project sources, env, cached contracts, and imported controllers |
| `proteum doctor` | Inspect manifest diagnostics |
| `proteum explain` | Explain routes, controllers, services, layouts, conventions, env, and connected projects |
| `proteum diagnose` | Combine owner lookup, diagnostics, trace data, and server logs for one concrete route or request target |
| `proteum perf` | Aggregate request-trace performance into hot paths, one-request waterfalls, regressions, and memory drift views |
| `proteum trace` | Inspect live dev-only request traces from the running SSR server |
| `proteum command` | Run a dev-only internal command locally or against a running dev server |
| `proteum session` | Mint a dev-only auth session token and Playwright-ready cookie payload |
| `proteum verify` | Validate framework-facing workflows across one or more running dev apps; `framework-change` is the built-in cross-reference-app check |
| `proteum init` | Scaffold a new Proteum app with built-in deterministic templates |
| `proteum configure agents` | Interactively configure Proteum-managed instruction symlinks and confirm overwrites for standalone or monorepo apps |
| `proteum create` | Scaffold a page, controller, command, route, or root service inside an app |

Recommended daily workflow:

```bash
proteum dev
proteum refresh
proteum check
proteum build --prod
proteum build --prod --analyze
proteum build --prod --analyze --analyze-serve --analyze-port auto
```

Only the bare `proteum build` and bare `proteum dev` commands print the welcome banner and include the active Proteum installation method. Any extra argument or option skips the banner. `proteum dev` is the only command that clears the interactive terminal before rendering its live session UI, exposes `CTRL+R` reload plus `CTRL+C` shutdown hotkeys, and prints connected app names plus successful connected `/ping` checks in the server-ready banner. When the app root is missing `AGENTS.md`, the interactive `proteum dev` start offers to launch `proteum configure agents` before the dev loop begins.

Useful inspection commands:

```bash
proteum doctor
proteum doctor --contracts
proteum doctor --json
proteum connect
proteum connect --controllers
proteum connect --strict
proteum explain
proteum explain owner /api/Auth/CurrentUser
proteum explain --routes --controllers --commands
proteum explain --connected --controllers
proteum explain --all --json
proteum diagnose /
proteum diagnose /dashboard --port 3101
proteum perf top --since today
proteum perf request /dashboard --port 3101
proteum perf compare --baseline yesterday --target today --group-by route
proteum perf memory --since 1h --group-by controller
proteum command proteum/diagnostics/ping
proteum command proteum/diagnostics/ping --port 3101
proteum session admin@example.com --role ADMIN --port 3101
proteum session god@example.com --role GOD --json
proteum trace requests
proteum trace arm --capture deep
proteum trace latest
```

Useful scaffolding commands:

```bash
proteum init my-app --name "My App"
proteum init my-app --name "My App" --dry-run --json
proteum configure agents
proteum create page marketing/faq --route /faq
proteum create controller Founder/projects --method list
proteum create service Conversion/Plans
```

`proteum configure agents` asks before replacing any existing non-managed instruction file or foreign symlink. If you decline, that path is left untouched.

Bare interactive `proteum dev` reuses that same wizard when the app root is missing `AGENTS.md`; declining the prompt continues the dev start without writing files.

`proteum connect`, `proteum explain`, `proteum doctor`, and `proteum diagnose` share the same generated manifest and contract state. `proteum perf` uses the same dev request-trace store as the profiler `Perf` tab. For the full diagnostics and tracing model, see [docs/diagnostics.md](docs/diagnostics.md) and [docs/request-tracing.md](docs/request-tracing.md).

## Dev Commands

Proteum includes a dev-only command surface for internal testing, debugging, and one-off execution that should not become a normal controller or route.

- commands live under `./commands/**/*.ts`
- each file default-exports a class extending `Commands` from `@server/app/commands`
- each method is addressed by `file/path/methodName`
- Proteum creates `commands/tsconfig.json` when the folder exists so command files inherit the server alias/type project
- `proteum command foo/bar` refreshes generated artifacts, builds the dev output, starts a temporary local dev server, runs the command, prints the result, and exits
- `proteum command foo/bar --port 3101` runs the same command against an existing `proteum dev` instance
- the dev profiler exposes the same command list and run action through the `Commands` tab
- the same profiler also exposes `Explain`, `Doctor`, and `Diagnose` tabs backed by the same diagnostics contract as the CLI

Proteum itself also ships a small built-in diagnostic command at `proteum/diagnostics/ping`, so the command surface is never empty in dev.

## Dev Sessions

Proteum includes a dev-only auth bootstrap command for browser automation, API probes, and protected-route debugging without driving the login UI.

- `proteum session <email>` mints a session for a known user
- `--role <role>` asserts that the resolved user has the expected role before returning the session
- `--port <port>` or `--url <baseUrl>` targets an existing `proteum dev` server
- without `--port` or `--url`, Proteum starts a temporary local dev server, creates the session, prints the payload, and exits
- output includes the raw token, a `Cookie:` header, and a Playwright-ready `cookies` payload
- prefer this command when an LLM or test runner needs an authenticated dev context
- do not use it when the login flow itself is what you are testing

Typical usage:

```bash
proteum session admin@example.com --role ADMIN --port 3101
proteum session god@example.com --role GOD --json
```

The CLI talks to the running app over the dev-only `__proteum/session/start` endpoint and uses the auth service registered on the current app router. For the full guide, see [docs/dev-sessions.md](docs/dev-sessions.md).

## Request Tracing

Proteum includes a dev-only in-memory request trace buffer for auth, routing, controller, context, SSR, API, Prisma SQL, and render debugging.

This is separate from `proteum explain` and `proteum doctor`: tracing is live request-time data, while explain/doctor are manifest-backed structure and diagnostics. `proteum perf` aggregates the same trace buffer into hot-path, waterfall, compare, and memory views. When you already know the failing path and want the fastest suspect list, start with `proteum diagnose`; when the issue is performance, start with `proteum perf`; then drop into raw trace output only if needed.

When diagnosing or testing against an app, first read the default port from `PORT` or `./.proteum/manifest.json` and check whether a server is already running there. If it is, inspect the existing traces before reproducing the issue so you can collect past errors and their context.

- `proteum trace requests`: list the most recent request summaries
- `proteum trace latest`: show the latest captured request
- `proteum trace show <requestId>`: inspect one trace in detail
- `proteum trace arm --capture deep`: force the next request into deep capture mode
- `proteum trace export <requestId>`: write one trace to disk
- `proteum trace latest --url http://127.0.0.1:3010`: target a non-standard dev base URL directly
- `proteum diagnose /dashboard --port 3101`: combine owner lookup, diagnostics, trace summary, and buffered logs for one concrete path
- `proteum perf top --since today`: rank the hottest traced paths in the selected window
- `proteum perf request /dashboard --port 3101`: inspect one traced request with stage timings, CPU, SQL, render, and memory deltas
- `proteum perf compare --baseline yesterday --target today --group-by route`: compare regression deltas between two windows
- `proteum perf memory --since 1h --group-by controller`: rank recent heap and RSS drift

Trace summaries include `sql=<count>`. Detailed trace output includes `Calls` and `SQL` sections so API/fetcher activity and Prisma queries can be inspected together.

Default behavior:

- tracing is enabled only in `profile: dev`
- traces live in memory and are bounded by `TRACE_REQUESTS_LIMIT` and `TRACE_EVENTS_LIMIT`
- payloads are summarized, long strings are truncated, and sensitive fields such as cookies, passwords, and tokens are redacted
- `TRACE_PERSIST_ON_ERROR` can export crashing requests under `var/traces/`
- `proteum dev` removes auto-persisted crash traces from `var/traces/` when the dev session stops

Trace env example:

```bash
export TRACE_ENABLE=true
export TRACE_REQUESTS_LIMIT=200
export TRACE_EVENTS_LIMIT=800
export TRACE_CAPTURE=resolve
export TRACE_PERSIST_ON_ERROR=true
```

Capture modes:

- `summary`: request lifecycle plus high-signal events
- `resolve`: adds auth, route resolution, and controller/context steps
- `deep`: adds route skip reasons and deeper payload summaries for one request investigation

In the dev profiler, the request-trace tabs are now visual as well as textual: `Summary`, `Auth`, `Routing`, `Controller`, `SSR`, `API`, `SQL`, `Errors`, `Diagnose`, `Explain`, `Doctor`, `Commands`, and `Cron` all add focused charts over the same live contracts, while `Perf` remains the aggregated hot-path, breakdown, regression, and memory surface exposed by `proteum perf`.

The trace and perf CLIs talk to the running dev server over the dev-only `__proteum/trace` and `__proteum/perf` HTTP endpoints. Use `--port` for a different local port or `--url` when the host itself is non-standard. For the full guide, see [docs/request-tracing.md](docs/request-tracing.md).

## LLM-Friendly By Design

Proteum is built so an agent can answer these questions quickly and reliably:

- What is this app called, and what are its SEO defaults?
- Which routes exist?
- Which controller handles a request?
- Which services are installed?
- Which layouts exist?
- Which diagnostics did the framework detect?

Proteum answers those questions with explicit artifacts:

- `identity.config.ts` for app identity
- `proteum.config.ts` for compiler and connected-project setup
- `PORT`, `ENV_*`, `URL`, `URL_INTERNAL`, app-chosen connected-project config values, and `TRACE_*` env vars for the environment surface
- `server/index.ts` for the explicit root service graph
- `.proteum/manifest.json` for machine-readable app structure
- `proteum explain --json` for structured framework introspection
- `proteum doctor --json` for structured diagnostics
- `proteum doctor --contracts --json` for generated-artifact and manifest-owned file checks
- `proteum explain owner <query>` for fast ownership lookup over routes, controllers, files, and generated artifacts
- `proteum diagnose <path>` for a one-shot request diagnosis surface
- `proteum perf top|request|compare|memory` for request-trace performance rollups
- the profiler `Explain`, `Doctor`, `Diagnose`, and `Perf` tabs for a human-readable view over the same diagnostics and trace-derived perf contracts
- `proteum command ...` plus the profiler `Commands` tab for dev-only internal execution
- `proteum session ...` for explicit authenticated dev browser or API bootstrapping without login UI automation

If you are an LLM or automation agent, start here:

1. Read `identity.config.ts` and `proteum.config.ts`.
2. Read `PORT`, the relevant `ENV_*`, `URL`, `URL_INTERNAL`, any env values referenced by `proteum.config.ts`, and `TRACE_*` env vars, or run `proteum explain env`.
3. Inspect `server/index.ts` and `server/config/*.ts` for the explicit app bootstrap.
4. Read `.proteum/manifest.json` or run `proteum explain --json`.
5. Inspect `server/controllers/**` for request entrypoints.
6. Inspect `server/services/**` for business logic.
7. Inspect `client/pages/**` for SSR routes and page data contracts.
8. If the task touches a protected route or controller in dev and login UX is not the feature under test, use `proteum session <email> --role <role>` before Playwright or direct HTTP calls.

For implementation rules in a real Proteum app, treat the local `AGENTS.md` files plus `proteum explain`, `proteum doctor`, `proteum diagnose`, `proteum perf`, and `proteum trace` as the task contract. This README is the framework overview, not the project-local instruction layer.

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

You can bootstrap a new app with:

```bash
npx proteum init my-app --name "My App"
npx proteum init my-app --name "My App" --dry-run --json
```

Then use the normal workflow:

```bash
npm install
npx proteum configure agents
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
