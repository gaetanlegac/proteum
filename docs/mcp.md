# Proteum MCP

Proteum exposes MCP through two coordinated surfaces:

- `proteum mcp`: one machine-scope router for live Proteum dev projects.
- `proteum dev`: one app-root runtime endpoint at `http://localhost:<port>/__proteum/mcp`.

Agents should normally connect to `proteum mcp`. The router discovers live `proteum dev` sessions from the machine registry, can resolve offline Proteum app roots from a supplied `cwd`, returns stable `projectId` values for live projects, and forwards app-bound reads to the selected dev-hosted endpoint.

## Machine Router

Start the router from any directory:

```bash
proteum mcp
```

When run from a terminal, `proteum mcp` starts or reuses the managed local daemon at `http://127.0.0.1:3769/mcp`. The terminal output prints a compact `CENTRAL MCP READY` banner with the one-line client setup instruction, `Connect MCP client (HTTP): <mcp-url>`. When an MCP client launches it over pipes, use stdio:

```bash
proteum mcp --stdio
```

`proteum dev` ensures the managed machine MCP daemon is running before the dev loop starts. Only one managed daemon may run at a time. Stale daemon records are cleaned automatically.

The router is read-only. It does not start or stop dev servers, mutate files, refresh generated code, run migrations, or execute commands.

Use this flow:

1. Call MCP `workflow_start` with `cwd` or a known `projectId`.
2. If the result is ambiguous or returns offline app candidates, call `project_resolve { cwd }`, pick the intended app root, resolve any returned `data.readiness.state="blocked"` setup actions, start exactly one `proteum dev` server from that app root when needed, then retry `workflow_start`.
3. Pass the returned live `projectId` to every follow-up app-bound MCP call.
4. After an MCP read succeeds, do not run the equivalent CLI command or broad source search for the same state; keep CLI for fallback, validation, and final terminal evidence.

Example tool calls:

```json
{"tool":"workflow_start","arguments":{"cwd":"/repo/apps/product","task":"read-only runtime health pass","route":"/dashboard"}}
{"tool":"projects_list","arguments":{}}
{"tool":"project_resolve","arguments":{"cwd":"/repo/apps/product/client/pages"}}
{"tool":"workflow_start","arguments":{"projectId":"prj_0123abcd4567","route":"/dashboard"}}
{"tool":"runtime_status","arguments":{"projectId":"prj_0123abcd4567"}}
{"tool":"orient","arguments":{"projectId":"prj_0123abcd4567","query":"/dashboard"}}
{"tool":"route_candidates","arguments":{"projectId":"prj_0123abcd4567","query":"dashboard","limit":8}}
{"tool":"explain_summary","arguments":{"projectId":"prj_0123abcd4567","query":"/dashboard"}}
{"tool":"diagnose","arguments":{"projectId":"prj_0123abcd4567","path":"/dashboard"}}
{"tool":"db_query","arguments":{"projectId":"prj_0123abcd4567","sql":"SELECT id, email FROM User LIMIT 5","limit":5}}
```

`workflow_start` is the only app-bound bootstrap tool that may resolve from `cwd` when `projectId` is not known. It may return offline app candidates when no matching dev server is running yet. Its machine-router response includes `data.readiness`, a read-only fresh-copy preflight covering app/root `.env` files, dependency install root and package manager, generated Proteum manifest state, local connected producer apps, Prisma schema/client readiness, redacted database URL shape, and local TCP database reachability when the host is local. The preflight adds exact setup commands where safe, such as copying `.env.example`, installing dependencies, running `npx proteum refresh`, generating Prisma Client, checking Prisma migration status, preflighting connected producer apps, and starting `proteum dev` on a checked port. Other app-bound tools require a live `projectId`; if they omit it, the router returns a compact error that tells the agent to call `projects_list` or `project_resolve`. There is no single-project fallback, because wrong-project reads are worse than an explicit routing retry.

When the selected app root is inside `/.codex/worktrees/`, `workflow_start` first checks `.proteum/worktree-bootstrap.json`. If the marker is missing or stale, it returns `ok: false` with a single next action such as `npx proteum worktree init --source <source-app-root>` or the same command with `--refresh`. The router does not forward to the app MCP endpoint until bootstrap is complete, unless `PROTEUM_ALLOW_UNBOOTSTRAPPED_WORKTREE=1` is set; bypasses remain visible in MCP, `runtime status`, and `doctor`.

## Dev Runtime Endpoint

During `proteum dev`, the app exposes the same app-level MCP contract through the official streamable HTTP transport:

```text
POST /__proteum/mcp
GET /__proteum/mcp
DELETE /__proteum/mcp
```

This endpoint is dev-only and local-tooling-only. It is already rooted to the running app, so its tools do not require `projectId` or `cwd`. The machine router strips routing fields before forwarding a call here.

The dev session UI and ready banner print:

```text
mcp  http://localhost:<port>/__proteum/mcp
MCP: http://localhost:<port>/__proteum/mcp
```

`proteum dev` also writes a machine registry record under `~/.proteum/dev-sessions/`. The stable `projectId` is derived from the canonical app root, so it remains stable across port or session-file changes.

## Discovery And Recovery

If machine MCP routing fails:

1. Run `proteum mcp status`.
2. Run `proteum runtime status` from the intended app root. If you are in a monorepo wrapper, use the returned app candidates and exact next action instead of starting dev from the wrapper.
3. If the app root is inside `/.codex/worktrees/` and runtime status or workflow start reports missing/stale bootstrap, run `proteum worktree init --source <source-app-root>` or the returned `--refresh` command first.
4. If `workflow_start` returns `data.readiness.state="blocked"`, run or resolve the readiness setup actions before starting dev.
5. If no live app session exists, use the exact Start Dev next action returned by runtime status or `workflow_start`. It checks the configured router/HMR ports and suggests an alternate free port when the manifest default is occupied.
6. If a live session exists but runtime/MCP is unreachable, stop the listed session file with `proteum dev stop --session-file <path>`, then start dev again.
7. Retry MCP `workflow_start` and use the returned `projectId`.

Offline `project_resolve` and `workflow_start` candidates also inspect configured router/HMR ports before returning `nextAction`. If the configured port already serves the same app but no live machine project is registered, the next action is runtime tracking repair, not starting a second dev server.

`proteum runtime status` refreshes the machine registry for live tracked sessions, so this recovery path also repairs missing router records after an upgrade.

Do not start a second `proteum dev` server in the same worktree. `proteum dev` fails fast when another live tracked session already exists for the same app root.
Do not start a second managed `proteum mcp` daemon. `proteum mcp` reuses the live daemon or reports its current URL.
Do not call `diagnose`, `trace_*`, or `perf_*` while runtime health is unreachable; repair or start dev first.
Do not `curl` normal page routes to identify port ownership; use `proteum runtime status` or Proteum dev-only `/__proteum/*` endpoints so wrong-app HTML is never dumped into agent context.

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
| `project_resolve` | Resolve a live project or offline app candidate by `projectId`, `cwd`, app root, or app-root substring |

App-bound tools require `projectId` when called through `proteum mcp`:

| Tool | Purpose |
| --- | --- |
| `workflow_start` | One-call bootstrap with resolved project, fresh-copy readiness, runtime, selected instruction previews, owner summary, doctor summaries, duplicate-avoidance rules, and next actions |
| `runtime_status` | Manifest summary, selected runtime, tracked sessions, health, and MCP URL |
| `orient` | Owner, instruction routing, connected boundaries, and next actions |
| `instructions_resolve` | Selected instruction files for a query, with short previews and full-read policy |
| `route_candidates` | Compact route/controller/page matches for a query without dumping the raw route table |
| `explain_summary` | Compact manifest summary or owner lookup |
| `doctor` | Compact manifest and optional contract diagnostics |
| `diagnose` | Composite diagnosis for an existing route, query, or request trace |
| `trace_latest` | Compact latest trace summary, with optional paginated detail |
| `trace_show` | Compact or paginated detail for a specific request trace |
| `perf_top` | Hot-path perf rollup |
| `perf_request` | One-request waterfall and attribution |
| `logs_tail` | Capped recent server logs |
| `db_query` | Capped read-only database diagnostics for one `SELECT`, `SHOW`, or `EXPLAIN` statement |

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
proteum explain owner /dashboard
proteum db query "SELECT id, email FROM User LIMIT 5" --port 3101
proteum explain --routes --controllers --full # only when the raw route/controller arrays are required
```

Use MCP when an agent is asking a running app for repeated state:

```text
workflow_start { cwd, task, route? }
runtime_status { projectId }
instructions_resolve { projectId, query }
orient { projectId, query }
route_candidates { projectId, query }
explain_summary { projectId, query }
doctor { projectId }
diagnose { projectId, path }
trace_show { projectId, requestId }
trace_latest { projectId }
perf_request { projectId, query }
logs_tail { projectId }
db_query { projectId, sql, limit? }
```

After an MCP read succeeds, do not run the equivalent CLI command for the same state, and do not run broad source searches for ownership that MCP already returned. CLI output is for fallback, validation, command evidence, and human-shareable reproductions.

Database diagnostics are intentionally read-only. `db_query` and `proteum db query` support MySQL, MariaDB, PostgreSQL, and PostgreSQL-compatible `DATABASE_URL` protocols. They accept only one `SELECT`, `SHOW`, or `EXPLAIN` statement, return rows, columns, elapsed milliseconds, and cap metadata, and reject multi-statement SQL, `EXPLAIN ANALYZE`, locking reads, file reads/writes, sleep, and benchmark functions.


## Benchmark

The Product `/domains` diagnostic loop measured on May 7, 2026 used `ceil(UTF-8 bytes / 4)` as an output-token estimate:

| Workflow | Approx output tokens | Elapsed |
| --- | ---: | ---: |
| Compact CLI single loop | 6,286 | 4,809 ms |
| Dev-hosted HTTP MCP single loop | 5,211 | 232 ms |
| Compact CLI repeated reads x3 | 11,660 | 9,572 ms |
| Dev-hosted HTTP MCP repeated reads x3 | 10,537 | 214 ms |

Machine routing adds one lightweight `projects_list` lookup but keeps repeated app reads on the dev-hosted runtime endpoint. The practical rule is: use CLI for reproducible checks and final evidence, then use MCP with `projectId` for repeated reads against the same app/runtime.

## Codex Usage Test

Proteum core uses Vitest for framework tests. The live Codex MCP usage test is opt-in because it runs the real Codex CLI, may spend model tokens, and depends on the developer machine's Codex auth plus MCP registration.

```bash
PROTEUM_CODEX_MCP_USAGE_CWD=/absolute/path/to/proteum/app npm run test:codex-mcp
```

The test sends a read-only runtime health prompt to `codex exec --json`, stores the JSONL transcript, stderr, last message, and `summary.json`, then asserts:

- token usage was reported and quantified
- at least one Proteum MCP `workflow_start` call happened
- total Proteum MCP calls meet `PROTEUM_CODEX_MCP_MIN_MCP_CALLS` (`4` by default)
- Proteum CLI fallback calls stay under `PROTEUM_CODEX_MCP_MAX_CLI_CALLS` (`4` by default)

Useful optional variables:

```bash
CODEX_CLI=/path/to/codex
PROTEUM_CODEX_MCP_USAGE_OUTPUT_DIR=/tmp/proteum-codex-mcp-usage
PROTEUM_CODEX_MCP_USAGE_TIMEOUT_MS=1200000
PROTEUM_CODEX_MCP_MIN_MCP_CALLS=4
PROTEUM_CODEX_MCP_MAX_CLI_CALLS=4
```
