---
name: clean-project-code
description: Conservative codebase cleanup for existing projects. Use when Codex is asked to remove dead code, run Prettier, and align touched files with repository style rules without changing behavior or public APIs. Trigger for requests such as "clean this repo", "remove unused code", "format touched files", "apply CODING_STYLE.md", or "do a safe cleanup pass".
---

# Clean Project Code

Read the repository instructions first. Prefer `AGENTS.md`, the nearest relevant `CODING_STYLE.md`, and the active Prettier config before making changes.

Keep the cleanup conservative. Delete only code that is clearly unused and safe to remove. When safety is ambiguous, leave the code in place and report it as a cleanup candidate.

## Workflow

1. Read repo rules.
Locate and read `AGENTS.md`, `CODING_STYLE.md`, and `prettier.config.*` or `.prettierrc*` before editing. If the user names an exact path, use that file as the source of truth.

2. Define safe scope.
Do not change behavior or public APIs. Do not rewrite large areas only for style. Do not edit generated files unless you also update the source that generates them.

3. Identify provably safe cleanup targets.
Prefer removing:
- unused imports
- unused local variables and private helpers
- unused types and interfaces
- unreachable branches
- obsolete files that are provably unreferenced
- compatibility shims or dead helpers that have no live call sites

4. Prove before deleting.
Use fast search tools such as `rg` to verify references. Check exports, dynamic imports, generated references, route registration, configuration wiring, and framework conventions before deleting a file or symbol.

5. Keep uncertain cases.
If code looks unused but safety is not clear, keep it and report it separately. Favor false negatives over unsafe deletions.

6. Audit redundancy candidates across the project.
List catalogs, constants, and functions that look redundant and could be centralized, unified, or merged. Treat this as a reporting task by default unless the user explicitly asked for structural refactoring. Give each candidate an impact score from 1 to 5, where 5 is the highest expected payoff for maintainability, consistency, or simplification.

7. Apply style only on touched files.
Follow the repository coding style for files you change. Run Prettier with the repo config, preferably on touched files only unless the user explicitly asks for repo-wide formatting.

8. Verify.
Run the smallest relevant verification available after edits. Prefer project-native checks. If no suitable automated verification exists, say so explicitly.

## Deletion Rules

- Delete only when the code is clearly unused and the removal does not alter runtime behavior.
- Treat public exports, framework entrypoints, reflective loading, glob-based discovery, and generated references as high-risk unless you can prove they are inactive.
- Avoid opportunistic refactors. Keep the diff reviewable.
- If a cleanup requires structural redesign to become safe, stop at reporting the issue unless the user explicitly asked for refactoring.

## Final Report

Always report:
- what was removed
- what was intentionally left unchanged because it was uncertain
- which catalogs, constants, and functions appear redundant across the project, with a proposed centralization or merge direction and an impact score from 1 to 5
- what verification was run
- what could not be verified automatically

## Default Response Shape

When the user provides a cleanup brief, turn it into an execution checklist before editing:
- instructions read
- safe deletion targets identified
- risky candidates deferred
- redundancy candidates and impact scoring captured
- formatting scope confirmed
- verification plan chosen
