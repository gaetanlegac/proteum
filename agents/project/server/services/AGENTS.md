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
- For read-only SQL diagnosis, use MCP `db_query` or `npx proteum db query "<sql>"`; only one capped `SELECT`, `SHOW`, or `EXPLAIN` statement is allowed.
- Prefer inferred return types such as `Awaited<ReturnType<MyService['methodName']>>` over manual DTO duplication.

## Errors

- Never silence caught errors.
- If you need to wrap a failure, preserve enough detail and the original error.
- Prefer `throw error` when the current request or job should fail.
- For catch-and-continue server work, detached promises, custom Express responses, or background jobs, call `await this.app.reportError(error, request)` when a request is available, or `await this.app.reportError(error)` without one.
- Do not call `app.runHook('error', ...)` directly from app code; route caught errors through `app.reportError(...)` so HTTP-specific error hooks stay centralized.
- `console.*(error)` is not error handling and must not be the last stop for a caught error.
