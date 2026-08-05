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

## Doc anchors

A why-comment explains one decision. A doc anchor connects the file to the durable documentation that governs it, so an agent that opens the file finds the feature pack, the decision record and the invariant without searching the corpus first.

Write anchors in a leading block comment:

```typescript
/**
 * @docs docs/features/search
 * @adr  ADR-0004
 * @fix  docs/fixes/2026-06-09-keyword-search-semantic-order.md
 * @rule Composite ordering stays alias-aware. Never rewrite ORDER BY with regex.
 */
```

- `@docs` points at the feature pack that owns the file. Required on every file that default-exports `definePageRoute`, `defineController`, `defineServerRoute`, or `defineServerRoutes`, and on every exported class extending a service base such as `Service` or `UsersManagementService`. Error routes are exempt: they render a status message and carry no feature-specific rule, so requiring a pack for one would manufacture documentation. Add an anchor to an error route only when it really does carry a rule.
- Components are not covered automatically. A presentational primitive such as `Icon.tsx` or `Card.tsx` owns no feature, so a blanket rule would manufacture documentation for hundreds of files. Cover the component directories that do own a feature by listing them in `includeDocAnchors` when building the ESLint config, for example `['client/components/paywall/**']`.
- Infrastructure is exempt the same way error routes are. A transport helper, a metrics router or a rate limiter owns no feature contract, so list those paths in `excludeDocAnchors` rather than pointing them at a pack that does not describe them. An excluded file may still declare anchors, and `valid-doc-anchor` keeps checking any it declares.
- A feature pack that no code will ever point at, such as a retirement record or a document describing audiences rather than modules, opts out of the orphan report by carrying a `RETIRED` note or a `code-owned: false` line in its README. Without that, the pack is reported as orphaned forever and the backlog stops being actionable.
- `@adr` and `@fix` point at the decision record and fix note that constrain the file. Add them where the decision or the bug actually lives, not on every file in the area.
- `@rule` states the invariant inline, in full. It is the one anchor that carries content rather than a pointer, because the rule is what an agent needs at the moment of editing. A `@rule` that only says `todo` or repeats the linked title is a defect.
- Anchors are not a substitute for the documents. Narrative, alternatives, benchmarks and acceptance stay under `docs/**`; the anchor carries the pointer and the single-sentence rule.

Two ESLint rules enforce this. `proteum/require-doc-anchor` reports definition files with no `@docs`, and warns by default so an adopting project sees its backlog without a failing build; pass `docAnchors: 'error'` to `createProteumEslintConfig` once the backfill is done. `proteum/valid-doc-anchor` always errors, because an anchor pointing at a deleted document is worse than no anchor.

The read-only MCP owner payloads return these anchors alongside `explain_summary`, `orient`, `route_candidates`, `diagnose`, and `workflow_start`, so the documentation reaches the agent in the same response that identifies the owner.

`proteum docs check` verifies the whole corpus in both directions: it fails on an anchor that no longer resolves, and reports as a backlog every fix note carrying an `Agent warning` that no code anchors, plus every feature pack nothing points at. `proteum verify changed` selects it automatically whenever `docs/**` or a source file changes, so a renamed document cannot silently orphan an anchor.

## Self-check before finishing

Re-scan every touched file against this list before declaring the work done:

- No `any`, `unknown`, or casts introduced; contracts fixed at the boundary.
- New code sits under the right banner section, and section names still match their content.
- Every non-obvious decision, workaround, magic value, and bug fix has a why-comment at the site.
- Every touched definition file carries a `@docs` anchor, and any fix or decision applied in this pass left a `@rule` anchor at the code site it constrains.
- No comments that restate code; no leftover debug logs or commented-out code.
- Repeated logic extracted; one class or component per file; catalogs stay canonical.
