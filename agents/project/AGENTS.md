# Project Guide

This file adds project-local rules on top of the canonical Proteum app contract.

Framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

Coding style source of truth: `./CODING_STYLE.md`.

## Fast Start

- Start with `./.proteum/manifest.json`, `npx proteum explain`, and `npx proteum doctor`.
- For request-time issues in dev, inspect traces before adding logs.
- If a server is already running on the default port from `PORT` or `./.proteum/manifest.json`, inspect existing traces before reproducing the issue.
- If existing traces are insufficient, arm `npx proteum trace arm --capture deep`, reproduce once, then inspect the new request.

## Project Shape

This is a TypeScript, Node.js, Preact, Proteum monolith:

- `/client`: assets, catalogs, components, hooks, pages
- `/common`: shared functions, constants, types, and catalogs
- `/server`: catalogs, config, services, routes, lib
- `/tests`

## Local Deltas

- Keep one class or one React/Preact component per file.
- Prefer a deep tree grouped by business concern instead of long file names.
- Use the default `*.ts` or `*.tsx` file unless an `*.ssr.ts` or `*.ssr.tsx` variant is truly required.
- Never edit generated files under `./.proteum`.
- Use `@generated/client/*`, `@generated/common/*`, and `@generated/server/*` for generated surfaces.
- Client context is typically imported from `@/client/context`.
- Prefer type inference from the explicit application class in `./server/index.ts`.
- Reuse shared Shadcn-based UI primitives when the project already provides them.

## Dependency Selection

- Before implementing a feature or change, first check whether the repo already includes a suitable dependency.
- If not, search npm before building a new utility, abstraction, component primitive, parser, formatter, or integration from scratch.
- Prefer the most popular, flexible, maintained packages that fit the project constraints.
- Only reinvent the wheel when existing packages are clearly inadequate on bundle size, SSR behavior, performance, typing quality, flexibility, licensing, or maintenance risk.
- When you choose custom over a package, explain the reason briefly.

## Catalogs And Typing

- Keep one canonical catalog or registry file and import it everywhere else.
- Client-only catalogs live in `/client/catalogs/**`, server-only catalogs in `/server/catalogs/**`, and shared catalogs in `/common/catalogs/**`.
- Do not create nested `catalogs/` folders under pages, components, services, tests, or other feature folders.
- Keep strong TypeScript typings across the project.
- Do not introduce `any` or `unknown`, including through casts, helper aliases, or fallback generic defaults.
- Fix typing issues only on code you wrote.
- Never cast with `as any` or `as unknown`; fix the contract or add an explicit typed adapter.

## Workflow

- If the user pastes raw errors without asking for a fix, do not implement changes. List likely causes and, for each one, give probability, why, and how to fix it.
- For request-time behavior in dev, check whether a server is already running on the default port and prefer `npx proteum trace` before reproducing the issue or adding logs.
- End your work with `Commit message`: one short top-level sentence.

## High-Impact Files

Edit these only when required, and keep changes minimal and explicit:

- `tsconfig*.json`
- `PORT`, `ENV_*`, `URL`, and `TRACE_*` env setup
- Prisma-generated files
- symbolic links

## Commands Not To Run

- `git restore`
- `git reset`
- `prisma *`
- any write-mode git command

## Product And UX Docs

If the task changes UX, copy, onboarding, pricing, product semantics, or commercial positioning, read the relevant files under `./docs/` first, especially `docs/PERSONAS.md`, `docs/PRODUCT.md`, and `docs/MARKETING.md` when they exist.
