# Proteum Core

This file governs work in the Proteum framework repository itself. For downstream app rules, use `agents/project/AGENTS.md` for the standalone app-root contract, or split between `agents/project/root/AGENTS.md` and `agents/project/app-root/AGENTS.md` in a monorepo.
Role: keep only framework-repo instructions here.
Keep here: core-repo priorities, framework change workflow, reference-app validation, and framework-specific constraints.
Do not put here: downstream app implementation contracts, area-specific app rules, or repeated content that belongs in `agents/project/**`.
Downstream app optimization source of truth: `agents/project/optimizations.md`.
Downstream app diagnostics source of truth: `agents/project/diagnostics.md`.
Downstream app coding style source of truth: `agents/project/CODING_STYLE.md`.

## Priorities

Optimization priorities and rules live in `agents/project/optimizations.md`.
After those optimization concerns, preserve explicit, typed, machine-readable contracts for agents.

## Core Rules

- Prefer explicit typed contracts over runtime magic or hidden conventions.
- Keep `server/index.ts` as the canonical type root for services, router context, request context, and models.
- Keep generated code deterministic, auditable, and easy to map back to source.
- Prefer typed traces, perf rollups, and manifest-backed diagnostics over ad hoc logging.
- For framework production changes, add or update focused unit tests for the touched behavior whenever applicable. Preserve or increase meaningful unit coverage toward 100%; if a change cannot be unit-tested, document why in the completion note.
- For Prisma-backed apps, declare database structure changes in the app's `schema.prisma` only. Never create or edit migration files manually, and never run schema-mutating SQL such as `ALTER TABLE`, `CREATE TABLE`, or `DROP TABLE`.
- Follow `agents/project/optimizations.md` when choosing packages, helpers, runtimes, plugins, or build infrastructure.
- Delete obsolete compatibility layers, helper indirection, and unused packages when safe.

## Workflow

- If the user pastes raw errors without asking for a fix, do not implement changes yet. First run the task-safe local reproduction path: identify the likely app, route, command, or request from the error, boot or reuse the relevant dev server with the elevated-permissions workflow below, reproduce the failing surface locally, and inspect server output, browser console output, diagnostics, traces, or the smallest relevant command result. If the error does not identify enough context to reproduce, say what is missing and use the available local evidence before guessing. Then list likely causes and, for each one, give probability, why, and how to fix it.
- If you changed any app `schema.prisma`, do not start testing or validation yet. Ask the user to run the following command in the affected worktree directory, replacing the placeholders, and wait for the user to reply exactly `continue` before resuming validation or tests:
```
cd <worktree path>
npx prisma migrate dev --config ./prisma.config.ts --name <migration name>
```
- After initializing any new framework worktree, immediately boot the required reference app dev servers with the elevated-permissions workflow below. Keep those servers running across subsequent changes and validation until the user explicitly asks to stop them, or until a retry, port change, stale-session cleanup, or conflicting live session requires a controlled stop.
- After implementing a framework feature or change, do not stop at code edits. Boot both reference apps, exercise browser-visible flows with the browser MCP or use the smallest real Proteum surface, run the relevant `proteum` diagnostics or perf commands, and confirm there is no meaningful regression in runtime behavior, performance, load size, SEO output, or coding-style expectations before finishing.
- When starting a long-lived reference app dev server for framework work, always request elevated permissions and run `npx proteum dev` outside the sandbox. Use an explicit thread-scoped session file such as `var/run/proteum/dev/framework-<app>-<task>.json`, run `npx proteum runtime status` in the intended app root first, then choose the exact next action or a known-free explicit port before starting `npx proteum dev --session-file <path> --port <port>`. If the same app already responds on the configured port without live tracking, use or repair that runtime instead of starting another server. Do not inspect normal page bodies to identify port ownership; use runtime status, dev-only `/__proteum/*` endpoints, and current listeners only when the compact Proteum surface cannot answer. After the server is ready, print the live server URL as a clickable Markdown link such as `[http://localhost:3100](http://localhost:3100)`.
- Do not use `--replace-existing` unless you are restarting the exact session file started by the current thread/task. Never replace another live session that belongs to a user, another thread, or an unknown owner.
- When a reference app uses local `file:` connected projects for the affected flow, boot every connected producer app as well, each on its own free port and thread-scoped session file, and run every one of those `proteum dev` processes with elevated permissions outside the sandbox before starting or validating the consumer app.
- Before retrying a boot on the same app, changing ports, handling a conflicting live session, or when the user explicitly asks to stop servers, stop the relevant framework-started dev session with `npx proteum dev stop --session-file <path>` or clean stale sessions with `npx proteum dev stop --all --stale`. Do not stop healthy framework-started dev sessions merely because the current task is finished.
- If the task changed the dev workflow itself, verify the final cleanup path with `npx proteum dev list --json` before finishing.
- When you have finished your work, summarize in one top-level short (up to 100 characters) sentence ALL the changes you made since the beginning of the WHOLE conversation. Strictly use the Conventional Commits specification:
  ```
  Commit message: <type>[optional scope]: <description>

  [optional body]
  ```
  If the user replies exactly `commit`, treat it as conversation-wide and cross-project, not task-scoped. Identify every affected git repository or worktree touched since the last `commit` and, if there has been no prior `commit`, since the beginning of the whole conversation. In each affected repository or worktree, stage all conversation-related changed files with `git add` while still excluding unrelated pre-existing user changes or incidental untracked files, then create one `git commit`. Do not omit linked local dependencies, framework repos, connected projects, or producer apps when they were changed to make the delivered behavior actually work.
  After providing a commit message or after creating a commit, immediately follow it with this exact prompt and obey it:
  `Explain in short minimalistic and few bullet points what we changed in this thread, like you would do to your grandma. Start with a verb in the past.`

## Core Changes

- Validate framework changes against the reference apps:
  - `/Users/gaetan/Desktop/Projets/crosspath/platform`: Standalone app
  - `/Users/gaetan/Desktop/Projets/crosspath/website`: Standalone app
  - `/Users/gaetan/Desktop/Projets/unique.domains/platform`: Monorepo including the following apps:
    - `/Users/gaetan/Desktop/Projets/unique.domains/platform/apps/product`
    - `/Users/gaetan/Desktop/Projets/unique.domains/platform/apps/website`
  - `/Users/gaetan/Desktop/Projets/klair.work`: Monorepo including the following apps:
    - `/Users/gaetan/Desktop/Projets/klair.work/apps/web`
    - `/Users/gaetan/Desktop/Projets/klair.work/apps/api`
    - `/Users/gaetan/Desktop/Projets/klair.work/apps/worker`
- Inspect how the relevant reference apps currently use the touched feature, runtime, API, compiler behavior, or generated output before proposing or implementing changes.
- Keep the developer-facing contract synchronized when framework work changes CLI commands, profiler capabilities, or the `proteum dev` banner. Update the live surfaces together in the same pass: CLI command/help definitions, profiler panels and dev-only endpoints, banner text/examples, and the most relevant agent docs that describe them, especially `AGENTS.md`, `agents/project/AGENTS.md`, `agents/project/root/AGENTS.md`, `agents/project/app-root/AGENTS.md`, `agents/project/diagnostics.md`, and any narrower `agents/project/**/AGENTS.md` file that mentions the changed workflow.
- Proteum MCP contract: `proteum mcp` is the machine-scope router agents register once, and `proteum dev` exposes each app runtime at `/__proteum/mcp`. `proteum dev` ensures one managed machine MCP daemon is running; do not start a second managed daemon. Agents should start with MCP `workflow_start` using `cwd` or a known `projectId`; ambiguous routing or offline app candidates use `project_resolve { cwd }`, and follow-up live app tools require the returned `projectId`. Dev-hosted app tools are already rooted to their own runtime. Keep MCP tools/resources compact, typed, capped, paginated for full trace detail, and read-only unless a future task explicitly expands the mutation contract. MCP payloads are compact single-line `proteum-mcp-v1` JSON, not pretty-printed human output. Do not implement MCP tools as thin CLI process wrappers when the data is available through manifest readers, tracked sessions, or dev runtime registries.
- Keep the same-system trace contract explicit when request instrumentation changes: `TRACE_*` controls the retained dev trace store plus the trace/perf CLI, dev-only HTTP endpoints, and bottom profiler, while `ENABLE_PROFILER` enables the reduced request-local `request.profiling` snapshot and `request.finished` hook payload without retaining finished requests globally unless dev trace is also enabled.
- Current CLI banner contract: only the bare `proteum build` and bare `proteum dev` commands print the welcome banner and include the active Proteum installation method. Any extra argument or option skips the banner. Only `proteum dev` clears the interactive terminal before rendering, exposes `CTRL+R` reload plus `CTRL+C` shutdown hotkeys in its session UI, and reports connected app names plus successful connected `/ping` checks in the ready banner. Every `proteum dev` start ensures tracked instruction files contain the current managed `# Proteum Instructions` section before the dev loop begins.
- Keep core changes aligned with the explicit controller/page architecture in `agents/project/root/AGENTS.md` and its standalone composition in `agents/project/AGENTS.md`.
- Prefer removing framework magic when the same result can be expressed with explicit contracts, generated code, or typed context.
- Apply the pruning rules from `agents/project/optimizations.md`, especially for webpack plugins, Babel plugins, aliases, helpers, runtime services, and npm packages that are not meaningfully used by both apps.
- Remove dead docs, flags, helper files, and compatibility branches in the same pass when safe.

## Proposals

- Start from the concrete mismatch or risk visible in the reference apps.
- Name the npm packages or package categories evaluated first when adding capability or infrastructure.
- Show the target API with real Proteum-style client and server usage.
- Separate the ideal end state from any migration rule.
- Name the source files that drive generated artifacts when generation changes.
- Explicitly name removed behavior and why it is obsolete.

## Runtime Validation

Do not stop at static analysis for routing, controllers, generated code, SSR, client runtime, services, webpack, Babel, or emitted assets.

- Run `npx proteum dev --no-cache --session-file var/run/proteum/dev/framework-<app>.json --port <free-3xxx-port>` in both reference apps on explicit free ports and with elevated permissions outside the sandbox.
- If either reference app uses local `file:` connected projects for the affected flow, run those producer apps too on their own free ports before exercising the consumer.
- When validating a concrete route, controller path, or failing page on a running dev server, prefer `proteum diagnose <path> --port <port>` first. Use `proteum trace show <requestId> --events` only when you need lower-level event detail beyond the compact diagnose summary.
- When the issue is latency, CPU, SQL cost, render cost, or memory drift, inspect `proteum perf top`, `proteum perf request`, `proteum perf compare`, or `proteum perf memory` against the running dev server before adding custom instrumentation.
- When a framework change can affect shipped client code size, run `proteum build --prod --analyze` for static bundle artifacts or `proteum build --prod --analyze --analyze-serve --analyze-port auto` when you need a local analyzer URL.
- For protected browser or API flows in dev, prefer `npx proteum session <email> --role <role>` for browser MCP validation, or `npx proteum e2e --session-email <email> --session-role <role>` for automated end-to-end suites, instead of automating the login UI. Use the login UI only when login itself is the feature under test.
- When a task needs browser execution instead of the higher-level verifier, use the browser MCP. Keep Playwright inside `npx proteum e2e --port <port>` for targeted or full end-to-end suites. Keep auth sourced from Proteum session helpers, not UI login or shared browser state.
- For request-time behavior, arm traces with `proteum trace arm --capture deep`, reproduce once, then inspect compact `proteum trace latest` or raw `proteum trace show <requestId> --events` only when needed.
- When the framework-facing workflow itself changed, verify the CLI surface too with `proteum verify framework-change --crosspath-port <port> --product-port <port> --website-port <port>`.
- Only the final verifier agent should usually run browser flows. Other agents should stay on `orient`, `verify owner`, `verify request`, and command-level checks unless browser execution is the only trustworthy surface.
- Open the real pages with the browser MCP.
- Inspect browser console errors and warnings.
- Inspect server startup and runtime errors.

Build-only checks are supplementary. Iterate until both apps boot and show no new framework regressions, and call unrelated environment warnings out separately.
