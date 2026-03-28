# Request Tracing

Proteum ships with a dev-only in-memory request trace buffer so routing, controller execution, SSR, API, Prisma SQL, render behavior, and request-time performance can be inspected without attaching a debugger or scattering temporary logs through the runtime.

## Scope

- tracing is available only when the app runs with `profile: dev`
- traces are exposed through `proteum trace`, `proteum perf`, and the dev-only `__proteum/trace` and `__proteum/perf` HTTP endpoints
- `proteum diagnose` is a separate composite surface that reads the same framework diagnostics plus one matching request trace and buffered server logs; see [diagnostics.md](diagnostics.md)
- production requests are not traced by this feature

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
proteum trace arm --capture deep --port 3103
# reproduce the failing request once
proteum trace requests --port 3103
proteum trace show <requestId> --port 3103
```

Use `--url http://host:port` when the dev server is reachable on a non-standard host and `--port` is not enough.

If the request under test is protected and login UX is not the feature under test, mint an auth cookie with `proteum session <email> --role <role>` before reproducing the request. This keeps the trace focused on the protected behavior instead of the login flow.

If you already know the failing path and want a one-shot suspect list before reading raw events, start with `proteum diagnose <path> --port <port>` and drop into `proteum trace show <requestId>` only when the lower-level event stream is still needed.

Trace summaries include `sql=<count>`. Detailed trace output includes both a `Calls` section for API/fetcher activity and a `SQL` section for captured Prisma queries.

`proteum perf` is a grouped view over the same trace store:

- `top` ranks routes, concrete paths, or controllers by avg, p95, CPU, SQL, render, self time, and heap delta
- `request` shows one traced request waterfall with stage timings plus the hottest calls and SQL
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
- Prisma SQL queries with caller method/path, optional fetcher attribution, SQL text, params, kind, operation, and timing
- created router/context keys
- setup output keys and page data summaries
- SSR payload shape and serialized byte size
- render start/end timings and document output sizes
- per-request CPU usage deltas plus heap and RSS snapshots before and after the request
- normalized request errors

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
```

Notes:

- `enable` and `persistOnError` still remain dev-only in the current runtime
- `capture` defaults to `resolve`
- `requestsLimit` defaults to `200`
- `eventsLimit` defaults to `800`
- `proteum dev` removes auto-persisted crash traces from `var/traces/` when the dev session stops
- explicit `proteum trace export` files under `var/traces/exports/` are left in place

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
