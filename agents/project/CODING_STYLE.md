# Coding style

This file is the canonical coding-style contract for Proteum-based projects. It is loaded before editing any implementation file and re-checked before finishing. Keep workflow, verification, and architecture rules in `AGENTS.md`; keep only style, typing, formatting, and commenting rules here.

## Baseline

- Write code so the next reader — human or agent, with none of the current conversation's context — can recover every decision from the code and its comments.
- Write clean, consistent, readable code with a tab size of 4.
- Keep functions and methods short; extract a helper once a block needs its own explanation.
- Create reusable functions and components instead of repeating logic.
- Coding-style regressions are defects, not optional cleanup.

## Type safety

- Keep strong TypeScript typings; do not introduce `any` or `unknown`, including through casts, helper aliases, or fallback generic defaults.
- Never cast with `as any` or `as unknown`; fix the contract or add one explicit typed adapter at the boundary.
- Do not use `Reflect.get`, bracket access, broad `in` checks, or local loose reader helpers to bypass missing typings for app-owned data; fix the type contract or normalize once with a typed adapter at the boundary.
- Fix typing issues only on code you wrote.

## Formatting

- Optimize for human readability while keeping the code vertically compact when horizontal space is available.
- Preserve the high-level shape of function calls instead of exploding arguments too early.
- Keep short arrow functions and short returned object literals compact when they are easy to scan.
- Keep JSX multiline only when it is clearly more readable; otherwise keep short JSX compact.
- Avoid staircase formatting and unnecessary blank lines inside short callbacks.
- Keep route definition metadata compact when possible, for example `definePageRoute({ path: '/path', options: {}, data: null, render });`.

## File organization

- Always keep one class or React component per file.
- Prefer a deep tree structure that groups files by business concern instead of long file names.
- The default `*.ts` / `*.tsx` file is the browser implementation; use `*.ssr.ts` / `*.ssr.tsx` only for SSR-safe fallbacks.
- When implementing a feature that relies on a curated list of items, keep one canonical catalog or registry file and make all other code import it.

## Section comments

- Organize files with explicit banner comments:

```typescript
/*----------------------------------
- SECTION NAME
----------------------------------*/
```

- Reuse the section names already used in the touched file or area first. Common project-native names include `DEPENDANCES`, `TYPES`, `CONSTANTS`, `HELPERS`, `SERVICE`, `CONTROLEUR`, `COMPONENT`, `HOOKS`, `STATE`, `CONFIG`, `ROUTES`, `RENDER`, `PUBLIC API`, `EXPORTS`, and `CATALOG (SSOT)`.
- File-specific section names are allowed when they improve navigation, for example `ROUTE: ...`, `COMPONENT: ...`, or `VIEW: ...`.

## Decision and context comments

Comments are the project's in-place memory: they carry decisions and constraints to the next agent or developer, who will have none of the current context. The code says what; comments say why.

- Comment every non-obvious implementation choice at the decision site: why this approach, which constraint forced it, and which alternative was rejected and why when a real alternative was considered.
- When fixing a bug, comment the invariant that must not regress next to the fixed code, and reference the fix note under `docs/fixes/**` when one exists.
- A workaround must name what it works around (dependency and version, upstream issue, browser or runtime quirk) and the condition under which it can be removed.
- Comment magic values, ordering requirements, timing assumptions, and intentional deviations from this document where they occur.
- When refactoring, move existing why-comments with the code they explain; delete one only when its reason no longer exists.
- Do not add noisy comments that restate obvious code; a comment that paraphrases the next line is a defect.

```typescript
// Bad: restates the code, carries no decision
// increment the retry counter
retries++;

// Good: records the constraint and the decision
// Stripe webhooks can arrive out of order; process by event.created, not arrival time.
// Decision: sort in memory instead of queueing — volume stays under ~100 events/min.
// See docs/fixes/2026-06-02-stripe-replay.md.
```

## Self-check before finishing

Re-scan every touched file against this list before declaring the work done:

- No `any`, `unknown`, or casts introduced; contracts fixed at the boundary.
- New code sits under the right banner section, and section names still match their content.
- Every non-obvious decision, workaround, magic value, and bug fix has a why-comment at the site.
- No comments that restate code; no leftover debug logs or commented-out code.
- Repeated logic extracted; one class or component per file; catalogs stay canonical.
