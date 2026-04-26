# Test Contract

This is the canonical test-area contract for Proteum-based projects.
Role: keep only test-area rules here.
Keep here: runtime verification guidance, selector strategy, test-specific reuse rules, and authenticated test-flow expectations.
Do not put here: production implementation rules, page/service architecture contracts, or duplicated project workflow that belongs in broader AGENTS files.

Diagnostics source of truth: root-level `diagnostics.md`.

- Understand the real user flow and the main feature branches before writing tests.
- Test the current controller/page runtime model, not legacy `@Route` or `api.fetch(...)` behavior.
- Verify routing, controllers, SSR, and router plugins against a running app when behavior depends on real request handling.
- After implementing a new feature or changing existing feature behavior, update the end-to-end coverage for that behavior and run the full Playwright suite before finishing. Prefer `npx proteum e2e --port <port>` for Playwright runs so base URLs and auth tokens are passed through Proteum-managed child env instead of shell-leading environment assignments. Use a browser MCP repro against a running app during iteration when it is the fastest trustworthy loop.
- For UI-visible feature changes, after the required Playwright run passes, use the browser MCP to capture focused screenshots of the changed areas and inspect them for visual correctness before finishing.
- Exercise real URLs, generated controller calls, or real browser flows instead of re-deriving framework internals in tests.
- Organize end-to-end tests following the Crosspath platform layout under `tests/e2e/**`.
- Put runnable scenario entrypoints in `tests/e2e/features/**`, `tests/e2e/specs/<domain>/**`, or `tests/e2e/journeys/**` depending on scope.
- Put page objects and reusable UI surface wrappers in `tests/e2e/pages/**`.
- Put reusable multi-step user flows in `tests/e2e/workflows/**`.
- Put test data builders in `tests/e2e/factories/**` and generic helpers in `tests/e2e/utils/**`.
- Keep helpers out of spec files when they are reusable, and do not create ad hoc flat test files or duplicate support abstractions when an existing page, workflow, factory, or utility already fits.
- Locate elements with `data-testid`.
- Add `data-testid` where needed instead of relying on brittle selectors.
- Keep end-to-end tests clean, well organized, and non-redundant. Prefer extending or reshaping the most relevant existing scenario over duplicating coverage, and remove or consolidate overlap when the suite becomes repetitive.
- Reuse root catalog files from `/client/catalogs/**`, `/server/catalogs/**`, or `/common/catalogs/**` instead of duplicating catalog constants in tests.
- For protected dev flows, prefer `npx proteum e2e --session-email <email> --session-role <role>` or `npx proteum session <email> --role <role>` over automating login unless the login flow itself is under test.
