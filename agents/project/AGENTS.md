# Proteum Project Contract

This is the canonical standalone-app contract for Proteum-based projects shipped with Proteum. Narrower `AGENTS.md` files in this folder add area-specific rules on top of this file.
When splitting instructions across a monorepo, put the Proteum-wide rules in the monorepo-root `AGENTS.md` and keep only app-root-specific additions in each Proteum app root `AGENTS.md`.
Role: keep only project-wide app rules here when one root `AGENTS.md` must carry both the reusable Proteum contract and the app-root addendum.
Keep here: cross-cutting project workflow, architecture contracts, shared typing rules, and rules that apply across client, server, pages, and tests.
Do not put here: documentation-driven coding workflow, detailed diagnostics workflow, optimization checklists, coding-style details, or narrow area-specific instructions that belong in `DOCUMENTATION.md`, `diagnostics.md`, `optimizations.md`, `CODING_STYLE.md`, `client/AGENTS.md`, `client/pages/AGENTS.md`, `server/routes/AGENTS.md`, `server/services/AGENTS.md`, or `tests/AGENTS.md`.

Documentation source of truth: root-level `DOCUMENTATION.md`.
Optimization source of truth: root-level `optimizations.md`.
Diagnostics source of truth: root-level `diagnostics.md`.
Coding style source of truth: root-level `CODING_STYLE.md`.

Managed compact root routers must use trigger -> canonical instruction file references, not copied summaries of this contract. If a trigger points here, load this full file before acting and keep the source rule here.

## Fast Triggers

- If `cwd` is inside `/.codex/worktrees/`, run Worktree Preflight before implementation:
  - Run `npx proteum worktree init --source <source-app-root>` when the bootstrap marker is missing.
  - Run `npx proteum worktree init --source <source-app-root> --refresh` when Proteum reports stale bootstrap state.
  - Use `--skip-deps --reason "..."` only when dependency installation is intentionally skipped.
  - Run `npx proteum runtime status`.
  - For runtime-visible work, start or reuse one tracked `npx proteum dev` session using the Task Lifecycle launch workflow.
- If you are working in a newly created Proteum worktree, before following the rest of these instructions:
  - Run `npx proteum worktree init --source <source-app-root>`.
  - Read and acknowledge the applicable `AGENTS.md` files.
  - Run the dev server with the task-safe elevated-permissions launch workflow from `Task Lifecycle`, keep it running so user can see the results by himself, and print the live server URL as a clickable Markdown link.
- If the user pastes raw errors without asking for a fix, do not implement changes yet. First run the task-safe local reproduction path: identify the likely app, route, command, or request from the error, boot or reuse the relevant dev server with the elevated-permissions workflow in `Task Lifecycle`, reproduce the failing surface locally, and inspect server output, browser console output, diagnostics, traces, or the smallest relevant command result. If the error does not identify enough context to reproduce, say what is missing and use the available local evidence before guessing. Then list likely causes and, for each one, give probability, why, and how to fix it. After this, every time you implement a fix:
    - test, re-run analysis and give a comparison table of before and after
    - re-print the complete list of suggested fixes, but strike the ones we already implemented or not necessary anymore
- If the user asks to implement a feature, first inspect the relevant existing surface and state any implementation problem, pain point, attention point, inconsistency, missing information, or question you see. If anything needs clarification or a decision, pause before editing, ask the user what decision to take, and resume only after the user answers.
- If the task is ambiguous, generated, connected, or multi-repo, start with MCP `workflow_start` and then MCP `orient { projectId, query }` only if the bootstrap did not return a sufficient owner or next action; use `npx proteum orient <query>` only when MCP is unavailable or terminal evidence is required.
- Treat Proteum CLI and MCP output as the workflow router. Treat instruction previews returned by MCP `workflow_start` or `instructions_resolve { projectId }` as the allowed instruction scope for read-only discovery and diagnostics. Read full file contents only before edits or git writes, when returned `fullRead`/`fullReadPolicy` requires it, or when the compact preview is insufficient. Do not read broad instruction folders or every managed instruction file up front.
- When a Proteum MCP client is available, first call MCP `workflow_start` with `cwd` or a known `projectId`. If it is ambiguous or returns offline app candidates, call `project_resolve { cwd }`, select the intended app root, start exactly one dev server from that app root when needed, then retry `workflow_start`. Pass the returned live `projectId` to every follow-up app-bound MCP tool. `npx proteum dev` ensures one managed machine MCP daemon is running; do not start a second managed daemon. Prefer MCP `runtime_status`, `orient`, `instructions_resolve`, `explain_summary`, `route_candidates`, `doctor`, `diagnose`, `trace_show`, `perf_request`, `logs_tail`, and `db_query` for read-only runtime/status/orientation/owner/route/trace/perf/log/database reads. Do not run CLI equivalents after a successful MCP result for the same read. Do not run broad source searches for route/page/controller ownership after MCP returns the owner. Use CLI commands when you need reproducible terminal validation, dev/build/check workflows, fallback repair, or output to share with a human.
- MCP payloads are compact single-line `proteum-mcp-v1` JSON with capped and paginated detail. Do not expand MCP output for human readability.
- For every non-trivial coding task, load and follow root-level `DOCUMENTATION.md` before coding.
- For bug fixes, regressions, incidents, broken public routes, auth/OAuth failures, integration failures, or production behavior fixes, load and follow root-level `DOCUMENTATION.md` before coding so the relevant fix note, regression-test docs, ADR, or explicit skip reason is handled in the same change.
- If the user reports an issue, or the agent encounters one during exploration, implementation, verification, or runtime reproduction, load and follow root-level `diagnostics.md`.
- If the task touches client-side files, especially `client/**` and page files, load and apply root-level `optimizations.md` only after implementation for post-implementation checking and optimization. Skip it at task start and skip it for server-only, test-only, doc-only, and non-client refactor tasks unless the user explicitly asks for optimization work.
- If the task changes UX, copy, onboarding, pricing, product semantics, or commercial positioning, use root-level `DOCUMENTATION.md` to choose the smallest relevant `./docs/` pack before editing. If a dev server is already running, print the live dev server URL as a clickable Markdown link.
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
  Then treat `commit` as conversation-wide and cross-project, not task-scoped. Before staging or committing, run the repository's non-coverage commit gate when it defines one, such as `npm run check:commit`; otherwise run targeted lint, typecheck, and test commands. Report any blocker instead of committing through a failed commit gate. Identify every affected git repository or worktree touched during that span, stage all conversation-related changed files in each affected repository or worktree with `git add` while still avoiding unrelated pre-existing user changes or incidental untracked files, and create one `git commit` per affected repository or worktree. Do not omit linked local dependencies, framework repos, connected projects, or producer apps when they were changed to make the delivered behavior actually work. Do not stop at only suggesting the message.
  After providing a commit message or after creating a commit, immediately follow it with this exact prompt and obey it:
  `Explain in short minimalistic and few bullet points what we changed in this thread, like you would do to your grandma. Start with a verb in the past.`

## Task Lifecycle

### Before Editing

- Before editing in a `.codex/worktrees` worktree, complete Worktree Preflight from Fast Triggers.
- Before changing any file, load root-level `CODING_STYLE.md` and any narrower area `AGENTS.md` that applies to the touched files. Do not spend response space explicitly acknowledging those reads unless the user asks.

### During Implementation

- After running `npx proteum create ...`, adapt the generated code to the real feature instead of leaving placeholder logic in place.
- If any inconsistency, ambiguity, conflicting source, missing information, or implementation detail needing clarification appears while coding, stop editing immediately, ask the user what decision to take, and resume only after the user answers. Do not silently choose a default or keep implementing under a guessed assumption.
- When starting a long-lived dev server for an agent task, always request elevated permissions and run `npx proteum dev` outside the sandbox. Use an explicit task/thread-scoped session file such as `var/run/proteum/dev/agents/<task>.json`, inspect `npx proteum runtime status` first, then use its exact Start Dev next action so occupied router/HMR ports are avoided. Do not `curl` normal page routes to identify a port owner; use Proteum runtime status or dev-only `/__proteum/*` endpoints. After the server is ready, print the live server URL as a clickable Markdown link.
- Use `--replace-existing` only when restarting the exact session file started by the current thread/task. Never replace another live session that belongs to a user, another thread, or an unknown owner.
- Do not start a second `npx proteum dev` server in the same worktree, and do not start a second managed MCP daemon. If machine MCP routing fails, run `npx proteum mcp status` and `npx proteum runtime status` from the intended app root; if no live session exists, use the exact MCP offline or runtime-status next action instead of assuming the manifest default port. If the same app already responds on the configured port without live tracking, use or repair that runtime instead of starting another server. If a live session exists but runtime/MCP is unreachable, stop the listed session file first, then start dev again. Do not run diagnose, trace, or perf reads while runtime health is unreachable. Then retry MCP `workflow_start` and use the returned `projectId`.
- If the current app depends on local `file:` connected projects, boot every connected producer app too, each with its own task-scoped session file and free port, and run every one of those `proteum dev` processes with elevated permissions outside the sandbox before starting or verifying the consumer app.
- During `npx proteum dev`, the app exposes the read-only Proteum MCP runtime endpoint at `/__proteum/mcp`; use it for repeated agent reads instead of spawning equivalent diagnostics commands. For route/page/controller ownership, prefer MCP `workflow_start`, `route_candidates { projectId, query }`, or `explain_summary { projectId, query }` over broad `npx proteum explain --routes --controllers --full` dumps.
- For browser validation, use the browser MCP against the running app. Keep Playwright inside `npx proteum e2e --port <port>` for targeted/full end-to-end suites. Bootstrap protected browser MCP state with `npx proteum session`; bootstrap protected E2E runs with `npx proteum e2e --session-email <email> --session-role <role>`.
- Current CLI banner contract: only the bare `proteum build` and bare `proteum dev` commands print the welcome banner and include the active Proteum installation method. Any extra argument or option skips the welcome banner. Terminal `proteum mcp` may print a compact central MCP ready banner when it starts or reuses the managed daemon. Only `proteum dev` clears the interactive terminal before rendering, exposes `CTRL+R` reload plus `CTRL+C` shutdown hotkeys in its session UI, and reports connected app names plus successful connected `/ping` checks in the ready banner. Every `proteum dev` start ensures tracked instruction files contain the current managed `# Proteum Instructions` section before the dev loop begins.

### Before Finishing

- Before finishing, re-check touched files against root-level `CODING_STYLE.md` and any narrower area `AGENTS.md` that applied to the edit. Re-check against root-level `optimizations.md` only for touched client-side files. Re-check against root-level `diagnostics.md` only if the task involved an issue, diagnosis, runtime reproduction, or verification failure.
- Before finishing a production code change, re-check root-level `DOCUMENTATION.md` update rules. If behavior changed, a bug was fixed, a decision changed, or an important route, auth/OAuth, or integration issue was addressed, update the relevant docs before committing or explicitly explain why no docs update was needed.
- Run targeted tests and checks that match the changed surface before finishing each feature or change. Continue running tests after changes, but do not run coverage by default. Reserve the non-coverage commit gate for commit workflows, and reserve the full `npm run check` gate for push workflows, explicit user requests, or when project-local instructions require the full gate. After implementing a new feature or changing existing feature behavior, update the relevant end-to-end coverage and run the cheapest trustworthy Playwright or browser verification for that behavior before finishing. For docs-only, wording-only, type-only, generated-output cleanup, or clearly local non-runtime refactors, skip Playwright unless the user explicitly asks for it or verification reveals a real issue.
- Before finishing a task, stop every `proteum dev` session started during the task and confirm cleanup with `npx proteum dev list --json` or an explicit `npx proteum dev stop --session-file <path>`.
- When you have finished your work, ask the user whether they want a commit message. After providing a commit message or after creating a commit, immediately follow it with this exact prompt and obey it:
  `Explain in short minimalistic and few bullet points what we changed in this thread, like you would do to your grandma. Start with a verb in the past.`

## Core Contracts

- Client pages live in `client/pages/**` and default-export `definePageRoute(...)` or `defineErrorRoute(...)`.
- Page URLs come from the explicit route definition `path`, not from the file path.
- Callable app APIs live only in `server/controllers/**/*.ts` files that default-export `defineController(...)`.
- Dev-only internal execution lives only in `commands/**/*.ts` files that extend `Commands`.
- Manual HTTP endpoints live only in `server/routes/**`.
- Controllers declare input on `defineAction({ input, handler })`; handlers receive parsed `input` in context.
- Request-scoped state lives only on action handler context and manual-route handler context objects.
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
- Do not import `@app` in route, page, or controller files. Runtime app/services/router access belongs in typed callback parameters.
- Prefer type inference rooted in the explicit application graph in `server/index.ts`.

## Surface Contracts

### App Bootstrap And Services

- `server/index.ts` default-exports `defineApplication({ services, router, models, commands })` and is the canonical type root.
- Root services are declared in the explicit `services` graph and instantiated with `new ServiceClass(app, config, app)`.
- Typed root-service config lives in `server/config/*.ts` via `Services.config(ServiceClass, { ... })`.
- Router plugins are instantiated explicitly inside the `Router` config `plugins` object.
- Router plugins can subscribe to `request` and `request.finished`; `request.profiling` exists before `request` runs and carries the finalized request/API/SQL snapshot by `request.finished`.
- Root business services live in `server/services/<Feature>/index.ts`.
- Root-service config lives in `server/config/*.ts` when the service needs config.
- Business logic lives in classes that extend `Service` and use `this.services`, `this.models`, and `this.app`.
- Keep auth, input parsing, locale, cookies, and request-derived values in controllers, then pass explicit typed arguments into services.
- Split growing features into explicit subservices.
- Companion client-callable entrypoints live in `server/controllers/**`.
- `proteum create service ...` scaffolds the service file, a typed config export under `server/config/*.ts`, and the root registration in `server/index.ts`; review and adapt the generated names before committing.

Example app root shape; replace names with the project app type and service names:

```ts
import { defineApplication, type Application } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';
import BillingService from '@/server/services/Billing';

import * as appConfig from '@/server/config/app';

type ProjectServices = {
    Billing: BillingService;
};

type ProjectRouterPlugins = {
    schema: SchemaRouter;
};

export type ProjectRouter = Router<ProjectApp, ProjectRouterPlugins>;
export interface ProjectApp extends Application, ProjectServices {
    Router: ProjectRouter;
}

const createProjectRouter = (app: ProjectApp): ProjectRouter =>
    new Router<ProjectApp, ProjectRouterPlugins>(
        app,
        {
            ...appConfig.routerBaseConfig,
            plugins: {
                schema: new SchemaRouter({}, app),
            },
        },
        app,
    );

const ProjectApplication = defineApplication<ProjectServices, ProjectRouter>({
    services: (app) => ({
        Billing: new BillingService(app, {}, app),
    }),
    router: createProjectRouter,
});

export default ProjectApplication;
```

### Connected Projects

- Declare connected namespaces in `proteum.config.ts` with explicit values such as `connect: { Product: { source: PRODUCT_CONNECTED_SOURCE, urlInternal: PRODUCT_URL_INTERNAL } }`.
- Proteum does not infer connected env key names from the namespace. The source and internal URL must be provided explicitly in `proteum.config.ts`.
- Use `npx proteum connect` to inspect configured connect values, cached contract state, and imported controllers for the current app.
- Before launching a consumer app that depends on local `file:` connected sources, launch every connected producer app too, assign each one a free port, run each `proteum dev` outside the sandbox with elevated permissions, and make sure `connect.<Namespace>.urlInternal` resolves to those live producer URLs.
- `file:` connected sources point at another Proteum app root and keep strong connected typings.
- Non-local connected sources provide runtime helper generation but are intentionally typed loosely.

### Controllers

- Files live under `server/controllers/**/*.ts` and default-export `defineController({ path, actions })`.
- Actions declared with `defineAction(...)` become generated client-callable endpoints.
- Route path comes from the controller `path` plus the action name.
- Set `path: 'Custom/path'` on `defineController(...)` to override the base path.
- Generated client calls use `POST`.
- Prefer `proteum create controller ...` for new controller boilerplate, then adapt the generated method to real service calls.

```ts
import { defineAction, defineController, schema } from '@server/app/controller';

export default defineController({
    path: 'Billing',
    actions: {
        read: defineAction({
            input: schema.object({ accountId: schema.string() }),
            handler: ({ input }) => ({ accountId: input.accountId }),
        }),
    },
});
```

### Commands

- Files live under `commands/**/*.ts` and default-export a class extending `Commands` from `@server/app/commands`.
- Methods with bodies become generated dev commands.
- Command path comes from the file path plus the method name.
- `export const commandPath = 'Custom/path'` can override the base path.
- Commands are for dev-only internal execution through `proteum command ...` or the profiler `Commands` tab.
- Keep command logic internal; do not turn it into a normal controller unless it is a real app API.
- Prefer `proteum create command ...` for new command boilerplate.

### Client Pages

- Proteum scans page files for default-exported `definePageRoute(...)` and `defineErrorRoute(...)` definitions.
- File path controls chunk identity and layout discovery; route path comes from the explicit definition `path` value.
- The supported page shape is `definePageRoute({ path, options, data, render })`.
- `options` is always required. `data` is the only nullable argument and must be `null` when the page has no SSR data loader.
- `data` returns one flat object. Route-option keys such as `auth`, `layout`, `static`, and `_static` are forbidden in page data and must live in `options`.
- Controller fetchers and promises returned from `data` resolve before render.
- `render` consumes resolved page data and uses generated controller methods from render args or `@/client/context`.
- Use `api.reload(...)` or `api.set(...)` only when intentionally mutating active page data state.
- Error pages use `defineErrorRoute({ code, options, render })` in `client/pages/_messages/**`.
- Prefer `proteum create page ...` for new page boilerplate, then review the explicit route path, options object, and data payload.

```tsx
import { definePageRoute } from '@common/router/definitions';

export default definePageRoute({
    path: '/billing',
    options: { auth: true },
    data: ({ BillingController }) => ({ billing: BillingController.read({ accountId: 'current' }) }),
    render: ({ billing }) => <BillingPage billing={billing} />,
});
```

### Manual Routes

- Use `server/routes/**` only for explicit HTTP behavior that should not be a generated controller action.
- Good fits include redirects, sitemap or RSS output, OAuth callbacks, webhooks, and public resources with custom semantics.
- Receive app services through `defineServerRoutes((app) => [...])` and use handler context for `request`, `response`, router plugins, and custom router context.
- If the route is a normal app API, prefer a controller.
- Prefer `proteum create route ...` for new manual-route boilerplate.

```ts
import { defineServerRoute } from '@common/router/definitions';

export default defineServerRoute({
    method: 'GET',
    path: '/health',
    options: {},
    handler: ({ response }) => response.json({ ok: true }),
});
```

### Models And Aliases

- Use Prisma typings from `@models/types`.
- Use runtime models through `this.models` or `this.app.Models.client`.
- Keep Prisma runtime access inside services when possible and prefer explicit `select` or narrow `include`.
- Do not import runtime values from `@models` or edit generated Prisma client files.
- Aliases:
  - `@/client/...`, `@/server/...`, `@/common/...`: app code
  - `@client/...`, `@server/...`, `@common/...`: Proteum core modules
  - `@generated/*`: generated app surfaces

## Verification Matrix

Verify at the correct layer:

- Default: use the cheapest trustworthy verification for the changed surface, including targeted tests for changed behavior. Do not run coverage by default during ordinary change closeout.
- Route additions: boot the app and hit the real URL.
- Controller changes: exercise the generated client call or generated `/api/...` endpoint.
- SSR changes: use the browser MCP to load the real page and inspect rendered HTML plus browser console.
- Router or plugin changes: verify request context, auth, redirects, metrics, and validation on a running app.
- New features or feature-behavior changes: use the cheapest trustworthy verification while iterating, use the browser MCP for browser-visible validation, then update and run the relevant end-to-end coverage. Save the non-coverage commit gate for commit workflows and the full `npm run check` gate for push workflows unless the user or project-local instructions explicitly ask for the full gate earlier.
- Generated, connected, or ownership-ambiguous changes: start with MCP `workflow_start`, then `orient { projectId, query }` and `explain_summary { projectId, query }` only when more detail is needed; use `npx proteum orient <query>` and `npx proteum verify owner <query>` when MCP is unavailable or terminal evidence is required.
- Browser-visible issues: use the browser MCP after request-level verification is insufficient. Use `npx proteum e2e --port <port> ...` only when automated end-to-end coverage or a Playwright suite is required.
- Raw browser execution outside end-to-end suites: use the browser MCP only. Keep Playwright in `npx proteum e2e --port <port>` for targeted/full end-to-end suites.
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
- Do not use `Reflect.get`, bracket access, broad `in` checks, or local loose reader helpers to bypass missing typings for app-owned data; fix the type contract or normalize once with a typed adapter at the boundary.
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
- hiding route definitions behind abstractions that remove the default-exported `definePageRoute(...)` or `defineServerRoute(...)` contract
- editing `.proteum` directly

## Hard Stops

- Never run schema-mutating SQL such as `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, or `CREATE INDEX` to change database structure.
- For read-only SQL diagnosis, use MCP `db_query` or `npx proteum db query "<sql>"`; only one capped `SELECT`, `SHOW`, or `EXPLAIN` statement is allowed.
- Do not run `prisma *` yourself. If a schema change requires migration, ask the user to run `npx prisma migrate dev --config ./prisma.config.ts --name <migration name>` and wait for `continue`.
- Do not run `git restore` or `git reset`.
- Do not run write-mode git commands by default. The built-in exception is an exact `commit` reply, which allows `git add` and `git commit` in every affected repository or worktree touched during the whole conversation after the repository's non-coverage commit gate passes when it defines one, such as `npm run check:commit`. Any other write-mode git action requires an explicit user request. Before any explicit push, run `npm run check` in every affected repository or worktree that defines it and report any blocker instead of pushing through a failed check.

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
- `process.env` via `PORT`, `ENV_*`, `URL`, `URL_INTERNAL`, any app-chosen connected-project values referenced by `proteum.config.ts`, `TRACE_*`, and `ENABLE_PROFILER`
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

- `npx proteum connect`
- `npx proteum connect --controllers --strict`
- `npx proteum orient <query>`
- `npx proteum runtime status`
- `npx proteum mcp`
- `npx proteum explain`
- `npx proteum explain --manifest`
- `npx proteum explain --connected --controllers`
- `npx proteum explain --connected --controllers --full` only when raw connected/controller arrays are required
- `npx proteum explain owner <query>`
- `npx proteum doctor`
- `npx proteum doctor --contracts`
- `npx proteum diagnose <path> --port <port>`
- `npx proteum verify owner <query>`
- `npx proteum verify request <path>`
- `npx proteum perf ...`
- `npx proteum trace latest`
- `npx proteum trace show <requestId> --events`
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
- `PORT`, `ENV_*`, `URL`, `TRACE_*`, and `ENABLE_PROFILER` env setup
- Prisma-generated files
- symbolic links

## Delivery Workflow

Agents working in generated Proteum projects must use this delivery workflow for production code changes:

1. BDD / ATDD: translate the requested behavior into acceptance scenarios before changing implementation code.
2. TDD: write or update the smallest failing unit/integration test that proves the next behavior.
3. Implementation: make the narrowest production change that satisfies the failing test while preserving Proteum boundaries.
4. Targeted validation: refresh generated framework contracts after route, page, controller, service, command, or config changes, then run the targeted tests/checks that match the changed surface.
5. Validate unit + E2E: run the relevant unit tests and real-world journey E2E checks before calling the work complete.

Unit test expectation: production changes must always add or update focused unit tests and run the targeted unit or integration tests that match the changed behavior. Do not run coverage after every change by default. Reserve whole-project coverage for the repository's full `npm run check` gate during push workflows or when the user explicitly requests it; do not run coverage for commit-only workflows by default. Any excluded generated files, migrations, framework shims, unreachable defensive branches, or changes that cannot reasonably be unit-tested must be documented in the completion note.

E2E expectation: real-world journeys must follow the project-local instructions in `tests/e2e/REAL_WORLD_JOURNEY_TESTS.md`. These tests should model complete user workflows, role transitions, permissions, state changes, and cross-view consistency rather than isolated happy paths.

Recommended validation sequence:

```bash
npm run refresh
npm run typecheck
npm run lint
npm run test
npm run test:integration
npx proteum check
npx proteum doctor --contracts --strict
npx proteum e2e --port <port>
```

When bundling, SSR, server startup, routing, or build-time behavior changes, also run the project build command before finishing.
