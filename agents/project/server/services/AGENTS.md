# Service Contract

This is the canonical service-area contract for Proteum-based projects.
Role: keep only service-layer rules here.
Keep here: service placement, service responsibilities, model access, query-shaping, return-type guidance, and service error-handling rules.
Do not put here: request parsing, page/render rules, controller transport details, or broad project workflow already defined in higher-level AGENTS files.

Optimization source of truth: root-level `optimizations.md`.
Diagnostics source of truth: root-level `diagnostics.md`.

## Placement

- Root business services live in `/server/services/<Feature>/index.ts`.
- Root-service config lives in `/server/config/*.ts` when the service needs config.
- Companion client-callable entrypoints live in `/server/controllers/**`.

## Service Rules

- Business logic belongs in classes that extend `Service` and use `this.services`, `this.models`, and `this.app`.
- Keep business logic in services and keep request/auth/input handling in controllers.
- Normal service methods should not read request-scoped state directly.
- If a feature grows several coherent domains, split it into explicit subservices.
- Server-only catalogs live in `/server/catalogs/**`.
- Shared cross-runtime catalogs live in `/common/catalogs/**`.
- Do not create nested `catalogs/` folders under `/server/services/**`.

## Models And Typing

- Use runtime models through `this.models` or the app model accessors.
- Use Prisma typings through `@models/types` only.
- In database queries, prefer explicit `select` or narrow `include`.
- For database structure changes, edit the app's `schema.prisma` only. Never create or edit migration files manually.
- Never use raw SQL DDL or other schema-mutating SQL to change database structure.
- Prefer inferred return types such as `Awaited<ReturnType<MyService['methodName']>>` over manual DTO duplication.

## Errors

- Never silence caught errors.
- If you need to wrap a failure, preserve enough detail and the original error.
