# Documentation-Driven Coding Instructions

## Purpose

This repository uses `/docs` as an operational memory system for coding agents.

Do not treat `/docs` as a generic wiki.

Treat `/docs` as the source of truth for:

- product intent
- user expectations
- business rules
- feature behavior
- acceptance criteria
- architecture boundaries
- auth and permission rules
- implementation status
- past fixes
- performance benchmarks
- testing expectations
- release and rollback requirements

Your job is to read the smallest relevant documentation set before coding, implement according to that source of truth, and update the relevant docs after the change.

---

# 1. Core operating rule

Before changing code, identify the task type.

Then read only the relevant documentation pack.

Do not read every file in `/docs` unless the task explicitly requires broad review.

Do not code from assumptions when a source-of-truth document exists.

Do not duplicate rules across documents. Link to the source of truth when needed.

---

# 2. Always read these first

For every non-trivial task, start with:

```txt
docs/00-start-here.md
docs/02-reading-rules.md
docs/implementation/05-definition-of-done.md
```

Then read the specific docs for the affected feature, architecture area, fix history, or operation.

If these files do not exist, create them only when the task requires them or when missing documentation blocks implementation.

---

# 3. Task-based reading rules

## New feature

Before implementing a new feature, read:

```txt
docs/00-start-here.md
docs/product/user-expectations.md
docs/implementation/05-definition-of-done.md
docs/implementation/02-feature-backlog.md
docs/features/<feature>/README.md
docs/features/<feature>/scenarios.feature
docs/features/<feature>/acceptance.md
docs/features/<feature>/api-contract.md       if API behavior changes
docs/features/<feature>/data-contract.md      if data changes
docs/features/<feature>/ui-contract.md        if UI changes
docs/features/<feature>/permissions.md        if access rules change
docs/features/<feature>/performance.md        if performance-sensitive
docs/architecture/boundaries.md
related docs/fixes/
```

After implementation, update:

```txt
docs/implementation/02-feature-backlog.md
docs/features/<feature>/acceptance.md
docs/testing/regression-tests.md              if a regression test was added
docs/decisions/                               if a major decision changed
docs/fixes/                                   if a bug or regression was fixed
```

---

## Bug fix

Before fixing a bug, read:

```txt
docs/00-start-here.md
affected feature docs
docs/fixes/ related to the affected area
docs/testing/regression-tests.md
docs/architecture/<affected-area>.md
```

After fixing the bug, update:

```txt
docs/fixes/YYYY-MM-DD-short-bug-name.md
docs/testing/regression-tests.md
affected feature edge-cases.md if a new edge case was discovered
```

A bug fix is incomplete if:

```txt
the root cause is not documented
the implemented solution is not documented
the regression test is not linked
future agents cannot tell what pattern must not return
```

---

## Performance issue

Before fixing a performance issue, read:

```txt
docs/architecture/performance.md
docs/testing/performance-tests.md
affected feature performance.md
related docs/fixes/*performance*
docs/architecture/observability.md
```

Before coding, capture a baseline benchmark.

Document:

```txt
environment
dataset
benchmark command
commit before
p50 / p95 / p99 where possible
query count where relevant
bundle size where relevant
queue latency where relevant
memory where relevant
```

After fixing performance, update:

```txt
docs/fixes/YYYY-MM-DD-performance-name.md
docs/testing/performance-tests.md
affected feature performance.md
docs/architecture/performance.md if global budgets changed
```

A performance fix is incomplete without:

```txt
benchmark before
benchmark after
dataset
environment
command
solution implemented
trade-offs
regression threshold
benchmark or test path
```

---

## Auth, scopes, roles, tenancy, or permissions

Before changing auth or permissions, read:

```txt
docs/implementation/03-auth-scope-matrix.md
docs/architecture/auth-and-permissions.md
docs/product/user-expectations.md
docs/fixes/ auth-related notes
affected feature permissions.md
```

After changing auth or permissions, update:

```txt
docs/implementation/03-auth-scope-matrix.md
docs/architecture/auth-and-permissions.md
docs/testing/regression-tests.md
docs/fixes/ if a bug was fixed
```

Never trust client-provided tenant, workspace, account, or organization identifiers when the server has a resolved context.

Never enforce security only in the UI.

---

## Data model or persistence change

Before changing data model or persistence behavior, read:

```txt
docs/architecture/data-model.md
affected feature data-contract.md
docs/compliance/data-map.md
docs/compliance/export-delete-anonymize.md
docs/operations/migrations.md
```

After changing data behavior, update:

```txt
affected feature data-contract.md
docs/architecture/data-model.md if system-wide
docs/compliance/data-map.md
docs/operations/migrations.md if migration risk changed
```

Document:

```txt
ownership rules
tenant/workspace isolation
soft delete / hard delete behavior
audit behavior
export behavior
delete/anonymize behavior
indexing expectations
query expectations
```

---

## API, controller, tool, webhook, or public endpoint change

Before changing an API-like surface, read:

```txt
affected feature api-contract.md
docs/architecture/errors.md
docs/architecture/auth-and-permissions.md
docs/implementation/03-auth-scope-matrix.md
docs/testing/test-strategy.md
```

After the change, update:

```txt
affected feature api-contract.md
docs/implementation/02-feature-backlog.md
docs/testing/regression-tests.md if relevant
```

Document:

```txt
input schema
output schema
auth requirements
required scopes
error behavior
rate limits
idempotency rules
audit behavior
examples
```

---

## UI behavior change

Before changing UI behavior, read:

```txt
affected feature ui-contract.md
docs/product/user-expectations.md
docs/product/personas.md
docs/architecture/boundaries.md
```

After the change, update:

```txt
affected feature ui-contract.md
affected feature acceptance.md
docs/testing/test-strategy.md if testing approach changed
```

Document user states:

```txt
empty
loading
success
error
forbidden
limit reached
archived/deleted
```

Do not rely on client-side UI to enforce security.

---

## Worker, queue, async job, or scheduler change

Before changing async behavior, read:

```txt
docs/architecture/workers-and-queues.md
docs/architecture/observability.md
docs/operations/env.md
docs/testing/performance-tests.md if latency matters
related docs/fixes/
```

After the change, update:

```txt
docs/architecture/workers-and-queues.md
docs/testing/regression-tests.md
docs/fixes/ if a worker bug was fixed
```

Document:

```txt
queue name
job name
trigger
retry behavior
dead-letter behavior
logging behavior
idempotency behavior
failure visibility
user-visible status if relevant
```

Do not hide failed user-visible work inside background jobs.

---

## Integration or webhook change

Before changing integrations or webhooks, read:

```txt
docs/architecture/integrations.md
docs/architecture/workers-and-queues.md
docs/operations/env.md
docs/fixes/ integration-related notes
```

After the change, update:

```txt
docs/architecture/integrations.md
docs/architecture/workers-and-queues.md
docs/operations/env.md
docs/fixes/ if a provider or webhook bug was fixed
```

Document:

```txt
provider
credentials/env requirements
webhook verification
retry behavior
failure behavior
data mapping
rate limits
manual recovery steps
```

---

## Release, deploy, migration, or rollback change

Before release-related work, read:

```txt
docs/implementation/05-definition-of-done.md
docs/implementation/02-feature-backlog.md
docs/operations/release-checklist.md
docs/operations/rollback.md
docs/operations/migrations.md
docs/testing/smoke-tests.md
docs/testing/regression-tests.md
```

After release-related work, update:

```txt
docs/implementation/02-feature-backlog.md
docs/operations/release-checklist.md
docs/operations/rollback.md
docs/fixes/ if the release fixed an incident
docs/decisions/ if the release changed a major decision
```

---

## Privacy, compliance, export, deletion, anonymization, or audit

Before touching personal or customer data behavior, read:

```txt
docs/compliance/data-map.md
docs/compliance/privacy-baseline.md
docs/compliance/retention.md
docs/compliance/export-delete-anonymize.md
docs/compliance/audit.md
affected feature data-contract.md
```

After the change, update:

```txt
docs/compliance/data-map.md
docs/compliance/export-delete-anonymize.md
docs/compliance/audit.md
affected feature data-contract.md
```

Read compliance docs when touching:

```txt
user profiles
tenant/workspace membership
contacts
documents
messages
billing data
candidate/customer records
activity history
audit logs
external integrations
```

---

# 4. How to use feature docs

Feature docs are the source of truth for user-visible behavior.

Expected feature docs:

```txt
docs/features/<feature-name>/
  README.md
  scenarios.feature
  acceptance.md
  data-contract.md
  api-contract.md
  ui-contract.md
  permissions.md
  edge-cases.md
  performance.md
```

Do not create all files automatically.

Create only the files needed by the feature.

## Feature README

Use `README.md` to understand:

```txt
purpose
users
user-visible outcome
business rules
main flows
out of scope
related product expectations
related architecture docs
related fixes
known risks
performance budget
```

## BDD scenarios

BDD belongs in:

```txt
docs/features/<feature>/scenarios.feature
```

Use BDD for:

```txt
user flows
business rules
permissions
billing gates
AI-agent behavior
public pages
compliance-sensitive behavior
workflow state transitions
performance expectations that affect user experience
```

Do not use BDD for:

```txt
tiny utility functions
formatting helpers
private component internals
low-level ORM mapping
simple getters/setters
implementation-only refactors
```

BDD scenarios should describe observable behavior, not implementation internals.

## ATDD acceptance

ATDD belongs in:

```txt
docs/features/<feature>/acceptance.md
```

Use it as the release gate for the feature.

Acceptance criteria should cover:

```txt
happy path
empty state
error state
unauthorized user
wrong tenant/workspace access
audit behavior where relevant
user-facing copy
performance budget
past fixes reviewed
regression tests added
```

---

# 5. Architecture docs

Architecture docs define system-wide rules.

They do not replace feature docs.

Read architecture docs when behavior crosses features or affects boundaries.

Important architecture docs:

```txt
docs/architecture/overview.md
docs/architecture/boundaries.md
docs/architecture/data-model.md
docs/architecture/auth-and-permissions.md
docs/architecture/integrations.md
docs/architecture/workers-and-queues.md
docs/architecture/errors.md
docs/architecture/observability.md
docs/architecture/performance.md
```

## Boundary rules

When coding, respect these boundaries unless a documented ADR changes them.

Pages/UI may:

```txt
render user-facing state
call approved APIs
show empty/error states
```

Pages/UI must not:

```txt
enforce security only on the client
own business rules
perform hidden sensitive actions
```

Controllers/API handlers may:

```txt
parse and validate input
resolve request context
call services/domain modules
return DTOs
```

Controllers/API handlers must not:

```txt
contain deep domain logic
trust client-provided tenant/workspace IDs
duplicate service logic
```

Services/domain modules may:

```txt
own business rules
enforce permissions
call persistence layer
emit audit events
return narrow DTOs
```

Services/domain modules must not:

```txt
depend on UI state
read request context implicitly unless documented
return oversized payloads when narrow DTOs are enough
```

Workers/jobs may:

```txt
process async tasks
retry safe jobs
record job failures
```

Workers/jobs must not:

```txt
hide failed user-visible work
perform sensitive actions without explicit authorization
```

---

# 6. Implementation docs

Implementation docs control delivery state.

Important files:

```txt
docs/implementation/00-implementation-baseline.md
docs/implementation/01-mvp-scope.md
docs/implementation/02-feature-backlog.md
docs/implementation/03-auth-scope-matrix.md
docs/implementation/04-framework-contract.md
docs/implementation/05-definition-of-done.md
```

## Feature backlog

When implementing or changing a feature, keep this updated:

```txt
docs/implementation/02-feature-backlog.md
```

Each feature row should include, where applicable:

```txt
feature
group
priority
status
area
owner
featureDocsPath
dataDependencies
apiDependencies
uiDependencies
testPath
requiresWorker
requiresIntegration
requiresHumanValidation
implementedAt
commitSha
blockedReason
```

Use these statuses:

```txt
specified
blocked
in_progress
implemented
tested
released
deprecated
```

Do not leave implementation status implicit.

## Definition of done

Before claiming a task is complete, check:

```txt
docs/implementation/05-definition-of-done.md
```

At minimum, verify:

```txt
Product
  [ ] User-visible flow works.
  [ ] Empty state works.
  [ ] Error state works.
  [ ] User expectations are respected.

Security
  [ ] Auth is enforced server-side.
  [ ] Tenant/workspace isolation is tested.
  [ ] Scopes/roles are enforced.
  [ ] Sensitive values are not logged.
  [ ] Web-only actions remain web-only.

Data
  [ ] Data model changes are documented.
  [ ] Mutations are audited where required.
  [ ] Personal-data behavior is documented where relevant.

Testing
  [ ] Unit tests updated.
  [ ] Integration tests updated.
  [ ] E2E tests updated for changed user-visible behavior.
  [ ] Regression tests added for fixed bugs.

Performance
  [ ] Relevant performance budget checked.
  [ ] Before/after benchmarks documented for performance fixes.
  [ ] Regression threshold defined for performance fixes.

Documentation
  [ ] Feature docs updated.
  [ ] Backlog updated.
  [ ] ADR added if a major decision changed.
  [ ] Fix note added if a regression or important bug was fixed.
  [ ] Performance fix note added if performance changed.
```

---

# 7. Fix notes

Past fixes are regression-prevention memory.

They are not a generic changelog.

Create a fix note in:

```txt
docs/fixes/YYYY-MM-DD-short-bug-name.md
```

when a bug:

```txt
affected user trust
affected security
affected billing
affected permissions
affected data integrity
affected performance
was hard to diagnose
could easily be reintroduced by a coding agent
```

## Fix note template

````md
# Fix: <Short bug name>

## Date

YYYY-MM-DD

## Severity

Low / Medium / High / Critical

## Status

Fixed

## Affected area

auth / billing / dashboard / public route / worker / integration / database / UI

## Problem

What went wrong?

## User impact

What did the user experience?

## Expected behavior

What should have happened?

## Actual behavior

What happened instead?

## Root cause

Why did it happen?

## Solution implemented

Describe the actual implemented solution.

## Code changes

```txt
path/to/file
path/to/test
```

## Alternatives considered

### Alternative 1

Rejected because...

### Alternative 2

Accepted because...

## Regression test

```txt
tests/regression/<area>/<bug-name>.test.ts
```

## New rule added

What should future agents follow?

## Agent warning

What pattern must not be reintroduced?

## Related docs

- docs/features/<feature>/
- docs/architecture/<area>.md
````

---

# 8. Performance fix notes

Performance fixes require evidence.

Create a performance fix note in:

```txt
docs/fixes/YYYY-MM-DD-performance-name.md
```

A performance fix must include:

```txt
problem
user impact
baseline benchmark before
environment
dataset
benchmark command
root cause
solution implemented
benchmark after
trade-offs
regression threshold
test or benchmark path
```

## Performance fix template

````md
# Fix: <Performance problem>

## Date

YYYY-MM-DD

## Severity

Low / Medium / High / Critical

## Status

Fixed

## Affected area

page / API / database / worker / integration / frontend

## Problem

What was slow or inefficient?

## User impact

What did users experience?

## Expected behavior

What performance budget should apply?

## Actual behavior

What was the measured behavior before the fix?

## Baseline benchmark before fix

### Environment

```txt
Environment:
Date:
Commit before:
Runtime:
Database:
Dataset:
```

### Benchmark command

```bash
<command>
```

### Results before

| Metric             | Before |
| ------------------ | -----: |
| p50                |        |
| p95                |        |
| p99                |        |
| DB queries/request |        |
| Slowest query      |        |
| Bundle size        |        |
| Queue latency p95  |        |
| Memory peak        |        |

## Root cause

Explain the cause.

## Solution implemented

List the exact changes.

## Benchmark after fix

### Environment

Same as before unless stated otherwise.

### Results after

| Metric             | Before | After | Change |
| ------------------ | -----: | ----: | -----: |
| p50                |        |       |        |
| p95                |        |       |        |
| p99                |        |       |        |
| DB queries/request |        |       |        |
| Slowest query      |        |       |        |
| Bundle size        |        |       |        |
| Queue latency p95  |        |       |        |
| Memory peak        |        |       |        |

## Trade-offs

What changed negatively or became more constrained?

## Regression threshold

This fix is considered regressed if:

```txt
<metric> > <threshold>
```

## Regression benchmark

```txt
tests/performance/<benchmark>.test.ts
```

## New rule added

What should future agents follow?

## Agent warning

What pattern must not be reintroduced?
````

---

# 9. Decision docs

Use ADRs for choices that future agents must not casually undo.

Create ADRs in:

```txt
docs/decisions/ADR-0001-short-name.md
```

Create an ADR when:

```txt
a major technical choice is made
a product boundary is frozen
a security or privacy rule is established
a framework/integration choice is made
a costly-to-reverse decision is made
a previous decision is replaced
```

Do not create ADRs for tiny implementation details.

## ADR template

```md
# ADR-0001 - <Decision>

## Status

Proposed / Accepted / Deprecated / Replaced

## Date

YYYY-MM-DD

## Context

What problem forced this decision?

## Decision

What did we choose?

## Consequences

### Positive

### Negative

## Alternatives considered

## What future agents must not do

## Related docs

- ...
```

---

# 10. Testing docs

Testing docs explain how to prove behavior.

Important files:

```txt
docs/testing/test-strategy.md
docs/testing/fixtures.md
docs/testing/smoke-tests.md
docs/testing/regression-tests.md
docs/testing/performance-tests.md
```

Use this mapping:

```txt
BDD scenario
  -> acceptance checklist
  -> automated test
  -> regression test if bug occurred
  -> performance benchmark if performance changed
  -> fix note if historical problem was solved
```

When adding or changing tests, update:

```txt
docs/testing/regression-tests.md
docs/testing/performance-tests.md
docs/testing/fixtures.md if test data changes
```

Do not create inconsistent ad hoc fixtures when a documented fixture exists.

---

# 11. Clean documentation rules

## Rule 1 - Every doc needs a purpose

Every new or significantly updated doc should include:

```md
# Title

## Purpose

## When to read this

## When to update this

## Source of truth for

## Last reviewed
```

## Rule 2 - Do not duplicate source of truth

Use these locations:

```txt
Business rule                  -> feature README
Permission rule                -> feature permissions.md or auth-scope matrix
System boundary                -> architecture/boundaries.md
Historical bug                 -> fixes/
Implementation status          -> feature backlog
Acceptance criteria            -> feature acceptance.md
Performance budget             -> architecture/performance.md or feature performance.md
Privacy/data behavior          -> compliance/
Architecture decision          -> decisions/ADR-xxxx.md
```

When another document needs the same information, link to the source instead of copying it.

## Rule 3 - Prefer short, specific docs

Prefer:

```txt
short specific docs
clear tables
templates
checklists
examples
links to related docs
```

Avoid:

```txt
long essays
mixed product + implementation + history docs
unclear ownership
duplicated requirements
stale maybe-later notes
```

## Rule 4 - Archive stale docs

Do not let stale docs guide coding.

Move deprecated docs to:

```txt
docs/_archive/deprecated-docs/
```

Add this note:

```md
# Deprecated

This document is archived and must not guide current implementation.

Current source of truth:
- ...
```

## Rule 5 - Important fixes require fix notes

A fix note is required when the bug affected:

```txt
trust
security
billing
permissions
data integrity
performance
privacy
public routes
external integrations
```

## Rule 6 - Performance fixes require benchmarks

Do not claim a performance improvement without before/after evidence.

## Rule 7 - BDD and ATDD stay at feature level

BDD belongs in:

```txt
docs/features/<feature>/scenarios.feature
```

ATDD belongs in:

```txt
docs/features/<feature>/acceptance.md
```

Do not scatter Given/When/Then scenarios across unrelated docs unless they are regression examples.

---

# 12. Documentation update rules

Update docs only when:

```txt
behavior changed
a decision changed
a bug was fixed
a performance solution was implemented
a rule was learned
a feature moved status
a data/privacy behavior changed
a release/rollback/migration risk changed
```

Do not update docs just to restate code.

Do not create empty placeholder docs unless they are needed as a source of truth for imminent work.

---

# 13. Output expectations when coding

When completing a coding task, report:

```txt
What changed
Which docs were read
Which docs were updated
Which tests were run
Which acceptance criteria were satisfied
Whether any fix note was added
Whether any performance benchmark was added
Any remaining open questions or blockers
```

If docs were not updated, explain why no documentation update was necessary.

If a relevant source-of-truth doc was missing, either create it or state that the task was completed with an explicit assumption.

---

# 14. Hard stops

Stop and surface the issue instead of guessing when:

```txt
the feature has no acceptance criteria
the task conflicts with user expectations
the task conflicts with auth/scope matrix
the task would bypass tenant/workspace isolation
the task touches personal data but compliance docs are missing
the task changes billing/security/OAuth/account deletion without a documented web-only or approval rule
the task fixes performance but no benchmark can be captured
the task depends on a blocked feature backlog item
the task contradicts an accepted ADR
```

When possible, document the blocker in the relevant backlog, acceptance, ADR, or fix note.

---

# 15. Final principle

The `/docs` folder exists to give coding agents the right context at the right moment.

Before coding:

```txt
read the smallest relevant doc pack
```

During coding:

```txt
follow feature docs, architecture boundaries, auth rules, and acceptance criteria
```

After coding:

```txt
update backlog, acceptance, tests, fix notes, performance notes, or decisions when relevant
```

Before claiming done:

```txt
check the definition of done
```

Do not turn documentation into a second codebase.

Keep it clean, current, linked, and operational.
