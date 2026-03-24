# Server Services

This file adds service-area local rules on top of the canonical framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

## Placement

- Root business services live in `/server/services/<Feature>/index.ts`.
- Root-service metadata lives in `/server/services/<Feature>/service.json`.
- Root-service config lives in `/server/config/*.ts` when the service needs config.
- Companion client-callable entrypoints live in `/server/controllers/**`.

## Local Service Rules

- Keep business logic in services and keep request/auth/input handling in controllers.
- If a feature grows several coherent domains, split it into explicit subservices.
- Server-only catalogs live in `/server/catalogs/**`.
- Shared cross-runtime catalogs live in `/common/catalogs/**`.
- Do not create nested `catalogs/` folders under `/server/services/**`.

## Models And Typing

- Use runtime models through `this.models` or the app model accessors.
- Use Prisma typings through `@models/types` only.
- In database queries, prefer explicit `select` or narrow `include`.
- Prefer inferred return types such as `Awaited<ReturnType<MyService['methodName']>>` over manual DTO duplication.

## Errors

- Never silence caught errors.
- If you need to wrap a failure, preserve enough detail and the original error.
