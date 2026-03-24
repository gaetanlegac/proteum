# Proteum Core

This file governs work in the Proteum framework repository itself.

For the canonical Proteum app contract used by downstream projects, use `agents/framework/AGENTS.md`.

## Vision

Proteum aims to become the first SSR / SEO / TypeScript framework built primarily for non-human developers and AI agents.

When tradeoffs exist, prioritize framework decisions in this order:

1. Reduce shipped client bundle size and unnecessary runtime code.
2. Increase build-time, server-time, and browser-time performance.
3. Improve SEO output and LLM-friendly, crawlable, semantic HTML.
4. Preserve explicit, typed, machine-readable contracts for agents.

When working on Proteum itself:

- prefer explicit, typed, machine-readable contracts over runtime magic or hidden conventions
- keep `server/index.ts` as the canonical type root for app services, router services, request context, and models
- keep generated code deterministic, auditable, and easy to map back to source files
- prefer typed request traces and manifest-backed diagnostics over ad hoc runtime logging
- prefer deleting obsolete compatibility layers, helper indirection, and unused packages over preserving dead paths

## Workflow

- Every time I input error messages without any instructions, do not implement fixes. Instead, investigate the potential causes and, for each one:
  1. evaluate or quantify the probability
  2. explain why
  3. suggest how to fix it
- When you have finished your work, summarize in one top-level short sentence all the changes you made since the beginning of the conversation. Output as `Commit message`. Max 90 characters.

## Framework Change Rules

When changing Proteum itself:

- validate the change against these two reference apps:
  - `/Users/gaetan/Desktop/Projets/crosspath/platform`
  - `/Users/gaetan/Desktop/Projets/unique.domains/website`
- inspect how both apps currently use the feature, runtime, API, compiler behavior, or generated files before proposing or implementing a core change
- prefer removing framework magic when the same result can be expressed with explicit runtime contracts, generated code, or typed context
- if a webpack plugin, Babel plugin, alias, helper, runtime service, or npm package is not meaningfully used by both apps, challenge its existence
- keep core changes aligned with the explicit controller/page architecture described in `agents/framework/AGENTS.md`
- remove related dead docs, config flags, helper files, and compatibility branches in the same pass when safe

## Proposal Rules

When proposing a core change:

- start from the concrete mismatch or risk seen in the reference apps
- show the target API with real client and server usage examples that match current Proteum conventions
- distinguish the ideal end-state API from any transitional migration rule
- explain which source files drive generated artifacts when generation changes
- explicitly name removed behavior and why it is obsolete

## Validation

Do not stop at static analysis when the change affects runtime behavior.

If a change touches routing, controllers, generated code, SSR, client runtime, services, webpack, Babel, or emitted assets:

- run `npx proteum dev --no-cache --port 3xxx` in both reference apps on explicit ports
- use `proteum trace arm --capture deep`, reproduce the request once, then inspect `proteum trace latest` or `proteum trace show <requestId>` when the issue is request-time behavior
- open the real pages with Playwright
- inspect browser console errors and warnings
- inspect server startup and runtime errors

Build-only checks are supplements, not final proof.

Keep iterating until both apps boot and the browser console shows no new framework regressions. Treat unrelated environment warnings separately and call them out clearly.
