# Proteum Project Contract

This is the canonical contract for Proteum-based projects shipped with Proteum. Narrower `AGENTS.md` files in this folder add area-specific rules on top of this file.
Role: keep only project-wide app rules here.
Keep here: cross-cutting project workflow, architecture contracts, shared typing rules, and rules that apply across client, server, pages, and tests.
Do not put here: detailed diagnostics workflow, optimization checklists, coding-style details, or narrow area-specific instructions that belong in `diagnostics.md`, `optimizations.md`, `CODING_STYLE.md`, `client/AGENTS.md`, `client/pages/AGENTS.md`, `server/routes/AGENTS.md`, `server/services/AGENTS.md`, or `tests/AGENTS.md`.

Optimization source of truth: project-root `optimizations.md`.
Diagnostics source of truth: project-root `diagnostics.md`.
Coding style source of truth: project-root `CODING_STYLE.md`.

## Workflow

- At the beginning of every task, acknowledge the applicable optimization, diagnostics, and coding-style sources before analyzing or editing code: project-root `optimizations.md`, project-root `diagnostics.md`, project-root `CODING_STYLE.md`, and any narrower area `AGENTS.md`.
- If the user pastes raw errors without asking for a fix, do not implement changes. List likely causes and, for each one, give probability, why, and how to fix it.
- Follow project-root `diagnostics.md` for diagnosis, runtime reproduction, temporary instrumentation, error-solving workflow, and verification method selection.
- For new app or artifact boilerplate, prefer `npx proteum init ...` and `npx proteum create ...` before creating files by hand. Use `--dry-run --json` when an agent needs a machine-readable plan before writing files.
- After running `npx proteum create ...`, adapt the generated code to the real feature instead of leaving placeholder logic in place.
- When starting a long-lived dev server for an agent task, prefer `npx proteum dev --session-file <path> --replace-existing --port <port>` so the session can be listed and stopped deterministically later.
- Do not start a second `proteum dev` server for the same app and port until the earlier tracked session has been stopped or replaced.
- When framework work changes Proteum CLI commands, profiler panels/features, or the `proteum dev` banners, keep this file, project-root `diagnostics.md`, and any narrower area `AGENTS.md` that mentions the same workflow aligned with the live framework behavior in the same pass.
- Current CLI banner contract: every human-facing Proteum CLI run prints the welcome banner and includes the active Proteum installation method, while only `proteum dev` clears the interactive terminal before rendering, exposes `CTRL+R` reload plus `CTRL+C` shutdown hotkeys in its session UI, and reports connected app names plus successful connected `/ping` checks in the ready banner.
- Before finishing, double-check the touched files and generated output against the applicable optimization, diagnostics, and coding-style sources: project-root `optimizations.md`, project-root `diagnostics.md`, project-root `CODING_STYLE.md`, and any narrower area `AGENTS.md`.
- After implementing any feature or behavior change, always verify it on a running app before finishing: start the server, exercise the affected flow with Playwright or the smallest real runtime or `npx proteum` surface, run the relevant diagnostics or perf commands, and confirm there is no meaningful regression in behavior, performance, bundle/load size, SEO output, or coding style.
- Before finishing a task, stop every `proteum dev` session started during the task and confirm cleanup with `npx proteum dev list --json` or an explicit `npx proteum dev stop --session-file <path>`.
- When you have finished your work, summarize in one top-level short (up to 100 characters) sentence ALL the changes you made since the beginning of the WHOLE conversation. Strictly use the Conventional Commits specification:
```
Commit message: <type>[optional scope]: <description>

[optional body]
```
```

## Project Shape

This is a TypeScript, Node.js, Preact, Proteum monolith:

- `/client`: assets, catalogs, components, hooks, pages
- `/common`: shared functions, constants, types, and catalogs
- `/server`: catalogs, config, services, routes, lib
- `/tests`

## Non-Negotiable Rules

- Client pages live in `client/pages/**` and register routes with top-level `Router.page(...)` or `Router.error(...)`.
- Page URLs come from the explicit `Router.page('/path', ...)` call, not from the file path.
- Callable app APIs live only in `server/controllers/**/*.ts` files that extend `Controller`.
- Dev-only internal execution lives only in `commands/**/*.ts` files that extend `Commands`.
- Manual HTTP endpoints live only in `server/routes/**`.
- Controllers call `this.input(schema)` inside the method body, at most once per method.
- Request-scoped state lives only on `this.request` and manual-route/router context objects.
- Follow project-root `optimizations.md` for bundle size, performance, SEO, and SSR page-size rules.
- Keep one class or one React/Preact component per file.
- Prefer a deep tree grouped by business concern instead of long file names.
- Use the default `*.ts` or `*.tsx` file unless an `*.ssr.ts` or `*.ssr.tsx` variant is truly required.
- Never edit generated files under `.proteum`.
- When a task changes database structure, edit the app's `schema.prisma` only.
- Never create or edit migration files manually.
- Use `@generated/client/*`, `@generated/common/*`, and `@generated/server/*` for generated surfaces.
- Client context is typically imported from `@/client/context`.
- Normal service methods do not read request state directly.
- Do not import runtime values from `@models`.
- Do not use `@request` runtime globals.
- Do not use `@app` on the client.
- Prefer type inference rooted in the explicit application graph in `server/index.ts`.

## Source Of Truth

Proteum reads:

- `package.json`
- `identity.config.ts` for app identity via `Application.identity({ ... })`
- `proteum.config.ts` for compiler setup via `Application.setup({ transpile, connect })`
- `process.env` via `PORT`, `ENV_*`, `URL`, `URL_INTERNAL`, any app-chosen connected-project values referenced by `proteum.config.ts`, and `TRACE_*`
- `server/config/*.ts`
- `server/index.ts`
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

- `npx proteum connect --json`
- `npx proteum connect --controllers --strict`
- `npx proteum explain --json`
- `npx proteum explain --connected --controllers`
- `npx proteum explain owner <query>`
- `npx proteum doctor --json`
- `npx proteum doctor --contracts --json`
- `npx proteum diagnose <path> --port <port>`
- `npx proteum perf ...`
- `npx proteum trace ...`
- `npx proteum command ...`
- `npx proteum session ...`
- `npx proteum create ... --dry-run --json`
- `npx proteum dev list --json`
- `npx proteum dev stop --session-file <path>`

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
- Root business services live in `server/services/<Feature>/index.ts`.
- Root-service config lives in `server/config/*.ts` when the service needs config.
- Business logic lives in classes that extend `Service` and use `this.services`, `this.models`, and `this.app`.
- Keep auth, input parsing, locale, cookies, and request-derived values in controllers, then pass explicit typed arguments into services.
- Split growing features into explicit subservices.
- Companion client-callable entrypoints live in `server/controllers/**`.
- `proteum create service ...` scaffolds the service file, a typed config export under `server/config/*.ts`, and the root registration in `server/index.ts`; review and adapt the generated names before committing.

### Connected Projects

- Declare connected namespaces in `proteum.config.ts` with explicit values such as `connect: { Product: { source: PRODUCT_CONNECTED_SOURCE, urlInternal: PRODUCT_URL_INTERNAL } }`.
- Proteum does not infer connected env key names from the namespace. The source and internal URL must be provided explicitly in `proteum.config.ts`.
- Use `npx proteum connect` to inspect configured connect values, cached contract state, and imported controllers for the current app.
- `file:` connected sources point at another Proteum app root and keep strong connected typings.
- Non-local connected sources provide runtime helper generation but are intentionally typed loosely.

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
- Never run schema-mutating SQL such as `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, or `CREATE INDEX` to change database structure.
- Do not import runtime values from `@models` or edit generated Prisma client files.
- Aliases:
  - `@/client/...`, `@/server/...`, `@/common/...`: app code
  - `@client/...`, `@server/...`, `@common/...`: Proteum core modules
  - `@app`: server-side application services for manual routes only
  - `@generated/*`: generated app surfaces

## Dependency Selection

- Before implementing a feature or change, first check whether the repo already includes a suitable dependency.
- If not, search npm before building a new utility, abstraction, component primitive, parser, formatter, or integration from scratch.
- Prefer the most popular, flexible, maintained packages that fit the project constraints.
- Follow project-root `optimizations.md` when deciding whether custom infrastructure is justified over an existing package.
- When you choose custom over a package, explain the reason briefly.

## Catalogs And Typing

- Keep one canonical catalog or registry file and import it everywhere else.
- Client-only catalogs live in `/client/catalogs/**`, server-only catalogs in `/server/catalogs/**`, and shared catalogs in `/common/catalogs/**`.
- Do not create nested `catalogs/` folders under pages, components, services, tests, or other feature folders.
- Keep strong TypeScript typings across the project.
- Do not introduce `any` or `unknown`, including through casts, helper aliases, or fallback generic defaults.
- Fix typing issues only on code you wrote.
- Never cast with `as any` or `as unknown`; fix the contract or add an explicit typed adapter.

## Design Rules

- Prefer explicit `server/index.ts` bootstrap over hidden registration.
- Prefer controller-backed app APIs over ad hoc manual `/api/...` routes.
- Prefer service classes over server helpers with hidden dependencies.
- Keep one canonical source of truth for catalogs, registries, and shared types.
- Reuse shared Shadcn-based UI primitives when the project already provides them.

## Discouraged Patterns

- request-scoped state inside normal service methods
- hiding route registration behind abstractions that remove the top-level `Router.page(...)` call
- editing `.proteum` directly

## Verification

Verify at the correct layer:

- route additions: boot the app and hit the real URL
- controller changes: exercise the generated client call or generated `/api/...` endpoint
- SSR changes: load the real page and inspect rendered HTML plus browser console
- router or plugin changes: verify request context, auth, redirects, metrics, and validation on a running app
- For trace-first reproduction, session-based auth setup, temporary logs, and post-fix surface checks, follow project-root `diagnostics.md`.

Useful commands: `npx proteum init <dir> --name <name>`, `npx proteum create <kind> <target>`, `proteum dev`, `proteum dev list --json`, `proteum dev stop --session-file <path>`, `npx proteum refresh`, `npx proteum typecheck`, `npx proteum lint`, `npx proteum check`, `npx proteum build prod`, `npx proteum build --prod --analyze`, `npx proteum build --prod --analyze --analyze-serve --analyze-port auto`, `npx proteum perf top`, `npx proteum perf request <requestId|path>`, `npx proteum perf compare --baseline yesterday --target today`, `npx proteum command <path>`, `npx proteum session <email> --role <role>`.

## High-Impact Files

Edit these only when required, and keep changes minimal and explicit:

- `tsconfig*.json`
- `PORT`, `ENV_*`, `URL`, and `TRACE_*` env setup
- Prisma-generated files
- symbolic links

## Commands Not To Run

- `git restore`
- `git reset`
- `prisma *`
- any write-mode git command

## Product And UX Docs

If the task changes UX, copy, onboarding, pricing, product semantics, or commercial positioning, read the relevant files under `./docs/` first, especially `docs/PERSONAS.md`, `docs/PRODUCT.md`, and `docs/MARKETING.md` when they exist.
