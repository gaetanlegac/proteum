# Agent Routing And Token Efficiency

Proteum routing and diagnostics CLI commands are agent-facing by default. The interactive `proteum dev` and user-facing `proteum build` surfaces keep their human presentation.

The optimized stack is:

- routed agent instructions for stable policy
- compact CLI for reproducible command-line checks
- MCP for repeated reads of the same project/runtime state, routed by `projectId`

The routing strategy is:

1. Use instructions for hard safety rules and routing only.
2. Use MCP first when available for read-only runtime status, instruction routing, owner lookup, diagnosis, traces, perf, and logs.
3. Start machine MCP sessions with `workflow_start { cwd, task, route?, file? }` when possible; use `project_resolve { cwd }` when the bootstrap is ambiguous, no `projectId` is known, or the app is offline.
4. Pass the returned live stable `projectId` to every follow-up app-bound MCP call.
5. Use MCP `orient { projectId, query }`, `instructions_resolve { projectId, query }`, `route_candidates { projectId, query }`, and `explain_summary { projectId, query }` only when `workflow_start` did not return enough owner or instruction detail.
6. Use compact CLI output for reproducible terminal validation, CI-like checks, fallback repair, and final evidence.
7. Use `--full`, `--manifest`, `--events`, or MCP paginated `detail: "full"` only after compact output identifies the missing detail.

## Problem Resolved

Past agent workflows spent too much context on repeated instruction payloads, full manifest dumps, raw trace JSON, and broad source searches.

The measured Product diagnostic loop produced roughly tens of thousands of output tokens because agents combined:

- `dev list`
- `orient`
- full `diagnose`
- raw `trace latest`
- `perf request`
- `verify request`
- sometimes full manifest or explain section output

Managed project instructions also embedded the same Proteum corpus into multiple generated files, so reading a handful of local docs could repeat the same contract many times.

## CLI Contract

Default CLI output for agent commands is compact `proteum-agent-v1` JSON:

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

Use compact CLI commands when MCP is unavailable, when a command must be reproducible in a shell, or when final terminal evidence is required:

```bash
proteum orient <route|file|controller|error>
proteum runtime status
proteum diagnose <target>
proteum perf request <requestId|path>
proteum trace latest
```

Use MCP for repeated reads when a client is available:

```text
proteum mcp
```

The machine router discovers live `proteum dev` sessions and offline Proteum app roots under a cwd. `proteum dev` ensures one managed machine MCP daemon is running; terminal `proteum mcp` starts or reuses that daemon and prints a compact central MCP banner with the HTTP client URL, while MCP clients can use stdio. Agents should call MCP `workflow_start` with `cwd` or a known `projectId`, use `project_resolve { cwd }` when routing is ambiguous or offline, and pass the returned live `projectId` to every follow-up app-bound MCP tool. Offline candidates include port-inspected next actions, so agents should follow those instead of guessing the manifest default port. The router forwards to the selected dev-hosted `/__proteum/mcp` endpoint and strips routing fields before the app sees the call.

If machine MCP routing returns offline candidates, choose the intended app root and follow that candidate's next action from the app root, not from the monorepo wrapper. If machine MCP routing fails, run `proteum mcp status` and `proteum runtime status` from the intended app root; if no live session exists, use the exact Start Dev next action from runtime status so occupied router/HMR ports are avoided. If the same app already responds on the configured port without live tracking, use or repair that runtime instead of starting another server. Do not `curl` normal page routes to identify which app owns a port; use runtime status or Proteum dev-only endpoints. If a live session exists but runtime/MCP is unreachable, stop the listed session file first, then start dev again. Do not run diagnose, trace, or perf reads while runtime health is unreachable. Do not start a second dev server in the same worktree, and do not start a second managed MCP daemon. Then retry MCP `workflow_start`.

Prefer CLI over MCP when the result must be reproducible as a shell command, part of verification, or copied into CI/debug instructions.

MCP output is compact `proteum-mcp-v1` JSON. It is intentionally single-line JSON, capped, and paginated for full trace detail. Do not expand MCP output just to make it look nicer for humans.

Use full-detail escape hatches only when needed:

```bash
proteum explain --manifest
proteum explain --routes --controllers --full
proteum orient <query> --full
proteum diagnose <target> --full
proteum trace show <requestId> --events
proteum perf request <requestId> --full
```

## Instruction Contract

Managed `AGENTS.md` files now carry a compact router instead of the full instruction corpus.

The router standard is trigger -> canonical instruction file, not trigger -> copied summary. Keep the compact root focused on hard safety rules, routing triggers, and source-map references. When a trigger needs a lifecycle or area contract, route agents to the full file that owns the rule.

Standard triggered reads:

- Worktree Preflight (`cwd` inside `/.codex/worktrees/`, newly created Proteum worktree, or before editing in a Codex worktree): root contract fallback, then `.env` copy, `npx proteum refresh`, dependency install when needed, `npx proteum runtime status`, and tracked `npx proteum dev` for runtime-visible work.
- Git lifecycle (`commit`, `and commit`, `stage`, `push`, `PR`, pull request): root contract fallback.
- Before git writes after a bug fix, behavior change, decision change, or docs-relevant production change: `DOCUMENTATION.md`.
- Before finishing production code changes: root contract fallback, `DOCUMENTATION.md`, `CODING_STYLE.md`, and touched area `AGENTS.md`.
- Runtime-visible, request-time, router, SSR, browser, or controller behavior: root contract fallback plus `diagnostics.md`.
- Bug fixes, regressions, incidents, broken public routes, auth/OAuth failures, integration failures, or production behavior fixes: `DOCUMENTATION.md`.
- Non-trivial feature, product, business-rule, UX, copy, or docs changes: `DOCUMENTATION.md`.
- Implementation edits: `CODING_STYLE.md` plus the matching area file from the routing table.

`workflow_start`, `orient`, `route_candidates`, and MCP `instructions_resolve` should promote obvious triggered files into selected instruction previews; ambiguous conditional reads can remain in `readWhen`.

Area files carry only their own source content:

- `DOCUMENTATION.md`: documentation-driven coding, `/docs` source-of-truth routing, and docs update expectations
- `diagnostics.md`: raw errors, failing routes, traces, perf, reproduction
- `optimizations.md`: package, runtime, build, and optimization decisions
- `CODING_STYLE.md`: implementation style before editing
- `client/AGENTS.md`: client code
- `client/pages/AGENTS.md`: page route/data/render rules
- `server/services/AGENTS.md`: services
- `server/routes/AGENTS.md`: manual routes
- `tests/e2e/AGENTS.md`: E2E workflow
- `tests/e2e/REAL_WORLD_JOURNEY_TESTS.md`: journey-test design

Agents should not read broad folders or every managed instruction file. They should use selected MCP previews for read-only discovery and diagnostics, then read full files only before edits or git writes, when returned `fullRead`/`fullReadPolicy` requires it, or when the preview is insufficient.

MCP `workflow_start` exposes the first routing decision in compact JSON. MCP `instructions_resolve { projectId, query }` is the lowest-token way to refresh instruction selection without rereading full docs.

## Benchmark Result

The latest Product `/domains` benchmark used routed instructions plus the compact CLI/MCP stack. Token estimates are `ceil(UTF-8 bytes / 4)` and measure output size only.

| Workflow | Approx output tokens | Elapsed |
| --- | ---: | ---: |
| Compact CLI single loop | 6,286 | 4,809 ms |
| Dev-hosted HTTP MCP single loop | 5,211 | 232 ms |
| Compact CLI repeated reads x3 | 11,660 | 9,572 ms |
| Dev-hosted HTTP MCP repeated reads x3 | 10,537 | 214 ms |

The result confirms the intended routing:

- use CLI for reproducible verification and final command evidence
- use `workflow_start` to collapse project resolution, runtime status, instruction previews, owner summary, and first next actions into one read
- use machine MCP with `projectId` for repeated runtime reads against an already running app
- use `instructions_resolve` to refresh routing instead of rereading full instruction files
