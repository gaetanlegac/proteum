# Diagnostics and Explainability

Proteum exposes two manifest-backed diagnostics surfaces:

- `proteum explain`: inspect the generated app structure
- `proteum doctor`: inspect manifest diagnostics

These are not separate models for different tools. They share the same generated snapshot and the same diagnostics contract.

## Shared Contract

The canonical snapshot lives in `./.proteum/manifest.json`.

Proteum uses that same manifest in four places:

- `proteum explain` for human-readable and `--json` output
- `proteum doctor` for human-readable and `--json` output
- the dev-only `__proteum/explain` and `__proteum/doctor` HTTP endpoints
- the `Explain` and `Doctor` tabs in the bottom profiler during `proteum dev`

This means the CLI, the dev HTTP endpoints, and the profiler all describe the same manifest-backed snapshot.

If a command such as `proteum explain`, `proteum doctor`, or `proteum refresh` regenerates `.proteum/manifest.json`, the next CLI call, HTTP call, or profiler refresh will reflect that same updated snapshot.

## CLI

Common usage:

```bash
proteum explain
proteum explain --routes --controllers --commands
proteum explain --all --json

proteum doctor
proteum doctor --json
proteum doctor --strict
```

`proteum explain --json` emits the selected manifest sections as machine-readable JSON.

`proteum doctor --json` emits:

- `summary.errors`
- `summary.warnings`
- `summary.strictFailed`
- `diagnostics`

## Dev HTTP Endpoints

In `profile: dev`, the running app exposes:

- `GET /__proteum/explain`
- `GET /__proteum/doctor`

`/__proteum/explain` supports optional section selection:

```text
GET /__proteum/explain?sections=routes,controllers,commands
GET /__proteum/explain?section=env&section=diagnostics
```

`/__proteum/doctor` supports optional strict mode:

```text
GET /__proteum/doctor?strict=true
```

These endpoints are intended for local tooling and are not available in production.

## Profiler

During `proteum dev`, the bottom profiler is the human-facing UI over the same dev diagnostics surfaces.

- `Explain` calls `/__proteum/explain`
- `Doctor` calls `/__proteum/doctor`
- `Commands` uses the dev command endpoints
- `Timeline`, `Routing`, `Controller`, `SSR`, `API`, and related panels remain request-trace views

Use the profiler when a human needs to browse the same data that an agent or CLI command can already inspect directly.

## Agent Workflow

For AI coding agents or automation:

1. Read `./.proteum/manifest.json` or run `proteum explain --json`.
2. Run `proteum doctor --json` to inspect framework diagnostics.
3. For request-time behavior, use `proteum trace ...` because traces are live runtime data, not manifest snapshots.
4. Open the profiler only when a human-readable view helps; it should agree with the CLI after refresh.
