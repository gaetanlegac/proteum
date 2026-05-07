# Proteum MCP

Proteum exposes read-only MCP surfaces for agents that need repeated, compact access to project and runtime state.

There are two entrypoints:

- `proteum mcp`: a stdio MCP server launched from an app or worktree.
- `proteum dev`: a dev-hosted MCP endpoint at `/__proteum/mcp`.

Both entrypoints expose the same tool/resource contract. The CLI remains the source of truth for `dev`, `build`, `check`, `refresh`, migrations, and reproducible terminal validation. MCP is for low-token reads, runtime snapshots, trace/perf/log summaries, and progressive detail loading.

## Stdio Server

Configure an MCP client to launch the server from the app root:

```bash
proteum mcp
```

Useful options:

```bash
proteum mcp --cwd /path/to/app
proteum mcp --url http://localhost:3101
proteum mcp --session-file var/run/proteum/dev/agents/task.json
```

The stdio server reads manifest, instruction, and tracked-session data from disk. When a live dev server is known through `--url`, a tracked session file, or the manifest router port, runtime tools read the dev endpoints directly instead of spawning CLI commands.

Use stdio MCP when the agent environment can launch a long-lived tool server but does not already have direct access to the running `proteum dev` HTTP transport.

## Dev Runtime Endpoint

During `proteum dev`, the app exposes the same MCP contract through the official streamable HTTP transport:

```text
POST /__proteum/mcp
GET /__proteum/mcp
DELETE /__proteum/mcp
```

This endpoint is dev-only and local-tooling-only. It uses the running app's in-memory diagnostics, trace, perf, and log stores where possible, so runtime tools avoid process startup and avoid dumping full trace payloads by default.

The dev session UI and ready banner print:

```text
mcp  http://localhost:<port>/__proteum/mcp
MCP: http://localhost:<port>/__proteum/mcp
```

Use dev-hosted MCP when an agent is iterating against an already running app. It is the fastest path for repeated `runtime_status`, `orient`, `diagnose`, `trace_*`, `perf_*`, and `logs_tail` reads.

## Output Contract

MCP tool and resource payloads are compact single-line JSON strings in this shape:

```json
{"ok":true,"format":"proteum-mcp-v1","summary":"...","data":{},"nextActions":[],"omitted":[]}
```

Outputs are capped by default:

- trace output shows counts, failed calls, error events, hot calls, and hot SQL first
- logs are limited and truncated
- diagnostics and perf rows are capped
- full trace detail is paginated with `detail: "full"`, `limit`, and `offset`

Do not make MCP tools return pretty-printed JSON or raw trace/log dumps by default. Pretty output belongs to human CLI/UI surfaces; MCP output is optimized for agent context.

## Tools

The v1 tools are read-only:

| Tool | Purpose |
| --- | --- |
| `runtime_status` | Manifest summary, selected runtime, tracked sessions, health, and MCP URL |
| `orient` | Owner, instruction routing, connected boundaries, and next actions |
| `instructions_resolve` | Selected instruction files for a query, with short previews |
| `explain_summary` | Compact manifest summary or owner lookup |
| `doctor` | Compact manifest and optional contract diagnostics |
| `diagnose` | Composite diagnosis for an existing route, query, or request trace |
| `trace_latest` | Compact latest trace summary, with optional paginated detail |
| `trace_show` | Compact or paginated detail for a specific request trace |
| `perf_top` | Hot-path perf rollup |
| `perf_request` | One-request waterfall and attribution |
| `logs_tail` | Capped recent server logs |

MCP v1 intentionally does not start/stop dev servers, refresh generated files, arm traces, export traces, write files, run migrations, or execute app commands.

## Resources

Static resources expose common compact reads:

- `proteum://runtime/status`
- `proteum://instructions/router`
- `proteum://manifest/summary`
- `proteum://trace/latest/summary`
- `proteum://perf/top`

## CLI Boundary

Use CLI commands when the result must be reproducible as a terminal step, CI-like validation, or human-shareable command output:

```bash
proteum dev
proteum build --prod
proteum check
proteum refresh
proteum diagnose /dashboard --port 3101
proteum verify request /dashboard --port 3101
proteum trace show <requestId> --events --port 3101
```

Use MCP when an agent is asking the same running app for repeated state:

```text
runtime_status
instructions_resolve
orient
diagnose
trace_latest
perf_request
logs_tail
```

## Routing Guidance

Use these surfaces in this order:

1. Agent instructions for hard safety policy and routing rules.
2. MCP for repeated reads, runtime status, instruction selection, traces, perf, and logs.
3. Compact CLI for reproducible terminal validation and CI-like checks.
4. Full CLI escape hatches only after compact MCP/CLI output identifies the missing detail.

## Benchmark

The Product `/domains` diagnostic loop measured on May 7, 2026 used `ceil(UTF-8 bytes / 4)` as an output-token estimate:

| Workflow | Approx output tokens | Elapsed |
| --- | ---: | ---: |
| Compact CLI single loop | 6,286 | 4,809 ms |
| Dev-hosted HTTP MCP single loop | 5,211 | 232 ms |
| Stdio MCP single loop | 5,526 | 900 ms |
| Compact CLI repeated reads x3 | 11,660 | 9,572 ms |
| Dev-hosted HTTP MCP repeated reads x3 | 10,537 | 214 ms |

The benchmark included the routed instruction docs separately. Reading the four selected instruction files once was about 4,881 estimated output tokens; refreshing the instruction routing through MCP `instructions_resolve` was about 722 estimated output tokens.

The practical rule from the benchmark is: use CLI for the first reproducible check and validation record, then use MCP for repeated reads against the same app/runtime.
