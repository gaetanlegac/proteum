# Request Tracing

Proteum ships with one request-instrumentation system with two runtime shapes:

- retained dev traces for `proteum trace`, `proteum perf`, the dev-only HTTP endpoints, and the bottom profiler
- reduced request-local profiling for `request.profiling` and the router `request.finished` hook

The same API and SQL instrumentation feeds both shapes. Dev trace keeps the in-memory buffer and event timeline. Reduced profiling keeps only the finalized request/API/SQL snapshot and releases it after the `request.finished` hook runs.

## Scope

- retained dev tracing is available only when the app runs with `profile: dev`
- traces are exposed through `proteum trace`, `proteum perf`, and the dev-only `__proteum/trace` and `__proteum/perf` HTTP endpoints
- `proteum diagnose` is a separate composite surface that reads the same framework diagnostics plus one matching request trace and buffered server logs; see [diagnostics.md](diagnostics.md)
- `ENABLE_PROFILER=true` enables reduced request-local profiling in any environment, including production

## Main Commands

```bash
proteum trace requests
proteum trace latest
proteum trace show <requestId>
proteum trace arm --capture deep
proteum trace export <requestId>
proteum trace latest --url http://127.0.0.1:3010

proteum perf top --since today
proteum perf request /dashboard --port 3103
proteum perf compare --baseline yesterday --target today --group-by route
proteum perf memory --since 1h --group-by controller
```

Before reproducing a bug or starting a new test pass:

- read the default port from `PORT` or `./.proteum/manifest.json`
- check whether a dev server is already running on that port
- if it is, inspect `proteum trace requests`, `proteum trace latest`, and `proteum trace show <requestId>` first so you can capture past errors and their context

Typical debugging flow:

```bash
proteum orient /dashboard
proteum diagnose /dashboard --hit /dashboard --port 3103
proteum perf request /dashboard --port 3103
proteum trace show <requestId> --port 3103
```

Use `--url http://host:port` when the dev server is reachable on a non-standard host and `--port` is not enough.

If the request under test is protected and login UX is not the feature under test, mint an auth cookie with `proteum session <email> --role <role>` before reproducing the request. This keeps the trace focused on the protected behavior instead of the login flow.

If you already know the failing path and want a one-shot suspect list before reading raw events, start with `proteum diagnose <path> --port <port>` and `proteum perf request <path> --port <port>` first, then drop into `proteum trace show <requestId>` only when the lower-level event stream is still needed.

Use ad hoc database queries or one-off scripts only after `orient`, `diagnose`, `perf request`, and `trace show` still leave the request chain unclear.

Trace summaries include `sql=<count>`. Detailed trace output includes both a `Calls` section for API, cache, or fetcher activity and a `SQL` section for captured Prisma queries.

`proteum perf` is a grouped view over the same trace store:

- `top` ranks routes, concrete paths, or controllers by avg, p95, CPU, SQL, render, self time, and heap delta
- `request` shows one traced request waterfall with stage timings plus the hottest calls, SQL, chain attribution, connected boundary, and SQL fingerprints
- `compare` shows baseline-vs-target regressions between trace windows such as `yesterday` and `today`
- `memory` shows grouped heap and RSS drift trends

## What Gets Recorded

Depending on capture mode, traces can include:

- request start, finish, user identity, status code, and duration
- auth decode input and outcome, route auth decisions, matched auth rules, rule inputs/results, and session create or clear events
- direct controller route matches
- route resolution start, match, and deep-mode skip reasons
- controller start and result shape
- synchronous SSR fetcher calls, API batch fetchers, and async request traces
- cache hits and cache writes observed during request handling
- Prisma SQL queries with caller method/path, optional fetcher attribution, SQL text, params, kind, operation, and timing
- created router/context keys
- setup output keys and page data summaries
- SSR payload shape and serialized byte size
- render start/end timings and document output sizes
- per-request CPU usage deltas plus heap and RSS snapshots before and after the request
- normalized request errors
- additive owner, service, cache, and connected-boundary metadata propagated from route/controller resolution into downstream calls and SQL

Reduced request-local profiling keeps the finalized request summary plus API and SQL rows only:

- `request.profiling` exists before the router `request` hook runs
- `request.profiling.apiCalls` and `request.profiling.sqlQueries` start empty and are populated during request handling
- the router `request.finished` hook receives that same object after status, duration, API calls, and SQL queries are finalized
- when only reduced profiling is enabled, finished requests are released immediately after `request.finished` instead of being retained in the global trace buffer

## SQL Tracing

Prisma query tracing covers both ORM operations and raw queries.

- `kind` is recorded as `orm` or `raw`
- `operation` records the Prisma operation such as `findFirst`, `count`, or `$queryRawUnsafe`
- `model` is recorded when Prisma exposes one
- `callerMethod` and `callerPath` attach the query to the request that triggered it
- when the query runs inside an SSR fetcher or an API batch fetcher, the trace also records the fetcher id/label and call id
- `durationMs`, `startedAt`, and `finishedAt` come from Prisma query events
- `query`, `paramsText`, and parsed `paramsJson` are stored for inspection

This currently covers SQL issued through Proteum's Prisma service, including raw helpers that flow through the same Prisma client.

Each traced SQL entry can now include:

- `fingerprint`: stable normalized SQL shape for repeated-query comparison
- `ownerLabel` and `ownerFilepath`: route/controller ownership propagated from the request
- `serviceLabel`: the inferred service boundary when available
- `connectedNamespace`: the connected producer namespace when the request crossed an app boundary

`proteum diagnose` and `proteum perf request` collapse those lower-level records into a compact request chain:

- route or controller
- service
- cache branch when used
- connected app boundary when used
- SQL fingerprints

## Capture Modes

- `summary`: smallest capture, focused on request lifecycle and high-signal events
- `resolve`: adds route matching, controller, setup, and context milestones
- `deep`: adds route skip reasons and deeper summarized payload inspection for one request

Use `deep` selectively. It is for one-off investigation, not continuous capture.

## Profiler

During `proteum dev`, the bottom profiler renders the same live request traces.

- `Summary` charts recent duration, workload, route frequency, and status trends for the captured sessions
- `Timeline` shows the full request event stream
- `Auth` filters the selected session down to auth-specific events so matched rules, tracking, and allow/deny outcomes can be inspected without scanning unrelated events
- `Routing`, `Controller`, and `SSR` add focused charts over resolve, controller lifecycle, render, and payload data for the selected trace
- `API` shows synchronous SSR/API fetcher calls plus async requests, with workload and status charts above the waterfall
- `SQL` shows captured Prisma queries grouped by caller, with workload, operation, and heatmap charts plus a waterfall and detail sidebar
- `Errors` adds grouped source and error-family charts over the captured failures
- `Diagnose` combines the selected request summary with explain/doctor/contracts data and buffered server logs, plus visual suspect, owner, and severity charts
- `Explain`, `Doctor`, `Commands`, and `Cron` render the same manifest and dev-runtime contracts as their CLI surfaces with matching summary charts
- `Perf` renders the same top, request, compare, and memory rollups exposed by `proteum perf`, with visual charts for hot-path latency, time composition, regressions, and memory drift
- expanding an auth event shows the summarized detail payload exactly as stored in the trace

## Configuration

Set trace behavior with env vars:

```bash
export TRACE_ENABLE=true
export TRACE_REQUESTS_LIMIT=200
export TRACE_EVENTS_LIMIT=800
export TRACE_CAPTURE=resolve
export TRACE_PERSIST_ON_ERROR=true
export ENABLE_PROFILER=true
```

Notes:

- `enable` and `persistOnError` still remain dev-only in the current runtime
- `capture` defaults to `resolve`
- `requestsLimit` defaults to `200`
- `eventsLimit` defaults to `800`
- `proteum dev` removes auto-persisted crash traces from `var/traces/` when the dev session stops
- explicit `proteum trace export` files under `var/traces/exports/` are left in place
- `ENABLE_PROFILER` reuses the same request instrumentation path but skips the retained global buffer and event timeline when dev trace is otherwise off

## Memory Model

Traces are kept in memory per Node process.

- requests are stored in a ring buffer capped by `requestsLimit`
- the oldest request traces are evicted first
- each request is capped by `eventsLimit`
- once the event cap is reached, extra events are dropped and counted in `droppedEvents`
- payloads are summarized rather than stored as raw objects

Current summarization rules:

- arrays keep at most 10 sampled items
- objects keep at most 20 keys per level
- deep capture stops at depth 3
- long strings are truncated

## Redaction

Sensitive values are redacted before they enter the trace store.

This includes keys such as:

- `cookie`
- `authorization`
- `password`
- token-like fields such as `accessToken`, `refreshToken`, `apiKey`, `jwt`, and similar names
- `rawBody`

The goal is to make traces useful for debugging without turning the dev server into a secret dump.

## Dev HTTP Endpoints

These endpoints back the CLI:

- `GET /__proteum/trace/requests`
- `GET /__proteum/trace/latest`
- `GET /__proteum/trace/requests/:id`
- `POST /__proteum/trace/arm`
- `GET /__proteum/perf/top`
- `GET /__proteum/perf/compare`
- `GET /__proteum/perf/memory`
- `GET /__proteum/perf/request`

The CLI should be the primary interface. Use the HTTP endpoints when you need direct machine access from another local dev tool.
