# Test Contract

This is the canonical test-area contract for Proteum-based projects.
Role: keep only test-area rules here.
Keep here: runtime verification guidance, selector strategy, test-specific reuse rules, and authenticated test-flow expectations.
Do not put here: production implementation rules, page/service architecture contracts, or duplicated project workflow that belongs in broader AGENTS files.

Diagnostics source of truth: project-root `diagnostics.md`.

- Understand the real user flow and the main feature branches before writing tests.
- Test the current controller/page runtime model, not legacy `@Route` or `api.fetch(...)` behavior.
- Verify routing, controllers, SSR, and router plugins against a running app when behavior depends on real request handling.
- After implementing a browser-visible feature or change, prefer a real browser repro against a running app first. Add targeted Playwright coverage only when the user asks for automated coverage, when a stable regression path needs automation, or when manual/browser verification is insufficient.
- Exercise real URLs, generated controller calls, or real browser flows instead of re-deriving framework internals in tests.
- Locate elements with `data-testid`.
- Add `data-testid` where needed instead of relying on brittle selectors.
- Reuse root catalog files from `/client/catalogs/**`, `/server/catalogs/**`, or `/common/catalogs/**` instead of duplicating catalog constants in tests.
- For protected dev flows, prefer `npx proteum session <email> --role <role>` over automating login unless the login flow itself is under test.
