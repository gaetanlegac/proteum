# Proteum MCP

Proteum exposes MCP through two coordinated surfaces:

- `proteum mcp`: one machine-scope router for live Proteum dev projects.
- `proteum dev`: one app-root runtime endpoint at `http://localhost:<port>/__proteum/mcp`.

Agents should normally connect to `proteum mcp`. The router discovers live `proteum dev` sessions from the machine registry, returns stable `projectId` values, and forwards app-bound reads to the selected dev-hosted endpoint.

## Machine Router

Start the router from any directory:

```bash
proteum mcp
```

When run from a terminal, `proteum mcp` starts or reuses the managed local daemon at `http://127.0.0.1:3769/mcp`. When an MCP client launches it over pipes, use stdio:

```bash
proteum mcp --stdio
```

`proteum dev` ensures the managed machine MCP daemon is running before the dev loop starts. Only one managed daemon may run at a time. Stale daemon records are cleaned automatically.

The router is read-only. It does not start or stop dev servers, mutate files, refresh generated code, run migrations, or execute commands.

Use this flow:

1. Call MCP `projects_list`.
2. Pick the stable `projectId` for the intended app.
3. Pass that `projectId` to every app-bound MCP call.

Example tool calls:

```json
{"tool":"projects_list","arguments":{}}
{"tool":"runtime_status","arguments":{"projectId":"prj_0123abcd4567"}}
{"tool":"orient","arguments":{"projectId":"prj_0123abcd4567","query":"/dashboard"}}
{"tool":"diagnose","arguments":{"projectId":"prj_0123abcd4567","path":"/dashboard"}}
```

If a tool omits `projectId`, the router returns a compact error that tells the agent to call `projects_list`. There is no single-project fallback, because wrong-project reads are worse than an explicit routing retry.

## Dev Runtime Endpoint

During `proteum dev`, the app exposes the same app-level MCP contract through the official streamable HTTP transport:

```text
POST /__proteum/mcp
GET /__proteum/mcp
DELETE /__proteum/mcp
```

This endpoint is dev-only and local-tooling-only. It is already rooted to the running app, so its tools do not require `projectId`. The machine router strips `projectId` before forwarding a call here.

The dev session UI and ready banner print:

```text
mcp  http://localhost:<port>/__proteum/mcp
MCP: http://localhost:<port>/__proteum/mcp
```

`proteum dev` also writes a machine registry record under `~/.proteum/dev-sessions/`. The stable `projectId` is derived from the canonical app root, so it remains stable across port or session-file changes.

## Discovery And Recovery

If machine MCP routing fails:

1. Run `proteum runtime status` in the intended app.
2. Run `proteum mcp status`; if no daemon is live, run `proteum mcp` or start `proteum dev` in the intended app.
3. If no live app session exists, start `proteum dev --session-file var/run/proteum/dev/agents/<task>.json --port <free-port>`.
4. If a live session exists but runtime/MCP is unreachable, stop the listed session file with `proteum dev stop --session-file <path>`, then start dev again.
5. Retry MCP `projects_list` and use the returned `projectId`.

`proteum runtime status` refreshes the machine registry for live tracked sessions, so this recovery path also repairs missing router records after an upgrade.

Do not start a second `proteum dev` server in the same worktree. `proteum dev` fails fast when another live tracked session already exists for the same app root.
Do not start a second managed `proteum mcp` daemon. `proteum mcp` reuses the live daemon or reports its current URL.

## Output Contract

MCP tool payloads are compact single-line JSON strings in this shape:

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

Machine-only tools:

| Tool | Purpose |
| --- | --- |
| `projects_list` | List live Proteum dev projects and stable `projectId` values |
| `project_resolve` | Resolve a live project by `projectId` or app-root substring |

App-bound tools require `projectId` when called through `proteum mcp`:

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

## CLI Boundary

Use CLI commands when the result must be reproducible as a terminal step, CI-like validation, or human-shareable command output:

```bash
proteum dev --session-file var/run/proteum/dev/agents/task.json --port 3101
proteum build --prod
proteum check
proteum refresh
proteum diagnose /dashboard --port 3101
proteum verify request /dashboard --port 3101
proteum trace show <requestId> --events --port 3101
```

Use MCP when an agent is asking a running app for repeated state:

```text
projects_list
runtime_status { projectId }
instructions_resolve { projectId }
orient { projectId, query }
diagnose { projectId, path }
trace_latest { projectId }
perf_request { projectId, query }
logs_tail { projectId }
```

## Benchmark

The Product `/domains` diagnostic loop measured on May 7, 2026 used `ceil(UTF-8 bytes / 4)` as an output-token estimate:

| Workflow | Approx output tokens | Elapsed |
| --- | ---: | ---: |
| Compact CLI single loop | 6,286 | 4,809 ms |
| Dev-hosted HTTP MCP single loop | 5,211 | 232 ms |
| Compact CLI repeated reads x3 | 11,660 | 9,572 ms |
| Dev-hosted HTTP MCP repeated reads x3 | 10,537 | 214 ms |

Machine routing adds one lightweight `projects_list` lookup but keeps repeated app reads on the dev-hosted runtime endpoint. The practical rule is: use CLI for reproducible checks and final evidence, then use MCP with `projectId` for repeated reads against the same app/runtime.
