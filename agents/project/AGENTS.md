# Project Guide

This file only adds project-local rules on top of the canonical Proteum app contract.

Framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

Coding style source of truth:

- `./CODING_STYLE.md`

## Fast Start

Start project inspection with:

- `./.proteum/manifest.json`
- `npx proteum explain`
- `npx proteum doctor`

For request-time issues in dev, inspect traces before adding temporary logs:

- `npx proteum trace requests`
- `npx proteum trace latest`
- `npx proteum trace arm --capture deep`

## Project Structure

This is a full-stack monolith project using TypeScript, Node.js, Preact, and Proteum.

- `/client`
  - `/assets`: CSS, images, and other frontend assets
  - `/catalogs`: client-only catalogs and registries
  - `/components`: reusable components
  - `/pages`: page route files and page-local UI
  - `/hooks`
- `/common`: shared functions, constants, typings, and cross-runtime catalogs
- `/server`
  - `/catalogs`: server-only catalogs and registries
  - `/config`: service configuration
  - `/services`: backend services
  - `/routes`: explicit non-controller routes
  - `/lib`: helper functions
- `/tests`

## Local Deltas

- Always keep one class or one React/Preact component per file.
- Prefer a deep tree structure grouped by business concern instead of long file names.
- The default `*.ts` or `*.tsx` file is the normal implementation. Use `*.ssr.ts` or `*.ssr.tsx` only when an SSR-specific variant is actually required.
- Generated files live under `./.proteum` and should never be edited by hand.
- Project code should use `@generated/client/*`, `@generated/common/*`, and `@generated/server/*` for generated surfaces.
- Client context is typically imported from `@/client/context`.
- Prefer type inference from the explicit application class in `./server/index.ts`.
- If the project already exposes shared Shadcn-based UI primitives, reuse them before creating bespoke primitives.

## Catalog Single Source Of Truth

When a feature depends on a curated list, keep one canonical catalog or registry file and import it everywhere else.

- client-only catalogs live in `/client/catalogs/**`
- server-only catalogs live in `/server/catalogs/**`
- shared catalogs live in `/common/catalogs/**`
- do not create nested `catalogs/` folders under pages, components, services, tests, or other feature folders

## Typings

- Keep strong, consistent TypeScript typings across the whole project.
- Do not introduce `any` or `unknown`, including through casts, helper aliases, or fallback generic defaults.
- Fix typing issues only on the code you wrote.
- Never cast with `as any` or `as unknown`. Fix the contract or introduce an explicit typed adapter instead.

## Workflow

- Every time I input error messages without any instructions, do not implement fixes. Instead, investigate the potential causes and, for each one:
  1. evaluate or quantify the probability
  2. explain why
  3. suggest how to fix it
- When the issue is request-time behavior in dev, prefer `npx proteum trace` over ad hoc logging.
- When you have finished your work, summarize in one top-level short sentence the changes you made since the beginning of the conversation. Output as `Commit message`.

## High-Impact Files

- `tsconfig*.json`
- `env*.yaml`
- Prisma-generated files
- symbolic links

Edit those files only when the task actually requires it, and keep the change minimal and explicit.

## Commands Not To Run

Do not run:

- `git restore`
- `git reset`
- `prisma *`
- any write-mode git command

## Product And UX Docs

If the task changes UX, copy, onboarding, pricing, product semantics, or commercial positioning, read the relevant files under `./docs/` first.

Prefer these when they exist:

- `docs/PERSONAS.md`
- `docs/PRODUCT.md`
- `docs/MARKETING.md`
