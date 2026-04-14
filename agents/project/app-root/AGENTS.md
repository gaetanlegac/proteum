# Proteum App-Root Addendum

This file is the app-root-only addendum for a Proteum app that lives inside a larger monorepo.
Keep the reusable Proteum contract in the nearest ancestor root `AGENTS.md`, and keep this file only for instructions that depend on the current directory being the Proteum app root.
Role: keep only app-root workflow and local project-semantic rules here.
Do not put here: reusable Proteum architecture contracts, shared verification rules, diagnostics workflow, optimization checklists, coding-style details, or area-specific rules already covered by broader `AGENTS.md` files or the root-level `diagnostics.md`, `optimizations.md`, and `CODING_STYLE.md`.

## App-Root Triggers

- If you are working in a newly created Proteum worktree, before following the rest of these instructions:
  - Copy `.env` from the main worktree.
  - Run `npx proteum refresh`.
  - Read and acknowledge the applicable `AGENTS.md` files.
  - Run `npm i`.
  - Run the dev server with the task-safe elevated-permissions launch workflow from the reusable root `AGENTS.md`, keep it running so user can see the results by himself, and print the live server URL as a clickable Markdown link. If the bare interactive `proteum dev` start offers to launch `proteum configure agents`, finish that wizard before continuing.
- If the task changes UX, copy, onboarding, pricing, product semantics, or commercial positioning, read the relevant files under `./docs/` first, especially `docs/PERSONAS.md`, `docs/PRODUCT.md`, and `docs/MARKETING.md` when they exist. If a dev server is already running, print the live dev server URL as a clickable Markdown link.
