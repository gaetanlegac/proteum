# Diagnostics and Explainability

Proteum exposes two manifest-backed diagnostics surfaces plus one composite request-diagnosis surface:

- `proteum explain`: inspect the generated app structure
- `proteum doctor`: inspect manifest diagnostics
- `proteum diagnose`: combine owner lookup, diagnostics, matching request traces, and buffered server logs for one concrete query or path

These are not separate models for different tools. `explain` and `doctor` share the same generated manifest snapshot, while `diagnose` layers live dev-only request data on top of that same framework view.

## Shared Contract

The canonical snapshot lives in `./.proteum/manifest.json`.

Proteum uses that same manifest in six places:

- `proteum explain` for human-readable and `--json` output
- `proteum doctor` for human-readable and `--json` output
- `proteum explain owner <query>` for ownership lookup over the manifest index
- `proteum doctor --contracts` for generated-artifact and manifest-owned source validation on disk
- the dev-only `__proteum/explain*` and `__proteum/doctor*` HTTP endpoints
- the `Explain`, `Doctor`, and `Diagnose` tabs in the bottom profiler during `proteum dev`

This means the CLI, the dev HTTP endpoints, and the profiler all describe the same framework-owned snapshot before any live trace or log overlays are added.

If a command such as `proteum explain`, `proteum doctor`, `proteum diagnose`, or `proteum refresh` regenerates `.proteum/manifest.json`, the next CLI call, HTTP call, or profiler refresh will reflect that same updated snapshot.

## CLI

Common usage:

```bash
proteum explain
proteum explain owner /api/Auth/CurrentUser
proteum explain --routes --controllers --commands
proteum explain --all --json

proteum doctor
proteum doctor --contracts
proteum doctor --json
proteum doctor --strict

proteum diagnose /
proteum diagnose /dashboard --port 3101
proteum diagnose /api/Auth/CurrentUser --url http://127.0.0.1:3101
```

`proteum explain --json` emits the selected manifest sections as machine-readable JSON.

`proteum doctor --json` emits:

- `summary.errors`
- `summary.warnings`
- `summary.strictFailed`
- `diagnostics`

`proteum diagnose` emits a composite response with:

- `owner`
- `doctor`
- `contracts`
- `request`
- `attribution`
- `suspects`
- `serverLogs`

## Dev HTTP Endpoints

In `profile: dev`, the running app exposes:

- `GET /__proteum/explain`
- `GET /__proteum/explain/owner`
- `GET /__proteum/doctor`
- `GET /__proteum/doctor/contracts`
- `GET /__proteum/logs`
- `GET /__proteum/diagnose`

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

## Profiler

During `proteum dev`, the bottom profiler is the human-facing UI over the same dev diagnostics surfaces.

- `Explain` calls `/__proteum/explain`
- `Doctor` calls `/__proteum/doctor`
- `Diagnose` calls `/__proteum/diagnose` and renders the same owner, diagnostics, suspect, and log summary that the CLI uses
- `Commands` uses the dev command endpoints
- `Auth`, `Timeline`, `Routing`, `Controller`, `SSR`, `API`, `SQL`, and related panels remain request-trace views

Use the profiler when a human needs to browse the same data that an agent or CLI command can already inspect directly.

## Agent Workflow

For AI coding agents or automation:

1. Read `./.proteum/manifest.json` or run `proteum explain --json`.
2. Run `proteum doctor --json` and `proteum doctor --contracts --json` to inspect framework and generated-artifact diagnostics.
3. Run `proteum explain owner <query>` when you need to map a route, controller path, or generated artifact back to source.
4. For concrete request-time behavior, start with `proteum diagnose <path> --port <port>`.
5. Use `proteum trace ...` when you need lower-level event detail than `diagnose` provides.
6. Open the profiler only when a human-readable view helps; it should agree with the CLI after refresh.
