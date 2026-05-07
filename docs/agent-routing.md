# Agent Routing And Token Efficiency

Proteum routing and diagnostics CLI commands are agent-facing by default. The interactive `proteum dev` and user-facing `proteum build` surfaces keep their human presentation.

The optimized stack is:

- routed agent instructions for stable policy
- compact CLI for reproducible command-line checks
- MCP for repeated reads of the same project/runtime state, routed by `projectId`

The routing strategy is:

1. Use instructions for hard safety rules and routing only.
2. Use MCP when available for repeated reads, runtime status, instruction routing, traces, perf, and logs.
3. Start machine MCP sessions with `projects_list`, pick the stable `projectId`, and pass it to every app-bound MCP call.
4. Use `proteum orient <query>` or MCP `orient { projectId, query }` to resolve the task-specific owner, `mustRead` instruction files, and next command.
5. Use compact CLI output for reproducible terminal validation and CI-like checks.
6. Use `--full`, `--manifest`, `--events`, or MCP paginated `detail: "full"` only after compact output identifies the missing detail.

## Problem Resolved

Past agent workflows spent too much context on repeated instruction payloads, full manifest dumps, raw trace JSON, and broad source searches.

The measured Product diagnostic loop produced roughly tens of thousands of output tokens because agents combined:

- `dev list`
- `orient`
- full `diagnose`
- raw `trace latest`
- `perf request`
- `verify request`
- sometimes full `explain --json`

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

Use the compact commands first:

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

The machine router discovers live `proteum dev` sessions. `proteum dev` ensures one managed machine MCP daemon is running; terminal `proteum mcp` starts or reuses that daemon, while MCP clients can use stdio. Agents should call MCP `projects_list`, select the right `projectId`, and pass it to every app-bound MCP tool. The router forwards to the selected dev-hosted `/__proteum/mcp` endpoint and strips `projectId` before the app sees the call.

If machine MCP routing fails, run `proteum mcp status` and `proteum runtime status`; if no live session exists, start `proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>`. If a live session exists but runtime/MCP is unreachable, stop the listed session file first, then start dev again. Do not start a second dev server in the same worktree, and do not start a second managed MCP daemon. Then retry MCP `projects_list`.

Prefer CLI over MCP when the result must be reproducible as a shell command, part of verification, or copied into CI/debug instructions.

MCP output is compact `proteum-mcp-v1` JSON. It is intentionally single-line JSON, capped, and paginated for full trace detail. Do not expand MCP output just to make it look nicer for humans.

Use full-detail escape hatches only when needed:

```bash
proteum explain --manifest
proteum orient <query> --full
proteum diagnose <target> --full
proteum trace show <requestId> --events
proteum perf request <requestId> --full
```

## Instruction Contract

Managed `AGENTS.md` files now carry a compact router instead of the full instruction corpus.

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

Agents should not read broad folders or every managed instruction file. They should read only `mustRead` from `orient`, plus conditional docs that match the current task.

MCP `instructions_resolve { projectId }` exposes the same routing decision in compact JSON and is the lowest-token way to refresh instruction selection without rereading full docs.

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
- use machine MCP with `projectId` for repeated runtime reads against an already running app
- use `instructions_resolve` to refresh routing instead of rereading instruction files
