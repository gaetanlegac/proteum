# Agent Routing And Token Efficiency

Proteum routing and diagnostics CLI commands are agent-facing by default. The interactive `proteum dev` and user-facing `proteum build` surfaces keep their human presentation.

The routing strategy is:

1. Use instructions for hard safety rules and routing only.
2. Use `proteum orient <query>` to resolve the task-specific owner, `mustRead` instruction files, and next command.
3. Use compact CLI output by default.
4. Use `--full`, `--manifest`, or `--events` only after a compact response identifies the missing detail.

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
