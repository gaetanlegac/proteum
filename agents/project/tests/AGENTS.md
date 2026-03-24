# E2E Tests

This file adds test-area local rules on top of the canonical framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

- Understand the real user flow and the main feature branches before writing tests.
- Test the current controller/page runtime model, not legacy `@Route` or `api.fetch` behavior.
- Locate elements with `data-testid`.
- Add `data-testid` where needed instead of relying on brittle selectors.
- Reuse root catalog files from `/client/catalogs/**`, `/server/catalogs/**`, or `/common/catalogs/**` instead of duplicating catalog constants in tests.
