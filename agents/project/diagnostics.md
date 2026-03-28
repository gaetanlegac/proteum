# Diagnostics Rules

This file is the canonical source of truth for diagnostics, temporary instrumentation, error solving, and verification method selection across Proteum-based projects.

## Initial Triage

- Start with machine-readable app state before reading large parts of the codebase: `./.proteum/manifest.json`, `npx proteum explain --json`, `npx proteum doctor --json`, and `npx proteum doctor --contracts --json` when generated artifacts or manifest-owned files may be stale.
- Use `rg -n` first to narrow the exact code path, then read only the relevant files.
- Inspect `./server/index.ts`, `./server/config/*.ts`, and the touched files under `./commands`, `./server/controllers`, `./server/services`, `./server/routes`, `./client/pages`, and `./tests`.
- Distinguish real app failures from wrapper, transport, tooling, or environment failures as early as possible.

## Runtime Diagnostics

- For request-time issues in dev, start with `npx proteum diagnose <path> --port <port>` when you have a concrete failing route, page, controller path, or request target. It combines owner lookup, manifest diagnostics, contract diagnostics, matching trace data, and buffered server logs in one pass.
- Use `npx proteum explain owner <query>` when you need a fast ownership graph for a route, controller path, source file, or generated artifact before reading code.
- For request-time issues in dev, inspect traces before adding logs when the diagnose surface is still too coarse.
- If a server is already running on the default port from `PORT` or `./.proteum/manifest.json`, inspect existing traces before reproducing the issue.
- If existing traces are insufficient, arm `npx proteum trace arm --capture deep`, reproduce once, then inspect the new request with `npx proteum trace latest` or `npx proteum trace show <requestId>`.
- Inspect browser console errors and warnings for frontend, SSR, hydration, and controller-call issues.
- Inspect server startup and runtime errors.
- For protected browser or API flows in dev, prefer `npx proteum session <email> --role <role>` over driving the login UI. Use the login UI only when auth UX itself is under test.

## Temporary Instrumentation

- When manifest inspection, trace data, browser console output, and server errors are still insufficient, add temporary targeted logs in the code to confirm control flow, payload shape, query shape, or branch selection.
- Keep temporary logs narrow, contextual, and easy to remove. Do not leave broad debug noise in shared execution paths.
- Re-run only the smallest relevant repro, request, or test after adding temporary instrumentation.
- Temporary logs added in the code for diagnosis must be cleaned at the end of tests or the repro cycle and must never be committed.

## Error Solving

- Fix the contract boundary, not only the downstream symptom.
- Prefer explicit typed schemas, adapters, query `select`s, and narrow response shapes over casts, broad payloads, or hidden fallbacks.
- Keep patches narrow, then verify immediately at the failing layer before broadening the test surface.
- Review the resulting diff to confirm the fix removed the cause instead of masking it.

## Verification And Testing

- Use the cheapest trustworthy verification that matches the failing layer.
- For compile-time or type-safety issues, start with the relevant typecheck or build command.
- For request/runtime issues, verify through the real page, route, generated controller call, or command on a running app.
- For browser regressions, prefer targeted Playwright coverage and inspect failure artifacts such as screenshots, videos, `error-context.md`, and Playwright traces.
- Add `data-testid` when stable selectors are missing instead of relying on brittle text or DOM-shape selectors.
- If an isolated test misses prerequisite state, run the smallest broader scope that reproduces the real setup.
- After a fix, re-check traces, rendered HTML, browser console, and server output when those surfaces were part of the original failure.
