# Diagnostics Rules

This file is the canonical source of truth for diagnostics, temporary instrumentation, error solving, and verification method selection across Proteum-based projects.

## Initial Triage

- Start with machine-readable app state before reading large parts of the codebase: `npx proteum orient <query>`, `./.proteum/manifest.json`, `npx proteum connect --json`, `npx proteum explain --json`, `npx proteum doctor --json`, and `npx proteum doctor --contracts --json` when generated artifacts or manifest-owned files may be stale.
- When one app depends on another app's generated controllers, inspect `npx proteum connect --controllers`, `npx proteum explain --connected --controllers`, the producer `proteum.connected.json`, the consumer `proteum.config.ts` connected `source` value, and the producer `./.proteum/proteum.connected.d.ts` before assuming the contract is local.
- Use `rg -n` first to narrow the exact code path, then read only the relevant files.
- Inspect `./server/index.ts`, `./server/config/*.ts`, and the touched files under `./commands`, `./server/controllers`, `./server/services`, `./server/routes`, `./client/pages`, and `./tests`.
- Distinguish real app failures from wrapper, transport, tooling, or environment failures as early as possible.

## Runtime Diagnostics

- For long-lived dev reproductions, start the app with `npx proteum dev --session-file <path> --replace-existing --port <port>` so the session can be listed and stopped deterministically after the repro.
- Only the bare `npx proteum build` and bare `npx proteum dev` commands print the welcome banner and active Proteum installation method. Any extra argument or option skips the banner. Only `npx proteum dev` clears the interactive terminal before rendering and reports connected app names plus successful connected `/ping` checks in the ready banner; keep that in mind when capturing or comparing command logs during diagnosis.
- For ownership or repo discovery questions, start with `npx proteum orient <query>` instead of jumping straight into source searches.
- For request-time issues in dev, start with `npx proteum diagnose <path> --port <port>` when you have a concrete failing route, page, controller path, or request target. It combines owner lookup, manifest diagnostics, contract diagnostics, matching trace data, and buffered server logs in one pass.
- Prefer focused verification before global checks: `npx proteum verify owner <query>`, `npx proteum verify request <path>`, and only then `npx proteum verify browser <path>` or targeted Playwright when the bug is browser-visible.
- For connected-project failures, confirm the consumer app resolves the expected `connect.<Namespace>.source` and `connect.<Namespace>.urlInternal` values, the producer app exposes `GET /api/__proteum/connected/ping`, and the imported controller entries show `scope=connected` in `proteum explain`.
- Use `npx proteum explain owner <query>` when you need a fast ownership graph for a route, controller path, source file, or generated artifact before reading code.
- For performance issues or regressions in dev, use `npx proteum perf top --since <window>` to rank hot paths, `npx proteum perf request <requestId|path>` for one request waterfall plus chain attribution and SQL fingerprints, `npx proteum perf compare --baseline <window> --target <window>` for regressions, and `npx proteum perf memory --since <window>` for heap or RSS drift.
- For bundle-size inspection, use `npx proteum build --prod --analyze` to emit `bin/bundle-analysis/client.html` and `client-stats.json`, or add `--analyze-serve --analyze-port auto` when you want a local analyzer URL instead of a static HTML file.
- For request-time issues in dev, inspect traces before adding logs when the diagnose surface is still too coarse.
- If a server is already running on the default port from `PORT` or `./.proteum/manifest.json`, inspect existing traces before reproducing the issue.
- If existing traces are insufficient, arm `npx proteum trace arm --capture deep`, reproduce once, then inspect the new request with `npx proteum trace latest` or `npx proteum trace show <requestId>`.
- Inspect browser console errors and warnings for frontend, SSR, hydration, and controller-call issues.
- Inspect server startup and runtime errors.
- For protected browser or API flows in dev, prefer `npx proteum session <email> --role <role>` over driving the login UI. Feed that auth into `npx proteum verify browser ...` or direct Playwright. Use the login UI only when auth UX itself is under test.

## Temporary Instrumentation

- When manifest inspection, trace data, browser console output, and server errors are still insufficient, add temporary targeted logs in the code to confirm control flow, payload shape, query shape, or branch selection.
- If SQL is needed during diagnosis, keep it read-only. Never use SQL to change database structure or execute schema-mutating DDL.
- Keep temporary logs narrow, contextual, and easy to remove. Do not leave broad debug noise in shared execution paths.
- Re-run only the smallest relevant repro, request, or test after adding temporary instrumentation.
- Temporary logs added in the code for diagnosis must be cleaned at the end of tests or the repro cycle and must never be committed.

## Error Solving

- Fix the contract boundary, not only the downstream symptom.
- Treat provider, SSR/client-only hook, router-context, and connected-boundary failures as contract mistakes first. The likely fix is where the boundary was crossed incorrectly, not only where the throw surfaced.
- Prefer explicit typed schemas, adapters, query `select`s, and narrow response shapes over casts, broad payloads, or hidden fallbacks.
- Keep patches narrow, then verify immediately at the failing layer before broadening the test surface.
- Review the resulting diff to confirm the fix removed the cause instead of masking it.

## Verification And Testing

- Use the cheapest trustworthy verification that matches the failing layer.
- After implementing a change, verify only at the smallest trustworthy layer required by the changed surface. Do not default to a running app, project-wide typecheck, `npx proteum check`, or Playwright when a narrower static or request-level verification is enough.
- For compile-time or type-safety issues, start with the relevant targeted typecheck or build command. Do not run them by default for unrelated runtime, copy, docs, or local refactor changes.
- For request/runtime issues, verify through the real page, route, generated controller call, or command on a running app.
- Start the smallest trustworthy runtime surface first: `npx proteum orient <query>`, then the relevant real URL, generated controller call, command, or `npx proteum diagnose <path> --port <port>`. Add targeted Playwright coverage only when request-level verification is insufficient or the change is browser-visible.
- Proteum does not provide a dedicated raw browser-runtime CLI. When `npx proteum verify browser` is insufficient, use direct Playwright with a disposable profile. Do not launch raw browser automation against a shared persistent profile.
- Focused verification should treat unrelated global diagnostics as visible but non-blocking by default. Use `--strict-global` only when the task explicitly requires broad clean-room validation.
- For browser regressions, prefer a real browser repro first and add targeted Playwright coverage only when the user asks for automated coverage, when a stable regression path needs automation, or when manual/browser verification is insufficient.
- Only the final verifier agent should usually run browser flows. Earlier agents should stay on `orient`, `verify owner`, `verify request`, `diagnose`, and command-level checks unless browser execution is the only trustworthy reproducer.
- Treat server startup failures, runtime errors, browser console errors or warnings, and Playwright failures as blocking unless they are clearly unrelated to the change.
- When the touched surface can affect coding-style enforcement, run the smallest relevant static check. Do not default to `npx proteum check`; prefer a narrower lint or type check only when the changed surface or an observed issue calls for it.
- If the task started any long-lived `proteum dev` server, stop it explicitly with `npx proteum dev stop --session-file <path>` or `npx proteum dev stop --all --stale`, then confirm the remaining tracked sessions with `npx proteum dev list --json`.
- Add `data-testid` when stable selectors are missing instead of relying on brittle text or DOM-shape selectors.
- If an isolated test misses prerequisite state, run the smallest broader scope that reproduces the real setup.
- After a fix, re-check traces, rendered HTML, browser console, and server output when those surfaces were part of the original failure.
