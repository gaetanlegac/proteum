# Frontend Contract

This is the canonical client-area contract for Proteum-based projects.
Role: keep only client-area rules here.
Keep here: client component, hook, design-system, accessibility, and client-context usage rules that apply beyond a single page.
Do not put here: page `data` and route-registration details, server/service rules, or generic project workflow already covered by broader ancestor `AGENTS.md` files.

Optimization source of truth: root-level `optimizations.md`.
Diagnostics source of truth: root-level `diagnostics.md`.
Coding style source of truth: root-level `CODING_STYLE.md`.

## Stack

- TypeScript strict
- Preact with SSR
- Follow the UI stack already used in the touched area.
- Many Proteum apps use Tailwind and `@/client/components/Motion`, but those are app conventions, not framework guarantees.

## Client Rules

- Page files follow the page contract in `./pages/AGENTS.md`.
- Components and hooks should reach server APIs through generated controller calls from page render args or the app client context, usually `useContext()` from `@/client/context`.
- Prefer direct controller calls from context or page render args.
- Prefer generated app surfaces over direct `.proteum` implementation imports.
- Never depend on legacy `@app` imports on the client.
- Errors from controller calls should never be silently swallowed. Rethrow or surface them clearly.
- Caught frontend errors must always preserve the original failure. Never write `catch {}`, `.catch(() => ...)`, or a catch handler that only shows a generic toast/state without using the caught error.
- Valid terminal frontend error handling is `throw error`, `useContext().app.handleError(error)`, or `context.app.handleError(error)`.
- Do not normalize caught values in app code before calling `handleError`; the app handles `unknown` values and returns a displayable message.
- If the app customizes `handleError`, keep the signature `handleError(error: unknown, fallbackMessage?: string): string`.
- Toasts and form errors are local feedback only; use `setError(context.app.handleError(error, fallbackMessage))` or rethrow the caught error.
- `console.*(error)` is not error handling and must not be the last stop for a caught error.

## Design

- Follow the existing design language of the touched area.
- Keep layouts responsive and accessible.
- Add motion only when the area already uses it or when it materially improves UX.
- When the project already exposes shared Shadcn-based UI primitives, reuse them before creating custom primitives.

## Code Organization

- Do not add `React` imports just for JSX.
- Do not use `React.useCallback` unless it is necessary or already common in the touched area.
- Load data and define handlers in the directly concerned component when that keeps ownership clearer.
- Keep curated lists, option registries, and UI copy catalogs under `/client/catalogs/**`.
- Follow the section-comment format from the root-level `CODING_STYLE.md`.
