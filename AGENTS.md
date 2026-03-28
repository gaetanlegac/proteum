# Proteum Core

This file governs work in the Proteum framework repository itself. For downstream app rules, use `agents/project/AGENTS.md`.
Role: keep only framework-repo instructions here.
Keep here: core-repo priorities, framework change workflow, reference-app validation, and framework-specific constraints.
Do not put here: downstream app implementation contracts, area-specific app rules, or repeated content that belongs in `agents/project/**`.
Downstream app optimization source of truth: `agents/project/optimizations.md`.
Downstream app diagnostics source of truth: `agents/project/diagnostics.md`.
Downstream app coding style source of truth: `agents/project/CODING_STYLE.md`.

## Priorities

Optimization priorities and rules live in `agents/project/optimizations.md`.
After those optimization concerns, preserve explicit, typed, machine-readable contracts for agents.

## Core Rules

- Prefer explicit typed contracts over runtime magic or hidden conventions.
- Keep `server/index.ts` as the canonical type root for services, router context, request context, and models.
- Keep generated code deterministic, auditable, and easy to map back to source.
- Prefer typed traces and manifest-backed diagnostics over ad hoc logging.
- Follow `agents/project/optimizations.md` when choosing packages, helpers, runtimes, plugins, or build infrastructure.
- Delete obsolete compatibility layers, helper indirection, and unused packages when safe.

## Workflow

- If the user pastes raw errors without asking for a fix, do not implement changes. List likely causes and, for each one, give probability, why, and how to fix it.
- When you have finished your work, summarize in one top-level short sentence the changes you made since the beginning of the conversation. Output as "Commit message".

## Core Changes

- Validate framework changes against both reference apps:
  - `/Users/gaetan/Desktop/Projets/crosspath/platform`
  - `/Users/gaetan/Desktop/Projets/unique.domains/website`
- Inspect how both apps currently use the touched feature, runtime, API, compiler behavior, or generated output before proposing or implementing changes.
- Keep core changes aligned with the explicit controller/page architecture in `agents/project/AGENTS.md`.
- Prefer removing framework magic when the same result can be expressed with explicit contracts, generated code, or typed context.
- Apply the pruning rules from `agents/project/optimizations.md`, especially for webpack plugins, Babel plugins, aliases, helpers, runtime services, and npm packages that are not meaningfully used by both apps.
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
