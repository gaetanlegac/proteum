# Dev Sessions

Proteum ships dev-only auth bootstrap commands so `proteum verify browser`, `proteum e2e`, Playwright runs, and local debugging can start from an authenticated state without driving the login UI.

## When To Use It

Use `proteum session` when:

- a protected page, controller, or manual route must be exercised in dev
- an LLM agent or browser automation needs an authenticated cookie quickly
- you want to reproduce role-gated behavior with a known user account

Do not use it when:

- the login or signup flow itself is under test
- you are validating third-party auth redirects or callback handling
- you do not know which user should be used for the scenario

## CLI

Local mode:

```bash
proteum session admin@example.com --role ADMIN
```

Remote mode against an existing dev server:

```bash
proteum session admin@example.com --role ADMIN --port 3101
proteum session god@example.com --role GOD --url http://localhost:3102 --json
```

Playwright wrapper mode:

```bash
proteum e2e --port 3101 --session-email admin@example.com --session-role ADMIN tests/e2e/features/admin.spec.ts
proteum e2e --url http://localhost:3101 --env FEATURE_FLAG=true --grep smoke
```

Behavior:

- local mode refreshes generated artifacts, builds the dev output, starts a temporary local dev server, creates the session, prints the payload, and exits
- remote mode talks to an already running `proteum dev` instance
- `proteum e2e` talks to an already running `proteum dev` instance when `--session-email` is present, then starts Playwright with `E2E_BASE_URL`, optional `E2E_PORT`, optional `E2E_AUTH_TOKEN`, and any explicit `--env` or `--env-file` values in the child process environment
- the command requires an explicit email and optionally asserts a role before returning the session
- the command is available only in dev mode
- browser verification flows should keep browser state app-local and disposable through `proteum verify browser` or direct Playwright instead of reusing a shared temp profile

## Output Contract

The JSON payload includes:

- `baseUrl`
- `user`
- `session.token`
- `session.cookieName`
- `session.issuedAt`
- `session.expiresAt`
- `browserCookie`
- `curlCookieHeader`
- `playwright.cookies`

Playwright usage:

```ts
await browserContext.addCookies(output.playwright.cookies);
```

HTTP usage:

```bash
curl -H "$(jq -r '.curlCookieHeader' session.json)" http://localhost:3101/api/Auth/CurrentUser
```

## Agent Guidance

- Prefer `proteum session` over UI login automation when the goal is to test or debug protected application behavior.
- Prefer `proteum verify browser` for focused browser-visible verification, and `proteum e2e --port <port>` for targeted or full Playwright suites. When lower-level control is required, use direct Playwright with a disposable profile.
- Use UI login automation only when the auth UX itself is the feature under test.
- Pair it with `proteum diagnose` for a fast protected-route summary, `proteum perf request` for a one-request timing breakdown, then use `proteum trace` when you need lower-level request events.
- Only the final verifier agent should usually run browser flows. Earlier agents should stay on `orient`, `verify owner`, `verify request`, and request-level diagnostics unless browser execution is required.

Typical flow:

```bash
proteum orient /dashboard
proteum session admin@example.com --role ADMIN --port 3101 --json > session.json
proteum e2e --port 3101 --session-email admin@example.com --session-role ADMIN tests/e2e/features/dashboard.spec.ts
proteum diagnose /dashboard --hit /dashboard --port 3101
proteum perf request /dashboard --port 3101
proteum trace latest --port 3101
```

When `proteum verify browser <path>` is available in the target app, it uses the same fresh per-run browser workspace model under `var/proteum/browser/<run-id>` and should be preferred over ad hoc shared Playwright profile reuse.

## Dev HTTP Endpoint

The CLI uses the same dev-only endpoint exposed by the running app:

- `POST /__proteum/session/start`

This endpoint exists only in dev mode and is not available in production.
