# Proteum Core

This file governs work in the Proteum framework repository itself. For downstream app rules, use `agents/framework/AGENTS.md`.

## Priorities

When tradeoffs exist, optimize in this order:

1. Reduce shipped client bundle size and unnecessary runtime code.
2. Improve build-time, server-time, and browser-time performance.
3. Improve SEO output and crawlable, semantic HTML.
4. Preserve explicit, typed, machine-readable contracts for agents.

## Core Rules

- Prefer explicit typed contracts over runtime magic or hidden conventions.
- Keep `server/index.ts` as the canonical type root for services, router context, request context, and models.
- Keep generated code deterministic, auditable, and easy to map back to source.
- Prefer typed traces and manifest-backed diagnostics over ad hoc logging.
- Check existing repo dependencies and npm before inventing a new helper, runtime, plugin, or abstraction.
- Prefer established, flexible, well-typed packages; build custom only when packages fail on bundle size, performance, SSR behavior, typing, flexibility, or maintenance risk.
- Delete obsolete compatibility layers, helper indirection, and unused packages when safe.

## Workflow

- If the user pastes raw errors without asking for a fix, do not implement changes. List likely causes and, for each one, give probability, why, and how to fix it.
- End your work with `Commit message`: one short top-level sentence, max 90 characters.

## Core Changes

- Validate framework changes against both reference apps:
  - `/Users/gaetan/Desktop/Projets/crosspath/platform`
  - `/Users/gaetan/Desktop/Projets/unique.domains/website`
- Inspect how both apps currently use the touched feature, runtime, API, compiler behavior, or generated output before proposing or implementing changes.
- Keep core changes aligned with the explicit controller/page architecture in `agents/framework/AGENTS.md`.
- Prefer removing framework magic when the same result can be expressed with explicit contracts, generated code, or typed context.
- Challenge any webpack plugin, Babel plugin, alias, helper, runtime service, or npm package that is not meaningfully used by both apps.
- Remove dead docs, flags, helper files, and compatibility branches in the same pass when safe.

## Proposals

- Start from the concrete mismatch or risk visible in the reference apps.
- Name the npm packages or package categories evaluated first when adding capability or infrastructure.
- Show the target API with real Proteum-style client and server usage.
- Separate the ideal end state from any migration rule.
- Name the source files that drive generated artifacts when generation changes.
- Explicitly name removed behavior and why it is obsolete.

## Runtime Validation

Do not stop at static analysis for routing, controllers, generated code, SSR, client runtime, services, webpack, Babel, or emitted assets.

- Run `npx proteum dev --no-cache --port 3xxx` in both reference apps on explicit ports.
- For protected browser or API flows in dev, prefer `npx proteum session <email> --role <role>` to mint a dev auth cookie instead of automating the login UI. Use the login UI only when login itself is the feature under test.
- For request-time behavior, arm traces with `proteum trace arm --capture deep`, reproduce once, then inspect `proteum trace latest` or `proteum trace show <requestId>`.
- Open the real pages with Playwright.
- Inspect browser console errors and warnings.
- Inspect server startup and runtime errors.

Build-only checks are supplementary. Iterate until both apps boot and show no new framework regressions, and call unrelated environment warnings out separately.
