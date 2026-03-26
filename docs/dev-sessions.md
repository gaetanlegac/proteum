# Dev Sessions

Proteum ships a dev-only auth bootstrap command so agents, Playwright runs, and local debugging can start from an authenticated state without driving the login UI.

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

Behavior:

- local mode refreshes generated artifacts, builds the dev output, starts a temporary local dev server, creates the session, prints the payload, and exits
- remote mode talks to an already running `proteum dev` instance
- the command requires an explicit email and optionally asserts a role before returning the session
- the command is available only in dev mode

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
- Use UI login automation only when the auth UX itself is the feature under test.
- Pair it with `proteum trace` for protected request debugging.

Typical flow:

```bash
proteum trace arm --capture deep --port 3101
proteum session admin@example.com --role ADMIN --port 3101 --json > session.json
# add the returned cookie in Playwright, then load the protected page once
proteum trace latest --port 3101
```

## Dev HTTP Endpoint

The CLI uses the same dev-only endpoint exposed by the running app:

- `POST /__proteum/session/start`

This endpoint exists only in dev mode and is not available in production.
