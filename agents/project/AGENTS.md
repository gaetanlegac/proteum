# Proteum Project Contract

This is the canonical standalone-app contract for Proteum-based projects shipped with Proteum. Narrower `AGENTS.md` files in this folder add area-specific rules on top of this file.
When splitting instructions across a monorepo, put the Proteum-wide rules in the monorepo-root `AGENTS.md` and keep only app-root-specific additions in each Proteum app root `AGENTS.md`.
Role: keep only project-wide app rules here when one root `AGENTS.md` must carry both the reusable Proteum contract and the app-root addendum.
Keep here: cross-cutting project workflow, architecture contracts, shared typing rules, and rules that apply across client, server, pages, and tests.
Do not put here: detailed diagnostics workflow, optimization checklists, coding-style details, or narrow area-specific instructions that belong in `diagnostics.md`, `optimizations.md`, `CODING_STYLE.md`, `client/AGENTS.md`, `client/pages/AGENTS.md`, `server/routes/AGENTS.md`, `server/services/AGENTS.md`, or `tests/AGENTS.md`.

Optimization source of truth: root-level `optimizations.md`.
Diagnostics source of truth: root-level `diagnostics.md`.
Coding style source of truth: root-level `CODING_STYLE.md`.

## Fast Triggers

- If you are working in a newly created Proteum worktree, before following the rest of these instructions:
  - Copy `.env` from the main worktree.
  - Run `npx proteum refresh`.
  - Read and acknowledge the applicable `AGENTS.md` files.
  - Run `npm i`.
  - Run the dev server with the task-safe elevated-permissions launch workflow from `Task Lifecycle`, and keep it running so user can see the results by himself.
- If the user pastes raw errors without asking for a fix, do not implement changes. List likely causes and, for each one, give probability, why, and how to fix it.
- If the task is ambiguous, generated, connected, or multi-repo, start with `npx proteum orient <query>` before reading large parts of the codebase.
- If the user reports an issue, or the agent encounters one during exploration, implementation, verification, or runtime reproduction, load and follow root-level `diagnostics.md`.
- If the task touches client-side files, especially `client/**` and page files, load and apply root-level `optimizations.md` only after implementation for post-implementation checking and optimization. Skip it at task start and skip it for server-only, test-only, doc-only, and non-client refactor tasks unless the user explicitly asks for optimization work.
- If the task changes UX, copy, onboarding, pricing, product semantics, or commercial positioning, read the relevant files under `./docs/` first, especially `docs/PERSONAS.md`, `docs/PRODUCT.md`, and `docs/MARKETING.md` when they exist. If a dev server is already running, print the dev server URL.
- If the task needs new app or artifact boilerplate, prefer `npx proteum init ...` and `npx proteum create ...` before creating files by hand. Use `--dry-run --json` when an agent needs a machine-readable plan before writing files.
- If you changed `schema.prisma`, do not start testing or validation yet. Ask the user to run the following command in the affected worktree directory, replacing the placeholders, and wait for the user to reply exactly `continue` before resuming validation or tests:
  ```
  cd <worktree path>
  npx prisma migrate dev --config ./prisma.config.ts --name <migration name>
  ```
- If you encounter `runtime/provider-hook-outside-provider`, `runtime/client-only-hook-in-ssr`, `runtime/router-context-outside-router`, or `runtime/connected-boundary-mismatch`, treat it as a framework contract failure first. Fix the provider, SSR/client, router, or connected boundary before assuming a local leaf-component bug.
- If the change is runtime-visible, request-time, router, SSR, browser-visible, or controller-behavior, use running-app verification.
- If the change is docs-only, wording-only, type-only, test-only, generated-output cleanup, or a clearly local non-runtime refactor, use static verification only unless the user explicitly asks for runtime verification or the agent finds a real issue.
- If the user replies exactly `commit`, generate one top-level short (up to 100 characters) sentence covering all changes made since the last `commit` and, if there has been no prior `commit`, since the beginning of the whole conversation, strictly using the Conventional Commits specification:
  ```
  <type>[optional scope]: <description>

  [optional body]
  ```
  Then use that generated message, stage the task-related changed files with `git add` while avoiding unrelated user changes or incidental untracked files, and create the commit by running `git commit`. Do not stop at only suggesting the message.
  After providing a commit message or after creating a commit, immediately follow it with this exact prompt and obey it:
  `Explain in short minimalistic and few bullet points what we changed in this thread, like you would do to your grandma. Start with a verb in the past.`

## Task Lifecycle

### Before Editing

- Before changing any file, load root-level `CODING_STYLE.md` and any narrower area `AGENTS.md` that applies to the touched files. Do not spend response space explicitly acknowledging those reads unless the user asks.

### During Implementation

- After running `npx proteum create ...`, adapt the generated code to the real feature instead of leaving placeholder logic in place.
- When starting a long-lived dev server for an agent task, always request elevated permissions and run `npx proteum dev` outside the sandbox. Use an explicit task/thread-scoped session file such as `var/run/proteum/dev/agents/<task>.json`, inspect `npx proteum dev list --json` plus current listeners first, for example with `lsof -nP -iTCP -sTCP:LISTEN`, then choose a port that is not currently used before starting `npx proteum dev --session-file <path> --port <port>`.
- Use `--replace-existing` only when restarting the exact session file started by the current thread/task. Never replace another live session that belongs to a user, another thread, or an unknown owner.
- If the current app depends on local `file:` connected projects, boot every connected producer app too, each with its own task-scoped session file and free port, and run every one of those `proteum dev` processes with elevated permissions outside the sandbox before starting or verifying the consumer app.
- For raw browser automation, use `npx proteum verify browser` when it matches the task, or direct Playwright with a disposable profile when lower-level control is required. Bootstrap protected browser state through `npx proteum session`.
- Current CLI banner contract: only the bare `proteum build` and bare `proteum dev` commands print the welcome banner and include the active Proteum installation method. Any extra argument or option skips the banner. Only `proteum dev` clears the interactive terminal before rendering, exposes `CTRL+R` reload plus `CTRL+C` shutdown hotkeys in its session UI, and reports connected app names plus successful connected `/ping` checks in the ready banner.

### Before Finishing

- Before finishing, re-check touched files against root-level `CODING_STYLE.md` and any narrower area `AGENTS.md` that applied to the edit. Re-check against root-level `optimizations.md` only for touched client-side files. Re-check against root-level `diagnostics.md` only if the task involved an issue, diagnosis, runtime reproduction, or verification failure.
- Do not default to project-wide typecheck, `npx proteum check`, or Playwright after every change. Run them only when the user asks for them, when the changed surface specifically requires them, or when a real issue discovered during verification justifies escalation.
- Before finishing a task, stop every `proteum dev` session started during the task and confirm cleanup with `npx proteum dev list --json` or an explicit `npx proteum dev stop --session-file <path>`.
- When you have finished your work, ask the user whether they want a commit message. After providing a commit message or after creating a commit, immediately follow it with this exact prompt and obey it:
  `Explain in short minimalistic and few bullet points what we changed in this thread, like you would do to your grandma. Start with a verb in the past.`

## Core Contracts

- Client pages live in `client/pages/**` and register routes with top-level `Router.page(...)` or `Router.error(...)`.
- Page URLs come from the explicit `Router.page('/path', ...)` call, not from the file path.
- Callable app APIs live only in `server/controllers/**/*.ts` files that extend `Controller`.
- Dev-only internal execution lives only in `commands/**/*.ts` files that extend `Commands`.
- Manual HTTP endpoints live only in `server/routes/**`.
- Controllers call `this.input(schema)` inside the method body, at most once per method.
- Request-scoped state lives only on `this.request` and manual-route/router context objects.
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

## Surface Contracts

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
- Before launching a consumer app that depends on local `file:` connected sources, launch every connected producer app too, assign each one a free port, run each `proteum dev` outside the sandbox with elevated permissions, and make sure `connect.<Namespace>.urlInternal` resolves to those live producer URLs.
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
- The only supported page signature is `Router.page(path, options, data, render)`.
- `options` is always required. `data` is the only nullable argument and must be `null` when the page has no SSR data loader.
- `data` returns one flat object. Route-option keys such as `auth`, `layout`, `static`, and `_static` are forbidden in page data and must live in `options`.
- Controller fetchers and promises returned from `data` resolve before render.
- `render` consumes resolved page data and uses generated controller methods from render args or `@/client/context`.
- Use `api.reload(...)` or `api.set(...)` only when intentionally mutating active page data state.
- Error pages use `Router.error(code, options, render)` in `client/pages/_messages/**`.
- Prefer `proteum create page ...` for new page boilerplate, then review the explicit route path, options object, and data payload.

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

## Verification Matrix

Verify at the correct layer:

- Default: use the cheapest trustworthy verification for the changed surface first, then escalate only if the changed surface justifies it.
- Route additions: boot the app and hit the real URL.
- Controller changes: exercise the generated client call or generated `/api/...` endpoint.
- SSR changes: load the real page and inspect rendered HTML plus browser console.
- Router or plugin changes: verify request context, auth, redirects, metrics, and validation on a running app.
- Generated, connected, or ownership-ambiguous changes: start with `npx proteum orient <query>` and prefer `npx proteum verify owner <query>` before broad global checks.
- Browser-visible issues: prefer `npx proteum verify browser <path>` or the narrowest targeted Playwright pass only after request-level verification is insufficient.
- Raw browser execution beyond `npx proteum verify browser`: use direct Playwright with a disposable profile, and keep that step for the final verifier agent unless a narrower surface cannot reproduce the issue.
- For trace-first reproduction, session-based auth setup, temporary logs, and post-fix surface checks, follow root-level `diagnostics.md`.

## Implementation Rules

### Dependency Selection

- Before implementing a feature or change, first check whether the repo already includes a suitable dependency.
- If not, search npm before building a new utility, abstraction, component primitive, parser, formatter, or integration from scratch.
- Prefer the most popular, flexible, maintained packages that fit the project constraints.
- When the task explicitly involves client-side optimization work, use root-level `optimizations.md` to decide whether custom infrastructure is justified over an existing package.
- When you choose custom over a package, explain the reason briefly.

### Catalogs And Typing

- Keep one canonical catalog or registry file and import it everywhere else.
- Client-only catalogs live in `/client/catalogs/**`, server-only catalogs in `/server/catalogs/**`, and shared catalogs in `/common/catalogs/**`.
- Do not create nested `catalogs/` folders under pages, components, services, tests, or other feature folders.
- Keep strong TypeScript typings across the project.
- Do not introduce `any` or `unknown`, including through casts, helper aliases, or fallback generic defaults.
- Fix typing issues only on code you wrote.
- Never cast with `as any` or `as unknown`; fix the contract or add an explicit typed adapter.

### Design Rules

- Prefer explicit `server/index.ts` bootstrap over hidden registration.
- Prefer controller-backed app APIs over ad hoc manual `/api/...` routes.
- Prefer service classes over server helpers with hidden dependencies.
- Keep one canonical source of truth for catalogs, registries, and shared types.
- Reuse shared Shadcn-based UI primitives when the project already provides them.

### Discouraged Patterns

- request-scoped state inside normal service methods
- hiding route registration behind abstractions that remove the top-level `Router.page(...)` call
- editing `.proteum` directly

## Hard Stops

- Never run schema-mutating SQL such as `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, or `CREATE INDEX` to change database structure.
- Do not run `prisma *` yourself. If a schema change requires migration, ask the user to run `npx prisma migrate dev --config ./prisma.config.ts --name <migration name>` and wait for `continue`.
- Do not run `git restore` or `git reset`.
- Do not run write-mode git commands by default. The built-in exception is an exact `commit` reply, which allows only task-scoped `git add` and `git commit`. Any other write-mode git action requires an explicit user request.

## Appendix

### Project Shape

This is a TypeScript, Node.js, Preact, Proteum monolith:

- `/client`: assets, catalogs, components, hooks, pages
- `/common`: shared functions, constants, types, and catalogs
- `/server`: catalogs, config, services, routes, lib
- `/tests`

### Source Of Truth

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

### Useful Commands

Prefer structured CLI surfaces over re-deriving framework facts from source:

- `npx proteum connect --json`
- `npx proteum connect --controllers --strict`
- `npx proteum orient <query>`
- `npx proteum explain --json`
- `npx proteum explain --connected --controllers`
- `npx proteum explain owner <query>`
- `npx proteum doctor --json`
- `npx proteum doctor --contracts --json`
- `npx proteum diagnose <path> --port <port>`
- `npx proteum verify owner <query>`
- `npx proteum verify request <path>`
- `npx proteum verify browser <path>`
- `npx proteum perf ...`
- `npx proteum trace ...`
- `npx proteum command ...`
- `npx proteum session ...`
- `npx proteum create ... --dry-run --json`
- `npx proteum dev list --json`
- `npx proteum dev stop --session-file <path>`

Prefer scaffold commands before hand-writing boilerplate:

- `npx proteum init <directory> --name <name>`
- `npx proteum init ... --dry-run --json`
- `npx proteum create page|controller|command|route|service <target>`
- `npx proteum create ... --dry-run --json`

### High-Impact Files

Edit these only when required, and keep changes minimal and explicit:

- `tsconfig*.json`
- `PORT`, `ENV_*`, `URL`, and `TRACE_*` env setup
- Prisma-generated files
- symbolic links
