# Architecture

This is a full stack monolith project using Typescript, NodeJS, Preact, and Proteum.

`/client`: frontend
    `/assets`: CSS, images and other frontend assets
    `/components`: reusable components
    `/pages`: page route files and page-local UI
    `/hooks`
`/common`: shared functions, constants and typings
`/server`: backend
    `/config`: service configuration
    `/services`: backend services and controllers
    `/routes`: explicit non-controller routes
    `/lib`: helper functions
`/tests`

# Coding style

See `CODING_STYLE.md`.
This file is the source of truth for formatting, section-comment structure, and general coding style.

# Framework contract

For Proteum-wide project scaffolding, routing, SSR, controller, service, generated-code, and maintenance rules, use the
framework guide in the Proteum repository at `agents/framework/AGENTS.md`.
From a normal Proteum project install, read it at `./node_modules/proteum/agents/framework/AGENTS.md`.

# Files organization

- Always keep one class / react component per file
- Prefer a deep tree structure that groups files by business concern instead of long file names
- The default `*.ts` / `*.tsx` file is the browser implementation; use `*.ssr.ts` / `*.ssr.tsx` only for SSR-safe fallbacks

## Centralize feature catalogs (Single Source of Truth)

When implementing a feature that relies on a **curated list of items**, keep **one canonical catalog/registry file** and make all other code import it.

## Runtime access rules

- `@models/types`: Prisma typings only. Can be imported anywhere.
- Never use runtime value imports from `@request` or `@models`.
- Never expose request-scoped state through imports.

## Client runtime access

- Page route files use `Router.page(...)`.
- `Router.page(path, render)` for pages without SSR setup.
- `Router.page(path, setup, render)` for pages with SSR config/data.
- `setup` receives the normal page context plus the generated controller tree spread into it.
- `render` receives the normal page context plus the resolved setup data and the same controller tree spread into it.
- Components and hooks use `useContext()` to access controller instances and client runtime services.

## Server runtime access

- Normal business logic lives in `/server/services/**/index.ts` classes that extend `Service`.
- Route entrypoints live in `*.controller.ts` classes that extend `Controller`.
- Only controller files are indexed as callable API endpoints.
- Controller methods validate input with `this.input(schema)` and access request scope through `this.request`.
- Service classes access other services via `this.services` and prisma models via `this.models`.
- Never use request-scoped state directly inside normal service methods.

# Agent behavior

**Make sure the code you generate integrates perfectly with the current codebase by avoiding repetition and centralizing each purpose.**

## Typings

- Fix typing issues only on the code you wrote.
- Never cast with `as any` or `as unknown`; fix the type contract or introduce an explicit typed adapter instead. If you find no other solution, tell me in the output.

## Workflow

- Everytime I input error messages without any instructions, don't implement fixes.
Instead, ivestigate the potential causes of the errors, and for each:
    1. Evaluate / quantify the probabiliies
    2. Give why and
    3. Suggest how to fix it
- When you have finished your work, summarize in one top-level short sentence the changes you made since the beginning of the conversation. Output as "Commit message".

## Never edit the following files

- Prisma files (except schema.prisma)
- tsconfigs
- env
- Any file / folder that is a symbolic link

If you need to edit them, just suggest it in the chat.

## Don't run any of these commands

```
git restore
git reset
prisma *
And any git command in the write mode.
```

# Copy and UX

Before making UX/copy decisions, read `docs/PERSONAS.md`, `docs/PRODUCT.md`, `docs/MARKETING.md`.
