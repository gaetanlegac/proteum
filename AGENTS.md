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
- For Prisma-backed apps, declare database structure changes in the app's `schema.prisma` only. Never create or edit migration files manually, and never run schema-mutating SQL such as `ALTER TABLE`, `CREATE TABLE`, or `DROP TABLE`.
- Follow `agents/project/optimizations.md` when choosing packages, helpers, runtimes, plugins, or build infrastructure.
- Delete obsolete compatibility layers, helper indirection, and unused packages when safe.

## Workflow

- If the user pastes raw errors without asking for a fix, do not implement changes. List likely causes and, for each one, give probability, why, and how to fix it.
- If you changed any app `schema.prisma`, do not start testing or validation yet. Ask the user to run the following command in the affected worktree directory, replacing the placeholders, and wait for the user to reply exactly `continue` before resuming validation or tests:
```
cd <worktree path>
npx prisma migrate dev --config ./prisma.config.ts --name <migration name>
```
- After implementing a framework feature or change, do not stop at code edits. Boot both reference apps, exercise the affected flow with Playwright or the smallest real Proteum surface, run the relevant `proteum` diagnostics or perf commands, and confirm there is no meaningful regression in runtime behavior, performance, load size, SEO output, or coding-style expectations before finishing.
- When starting a long-lived reference app dev server for framework work, always request elevated permissions and run `npx proteum dev` outside the sandbox. Use an explicit thread-scoped session file such as `var/run/proteum/dev/framework-<app>-<task>.json`, inspect tracked sessions plus current listeners first, for example with `npx proteum dev list --json` and `lsof -nP -iTCP -sTCP:LISTEN`, then choose a port that is not currently used before starting `npx proteum dev --session-file <path> --port <port>`.
- Do not use `--replace-existing` unless you are restarting the exact session file started by the current thread/task. Never replace another live session that belongs to a user, another thread, or an unknown owner.
- When a reference app uses local `file:` connected projects for the affected flow, boot every connected producer app as well, each on its own free port and thread-scoped session file, and run every one of those `proteum dev` processes with elevated permissions outside the sandbox before starting or validating the consumer app.
- Before retrying a boot on the same app, changing ports, or finishing the task, stop every framework-started dev session with `npx proteum dev stop --session-file <path>` or `npx proteum dev stop --all --stale`.
- If the task changed the dev workflow itself, verify the final cleanup path with `npx proteum dev list --json` before finishing.
- When you have finished your work, summarize in one top-level short (up to 100 characters) sentence ALL the changes you made since the beginning of the WHOLE conversation. Strictly use the Conventional Commits specification:
  ```
  Commit message: <type>[optional scope]: <description>

  [optional body]
  ```
  If the user replies exactly `commit`, use that Conventional Commit message, stage the task-related changed files with `git add` while avoiding unrelated user changes or incidental untracked files, then create the commit by running `git commit`.

## Core Changes

- Validate framework changes against the reference apps:
  - `/Users/gaetan/Desktop/Projets/crosspath/platform`: Standalone app
  - `/Users/gaetan/Desktop/Projets/unique.domains/platform`: Monorepo including the following apps:
    - `/Users/gaetan/Desktop/Projets/unique.domains/platform/apps/product`
    - `/Users/gaetan/Desktop/Projets/unique.domains/platform/apps/website`
- Inspect how both apps currently use the touched feature, runtime, API, compiler behavior, or generated output before proposing or implementing changes.
- Keep the developer-facing contract synchronized when framework work changes CLI commands, profiler capabilities, or the `proteum dev` banner. Update the live surfaces together in the same pass: CLI command/help definitions, profiler panels and dev-only endpoints, banner text/examples, and the most relevant agent docs that describe them, especially `AGENTS.md`, `agents/project/AGENTS.md`, `agents/project/root/AGENTS.md`, `agents/project/app-root/AGENTS.md`, `agents/project/diagnostics.md`, and any narrower `agents/project/**/AGENTS.md` file that mentions the changed workflow.
- Current CLI banner contract: only the bare `proteum build` and bare `proteum dev` commands print the welcome banner and include the active Proteum installation method. Any extra argument or option skips the banner. Only `proteum dev` clears the interactive terminal before rendering, exposes `CTRL+R` reload plus `CTRL+C` shutdown hotkeys in its session UI, and reports connected app names plus successful connected `/ping` checks in the ready banner.
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
- When validating a concrete route, controller path, or failing page on a running dev server, prefer `proteum diagnose <path> --port <port>` first. Use raw `proteum trace ...` output when you need lower-level event detail beyond the diagnose summary.
- When the issue is latency, CPU, SQL cost, render cost, or memory drift, inspect `proteum perf top`, `proteum perf request`, `proteum perf compare`, or `proteum perf memory` against the running dev server before adding custom instrumentation.
- When a framework change can affect shipped client code size, run `proteum build --prod --analyze` for static bundle artifacts or `proteum build --prod --analyze --analyze-serve --analyze-port auto` when you need a local analyzer URL.
- For protected browser or API flows in dev, prefer `npx proteum session <email> --role <role>` to mint a dev auth cookie instead of automating the login UI. Use the login UI only when login itself is the feature under test.
- When a task needs browser execution instead of the higher-level verifier, prefer `npx proteum verify browser <path>` or direct Playwright with a disposable profile. Keep auth sourced from `npx proteum session`, not UI login or shared browser state.
- For request-time behavior, arm traces with `proteum trace arm --capture deep`, reproduce once, then inspect `proteum trace latest` or `proteum trace show <requestId>`.
- When the framework-facing workflow itself changed, verify the CLI surface too with `proteum verify framework-change --crosspath-port <port> --product-port <port> --website-port <port>`.
- Only the final verifier agent should usually run browser flows. Other agents should stay on `orient`, `verify owner`, `verify request`, and command-level checks unless browser execution is the only trustworthy surface.
- Open the real pages with Playwright.
- Inspect browser console errors and warnings.
- Inspect server startup and runtime errors.

Build-only checks are supplementary. Iterate until both apps boot and show no new framework regressions, and call unrelated environment warnings out separately.
