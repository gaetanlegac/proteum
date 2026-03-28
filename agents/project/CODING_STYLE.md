# Coding style

This file is the source of truth for codex coding style instructions in Proteum-based projects.

## Baseline

- **The code should be at the highest level of industry, as the product will be used by GAFAMs and will be maintained by a team of 10 developers.**
- Write clean, consistent, readable code with a tab size of 4.
- Keep functions and methods short.
- Every time possible, create reusable functions and components instead of repeating.
- Before finishing a feature or change, review touched files against this document and run the smallest relevant project lint or check command when available; coding-style regressions are defects, not optional cleanup.

## Formatting

- Optimize for human readability while keeping the code vertically compact when horizontal space is available.
- Preserve the high-level shape of function calls instead of exploding arguments too early.
- Keep short arrow functions and short returned object literals compact when they are easy to scan.
- Keep JSX multiline only when it is clearly more readable; otherwise keep short JSX compact.
- Avoid staircase formatting and unnecessary blank lines inside short callbacks.
- Keep `Router.page(...)` and `Router.error(...)` registrations in the compact inline-call shape when possible, for example `Router.page('/path', setup, render);`.

## File organization

- Always keep one class or React component per file.
- Prefer a deep tree structure that groups files by business concern instead of long file names.
- The default `*.ts` / `*.tsx` file is the browser implementation; use `*.ssr.ts` / `*.ssr.tsx` only for SSR-safe fallbacks.
- When implementing a feature that relies on a curated list of items, keep one canonical catalog or registry file and make all other code import it.

## Section comments and simple comments

- Organize files with explicit banner comments:

```typescript
/*----------------------------------
- SECTION NAME
----------------------------------*/
```

- Reuse project-native section names when possible, especially:
  - `DEPENDANCES`
  - `TYPES`
  - `HELPERS`
  - `CONSTANTS`
  - `COMPONENT`
  - `SERVICE`
  - `CONTROLEUR`
  - `ROUTES`
  - `PAGE`
  - `CONFIG`
  - `PUBLIC API`
  - `API`
  - `HOOKS`
  - `LAYOUT`
  - `CLASS`
  - `MODULE`
  - `STATE`
  - `CONTEXT`
  - `QUERIES`
  - `SCHEMA`
  - `SCHEMAS`
  - `ROUTING`
  - `RENDER`
  - `EXPORTS`
  - `UTILS`
  - `CONTENT`
  - `FILTERS`
  - `STATS`
  - `BUILDERS`
  - `CATALOG`
  - `CATALOG (SSOT)`
- File-specific section names are allowed when they improve navigation, for example `ROUTE: ...`, `COMPONENT: ...`, or `VIEW: ...`.
- Add short, useful comments that explain grouping, intent, lifecycle, or why a block exists.
- Do not add noisy comments that simply restate obvious code.
