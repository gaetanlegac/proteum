# Diagnostics and Explainability

Proteum exposes three manifest-backed orientation and diagnostics surfaces plus one composite request-diagnosis surface:

- `proteum orient`: resolve the likely owner, guidance files, connected boundaries, and next steps before opening code
- `proteum explain`: inspect the generated app structure
- `proteum doctor`: inspect manifest diagnostics
- `proteum diagnose`: combine owner lookup, diagnostics, matching request traces, and buffered server logs for one concrete query or path

These are not separate models for different tools. `orient`, `explain`, and `doctor` share the same generated manifest snapshot, while `diagnose` layers live dev-only request data on top of that same framework view.

Performance inspection is a sibling surface, not a separate instrumentation stack: `proteum perf` and the profiler `Perf` tab aggregate the same dev-only request traces that back `proteum trace`.

The diagnostics and routing CLI surfaces are optimized for agents by default. They return compact decision-ready output first and expose large raw detail only through explicit flags such as `--full`, `--manifest`, or `--events`.

For repeated agent reads, Proteum also exposes the same compact diagnostic contract through `proteum mcp`, a machine-scope router that forwards `projectId`-scoped calls to the matching dev-hosted `/__proteum/mcp` endpoint. See [mcp.md](mcp.md).

## Shared Contract

The canonical snapshot lives in `./.proteum/manifest.json`.

Proteum uses that same manifest in these places:

- `proteum orient` for owner lookup, guidance resolution, connected-boundary summary, and next-step suggestions
- `proteum explain` for compact manifest summaries and selected-section counts
- `proteum doctor` for human-readable and `--json` output
- `proteum explain owner <query>` for ownership lookup over the manifest index
- `proteum doctor --contracts` for generated-artifact and manifest-owned source validation on disk
- the dev-only `__proteum/explain*` and `__proteum/doctor*` HTTP endpoints
- the dev-only `/__proteum/mcp` endpoint
- the `Explain`, `Doctor`, and `Diagnose` tabs in the bottom profiler during `proteum dev`

This means the CLI, MCP, the dev HTTP endpoints, and the profiler all describe the same framework-owned snapshot before any live trace or log overlays are added.

If a command such as `proteum explain`, `proteum doctor`, `proteum diagnose`, or `proteum refresh` regenerates `.proteum/manifest.json`, the next CLI call, HTTP call, or profiler refresh will reflect that same updated snapshot.

## CLI

Common usage:

```bash
proteum orient /api/Auth/CurrentUser

proteum explain
proteum explain owner /api/Auth/CurrentUser
proteum explain --routes --controllers --commands
proteum explain --routes --controllers --commands --full
proteum explain --manifest

proteum doctor
proteum doctor --contracts
proteum doctor --full
proteum doctor --strict

proteum diagnose /
proteum diagnose /dashboard --port 3101
proteum diagnose /api/Auth/CurrentUser --url http://127.0.0.1:3101

proteum verify owner /api/Auth/CurrentUser
proteum verify request /dashboard --port 3101
proteum verify browser /dashboard --port 3101 --session-email admin@example.com --session-role ADMIN
proteum e2e --port 3101 --session-email admin@example.com --session-role ADMIN tests/e2e/features/dashboard.spec.ts

proteum perf top --since today
proteum perf request /dashboard --port 3101
proteum perf compare --baseline yesterday --target today --group-by route
proteum perf memory --since 1h --group-by controller

proteum runtime status
```

Default compact command output follows this shape:

```json
{
  "ok": true,
  "format": "proteum-agent-v1",
  "summary": "...",
  "data": {},
  "nextActions": [],
  "omitted": [],
  "fullDetailCommand": "..."
}
```

`proteum orient` emits compact agent JSON with:

- `query`
- `app`
- `owner`
- `instructions.mustRead`
- `instructions.readWhen`
- `connected`
- `nextActions`
- `warnings`

`proteum orient --full` emits the full orientation payload.

`proteum explain` emits a compact manifest summary. Explicit section flags such as `--routes --controllers` now summarize those sections by default to avoid route/controller dumps in agent context. Add `--full` to emit selected raw section arrays, or use `proteum explain --manifest` for the full generated manifest.

`proteum explain owner <query>` emits compact owner ranking. `proteum explain owner <query> --full` keeps the existing full owner ranking shape and adds:

- `scopeLabel`
- `originHint`

`proteum doctor` emits compact diagnostics. `proteum doctor --full` emits:

- `summary.errors`
- `summary.warnings`
- `summary.strictFailed`
- `diagnostics`

`proteum runtime status` emits the current app manifest summary, tracked dev sessions, selected live session, MCP URL, health status, configured router/HMR port inspection, and a suggested next command. Use it before starting another dev server, and use its Start Dev command instead of probing page bodies when the default port is occupied. If it reports that the same app already responds on the configured port without a live tracked session, use or repair that runtime instead of starting a second server.

Inside `/.codex/worktrees/`, `proteum dev`, `proteum refresh`, `proteum runtime status`, `proteum verify`, and MCP `workflow_start` require a fresh `.proteum/worktree-bootstrap.json`. If the marker is missing, run `npx proteum worktree init --source <source-app-root>`. If hashes, app `.env`, workspace-root `.env` for monorepos with root tooling, `.proteum/manifest.json`, `node_modules`, or the Proteum version are stale, run the returned `npx proteum worktree init --source <source-app-root> --refresh` command. `PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE=1` bypasses the block but remains visible in runtime status, doctor diagnostics, and MCP output.

During `proteum dev`, `/__proteum/mcp` exposes compact `workflow_start`, `runtime_status`, `orient`, `instructions_resolve`, `route_candidates`, `explain_summary`, `doctor`, `diagnose`, `trace_*`, `perf_*`, and `logs_tail` tools without spawning CLI commands for each repeated read. `proteum dev` also ensures one managed machine `proteum mcp` daemon is running. Through the machine router, call `workflow_start` with `cwd` or a known `projectId`; if routing is ambiguous or returns offline app candidates, use `project_resolve { cwd }`, follow the selected app root's port-inspected next action when needed, then pass the selected live `projectId` to follow-up app-bound tools.

MCP tool/resource output follows compact single-line `proteum-mcp-v1` JSON:

```json
{"ok":true,"format":"proteum-mcp-v1","summary":"...","data":{},"nextActions":[],"omitted":[]}
```

Use MCP for repeated reads of the same app/runtime state. Keep CLI commands for reproducible validation, final evidence, and CI-like command output.

`proteum diagnose` emits a compact composite response with:

- `owner`
- `instructions`
- `chain`
- `doctor`
- `contracts`
- `request`
- `suspects`
- `serverLogs`

`proteum diagnose --full` emits the full lower-level composite response, including raw request trace payloads.

`proteum verify owner|request|browser --json` emits:

- `action`
- `target`
- `orientation`
- `introducedFindings`
- `preExistingFindings`
- `verificationSteps`
- `result`

`proteum perf` emits trace-derived performance views:

- `top`: grouped hot paths with avg, p95, CPU, SQL, render, and heap deltas
- `request`: one traced request waterfall with stage timings, CPU, SQL, render, self time, payload sizes, chain attribution, and SQL fingerprints
- `compare`: grouped baseline vs target deltas
- `memory`: grouped heap and RSS drift summaries

`proteum trace latest` and `proteum trace show <requestId>` emit compact trace summaries by default. Use `--events` or `--full` to print the raw event stream, payload summaries, and SQL text.

Focused verification defaults to the smallest trustworthy surface first:

- `verify owner`: orient the target, then choose request, command, or local owner-scoped diagnostics
- `verify request`: hit one real request, collect `diagnose`, and classify introduced vs pre-existing findings
- `verify browser`: only when browser-visible behavior matters, using an app-local isolated Playwright workspace

Focused verification fails on introduced blocking findings by default and does not fail on unrelated pre-existing blockers unless `--strict-global` is passed.

## Dev HTTP Endpoints

In `profile: dev`, the running app exposes:

- `GET /__proteum/explain`
- `GET /__proteum/explain/owner`
- `GET /__proteum/doctor`
- `GET /__proteum/doctor/contracts`
- `GET /__proteum/logs`
- `GET /__proteum/diagnose`
- `GET /__proteum/perf/top`
- `GET /__proteum/perf/compare`
- `GET /__proteum/perf/memory`
- `GET /__proteum/perf/request`
- `POST|GET|DELETE /__proteum/mcp`

`/__proteum/explain` supports optional section selection:

```text
GET /__proteum/explain?sections=routes,controllers,commands
GET /__proteum/explain?section=env&section=diagnostics
```

`/__proteum/explain/owner` supports a single query:

```text
GET /__proteum/explain/owner?query=/api/Auth/CurrentUser
```

`/__proteum/doctor` supports optional strict mode:

```text
GET /__proteum/doctor?strict=true
```

`/__proteum/doctor/contracts` supports the same optional strict mode.

`/__proteum/diagnose` supports a concrete query or request target:

```text
GET /__proteum/diagnose?query=/dashboard&path=/dashboard
GET /__proteum/diagnose?requestId=<requestId>
GET /__proteum/diagnose?query=/api/Auth/CurrentUser&logsLevel=warn&logsLimit=40
```

These endpoints are intended for local tooling and are not available in production.

`/__proteum/mcp` is the dev-hosted MCP transport. It exposes the read-only tool/resource contract backed directly by the running app's diagnostics, trace, perf, and log stores. The `proteum dev` session UI and ready banner print this URL when the server is ready. The machine `proteum mcp` router discovers these live endpoints and routes app-bound calls by `projectId`.

## Profiler

During `proteum dev`, the bottom profiler is the human-facing UI over the same dev diagnostics surfaces.

- `Explain` calls `/__proteum/explain`
- `Doctor` calls `/__proteum/doctor`
- `Diagnose` calls `/__proteum/diagnose` and renders the same owner, diagnostics, suspect, and log summary that the CLI uses
- `Perf` calls the `/__proteum/perf/*` endpoints and renders the same grouped rollups and current-request waterfall that `proteum perf` uses, plus visual charts for hot paths, time breakdowns, regression deltas, and memory drift
- `Commands` uses the dev command endpoints
- `Summary`, `Auth`, `Routing`, `Controller`, `SSR`, `API`, `SQL`, `Errors`, `Diagnose`, `Explain`, `Doctor`, `Commands`, and `Cron` now layer focused charts over the same trace and diagnostics contracts instead of only showing rows
- `Timeline` remains the primary waterfall and event-stream inspection surface

Use the profiler when a human needs to browse the same data that an agent or CLI command can already inspect directly.

## Runtime Contract Diagnostics

`proteum doctor --contracts` now emits additive runtime-focused diagnostics for framework-owned failures that are often misdiagnosed as leaf-component bugs:

- `runtime/provider-hook-outside-provider`
- `runtime/client-only-hook-in-ssr`
- `runtime/router-context-outside-router`
- `runtime/connected-boundary-mismatch`

Each diagnostic includes:

- `code`
- `message`
- `filepath`
- `sourceLocation`
- `fixHint`
- `relatedFilepaths`

Treat these as framework contract failures first. The fix usually belongs at the provider, router, connected-boundary, or SSR/client split where the contract was broken, not only in the component that happened to throw.

## Agent Workflow

For AI coding agents or automation:

1. When MCP is available, call `workflow_start` with `cwd` or a known `projectId`; if routing is ambiguous or returns offline app candidates, call `project_resolve { cwd }`, select the intended app root, start dev from that app root when needed, then retry with the selected stable live `projectId`.
2. Use the returned `projectId` for MCP `runtime_status`, `orient`, `instructions_resolve`, `route_candidates`, `explain_summary`, `doctor`, `diagnose`, `trace_show`, `perf_request`, and `logs_tail` read-only runtime, owner, route, instruction, trace, perf, and log reads.
3. Do not run CLI equivalents after a successful MCP result for the same read, and do not run broad source searches for ownership MCP already returned. Use CLI for fallback, `dev`, `build`, `check`, `verify`, migrations, E2E, and final terminal evidence.
4. Use selected instruction previews for read-only discovery and diagnostics; read full files only before edits or git writes, when returned `fullRead`/`fullReadPolicy` requires it, or when the preview is insufficient.
5. Use `proteum orient <query>` only when MCP is unavailable or terminal evidence is required.
6. If machine MCP routing fails, run `proteum mcp status` and `proteum runtime status` from the intended app root. If you are in a monorepo wrapper, use the returned app candidates and exact next action. If no live session exists, use the exact Start Dev next action returned by runtime status so occupied router/HMR ports are avoided. Do not `curl` normal page routes to identify a port owner. If a live session exists but runtime/MCP is unreachable, stop the listed session file first, then start dev again.
7. Use MCP `diagnose { projectId, path }` for the smallest trustworthy runtime surface before broad checks only after runtime health is reachable; use `proteum diagnose <path> --port <port>` as fallback or terminal evidence.
8. Use MCP `perf_request { projectId, query }` for performance, CPU, SQL, render, cache, or connected-boundary questions; use `proteum perf request <requestId|path>` as fallback or terminal evidence.
9. Use `proteum trace show <requestId> --events` only when compact diagnose, perf, trace, or MCP output says lower-level event detail is needed.
10. Use `proteum explain --manifest` or read `./.proteum/manifest.json` only when compact `workflow_start`/`orient`/`explain`/MCP summary cannot answer the specific manifest question.
11. Use `proteum verify browser` for browser-visible verification, or `proteum e2e --port <port>` for targeted/full Playwright suites. Keep auth sourced from Proteum session helpers.
12. Run global checks second, not first. Unrelated diagnostics should remain visible but non-blocking during focused verification unless strict global mode is required.
13. Open the profiler only when a human-readable view helps; it should agree with the CLI and MCP after refresh.
