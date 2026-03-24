# Frontend

This file adds client-side local rules on top of the canonical framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

## Stack

- TypeScript strict
- Preact with SSR
- follow the UI stack already used in the touched area
- many Proteum apps use Tailwind and `@/client/components/Motion`, but those are app conventions, not framework guarantees

## Local Client Rules

- Page files follow the page contract in `./pages/AGENTS.md`.
- Components and hooks access controllers through the app client context hook, usually `useContext()` from `@/client/context`.
- Prefer direct controller calls from context or page render args.
- Never depend on legacy `@app` imports on the client.
- Errors from controller calls should never be silently swallowed. Rethrow or surface them clearly.

## Design

- Follow the existing design language of the touched area.
- Keep layouts responsive and accessible.
- Add motion only when the area already uses it or when it materially improves UX.
- When the project already exposes shared Shadcn-based UI primitives, reuse them before creating custom primitives.

## Code Organization

- Do not add `React` imports just for JSX.
- Do not use `React.useCallback` unless it is necessary or already common in the touched area.
- Keep one component per file.
- Load data and define handlers in the directly concerned component when that keeps ownership clearer.
- Keep curated lists, option registries, and UI copy catalogs under `/client/catalogs/**`.
- Follow the section-comment format from the project-root `CODING_STYLE.md`.
