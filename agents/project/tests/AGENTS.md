# Codex guidance for writing E2E tests

- Understand the typical user flow and the main feature branches
- Favor as many tests as possible to cover real usage
- Always locate elements via their `data-testid` attribute
- Add `data-testid` where needed
- Keep test files clean, organized and structured
- Test the current controller/page runtime model, not legacy `@Route` or `api.fetch` behavior
