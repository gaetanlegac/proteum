# Architecture

This is a full stack monolith project using Typescript, NodeJS, Preact, and Proteum.

`/client`: frontend
    `/assets`: CSS, images and other frontend assets
    `/catalogs`: client-only catalogs and registries
    `/components`: reusable components
    `/pages`: page route files and page-local UI
    `/hooks`
`/common`: shared functions, constants, typings, and cross-runtime catalogs
`/server`: backend
    `/catalogs`: server-only catalogs and registries
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

Start framework inspection with:

- `./.proteum/manifest.json`
- `npx proteum explain`
- `npx proteum doctor`

For runtime-only issues in dev, inspect the request trace before adding temporary logs:

- `npx proteum trace requests`
- `npx proteum trace latest`
- `npx proteum trace arm --capture deep`

Generated files live under `./.proteum` and should not be edited by hand.
Project code should use the generated aliases `@generated/client/*`, `@generated/common/*`, and `@generated/server/*`.
Client context is typically imported from `@/client/context`.
Prefer type inference from the explicit application class in `./server/index.ts` whenever possible. Treat it as the
canonical type root for app services, router services, router context, and models instead of duplicating manual type
declarations.

# Files organization

- Always keep one class / React component per file
- Prefer a deep tree structure that groups files by business concern instead of long file names
- The default `*.ts` / `*.tsx` file is the normal implementation; use `*.ssr.ts` / `*.ssr.tsx` only when the project
needs an SSR-specific variant

## Centralize feature catalogs (Single Source of Truth)

When implementing a feature that relies on a **curated list of items**, keep **one canonical catalog/registry file** and make all other code import it.

- Client-only catalogs live in `/client/catalogs/**`
- Server-only catalogs live in `/server/catalogs/**`
- Shared catalogs used by both runtimes live in `/common/catalogs/**`
- Organize those root catalog trees by business concern (mirror the feature path when useful)
- Do not create nested `catalogs/` folders inside `/client/pages/**`, `/client/components/**`, `/server/services/**`, or similar feature folders

## Runtime access rules

- `@models/types`: Prisma typings only. Can be imported anywhere.
- Never use runtime value imports from `@request` or `@models`.
- Never expose request-scoped state through imports.
- Keep app services, router services, router context, and model contracts inferred from `./server/index.ts` whenever
possible instead of recreating parallel type maps.

## Client runtime access

- Page route files use `Router.page(...)`.
- `Router.page(path, render)` for pages without SSR setup.
- `Router.page(path, setup, render)` for pages with SSR config/data.
- `setup` receives the normal page context plus the generated controller tree spread into it.
- `render` receives the normal page context plus the resolved setup data and the same controller tree spread into it.
- Components and hooks use the app client context hook, usually imported from `@/client/context`.
- For UI primitives, prefer the project's shared Shadcn-based components whenever they already exist and fit the need before creating bespoke buttons, inputs, dialogs, or similar building blocks.

## Server runtime access

- Normal business logic lives in `/server/services/**/index.ts` classes that extend `Service`.
- Route entrypoints live in `/server/controllers/**/*.ts` classes that extend `Controller`.
- Only controller files are indexed as callable API endpoints.
- Controller methods validate input with `this.input(schema)` and access request scope through `this.request`.
- Service classes access other services via `this.services` and prisma models via `this.models`.
- App service types should be inferred from the explicit application graph rooted at `./server/index.ts`.
- Router services and request/context values such as `user`, `auth`, and similar request-scoped contracts should come
from inferred request and app types, not ad hoc casts.
- Models should be inferred from the app/model registry rooted at `./server/index.ts` and exposed through the generated
server app shim, not from duplicated manual model maps.
- Never use request-scoped state directly inside normal service methods.
- Controllers should resolve auth and request-derived values, then pass plain typed arguments into services.
- When referencing an app service, a router service, or a model, expose it in the current block scope first by
destructuring from `this.request`, `this.app`, `this.models`, or the generated app/model accessors where applicable,
then call methods on that local binding. The service, router value, or model should be the first element of the callee
chain.

# Agent behavior

**Make sure the code you generate integrates perfectly with the current codebase by avoiding repetition and centralizing each purpose.**

## Typings

- Keep strong, consistent TypeScript typings across the whole project.
- Do not introduce `any` or `unknown`, including through casts, helper aliases, or fallback generic defaults.
- Fix typing issues only on the code you wrote.
- Never cast with `as any` or `as unknown`; fix the type contract or introduce an explicit typed adapter instead. If you find no other solution, tell me in the output.

## Workflow

- Every time I input error messages without any instructions, don't implement fixes.
Instead, investigate the potential causes of the errors, and for each:
    1. Evaluate / quantify the probabilities
    2. Give why and
    3. Suggest how to fix it
- When the issue is request-time behavior in dev, prefer `npx proteum trace` over ad hoc logging. Treat traces as dev-only, redacted, and memory-bounded.
- When you have finished your work, summarize in one top-level short sentence the changes you made since the beginning of the conversation. Output as "Commit message".

## High-impact files

- Do not edit generated files under `.proteum` by hand.
- Treat `tsconfig*.json`, `env*.yaml`, Prisma-generated files, and symbolic links as high-impact.
- Edit them only when the task actually requires it, and keep those changes minimal and explicit.

If a high-impact file change is not required for the task, leave it alone.

## Don't run any of these commands

```
git restore
git reset
prisma *
And any git command in the write mode.
```

# Copy and UX

Before making UX/copy decisions, read `docs/PERSONAS.md`, `docs/PRODUCT.md`, `docs/MARKETING.md`.
When implementing UI, prefer existing Shadcn components or local wrappers around them whenever they can satisfy the requirement cleanly.
