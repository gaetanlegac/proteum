# Write Real World Journey Tests

Source: `/Users/gaetan/.codex/skills/write-real-world-journey-tests/SKILL.md`

## Goal

Create journey tests that read like an executable product spec. Prefer a realistic sequence of actions by real roles over a collection of disconnected UI checks.

The journey should cover the requested feature area broadly, but every step must be justified by normal user behavior and by state created earlier in the journey.

## Workflow

1. Inspect the feature surface before designing the test.
   - Read existing journey tests, page objects, factories, workflows, fixtures, selectors, and test utilities.
   - Identify local conventions for auth, data creation, navigation, assertions, cleanup, retries, and timeouts.
   - Reuse existing helpers before adding new ones.
   - Preserve the repository's test-file organization instead of putting every helper inside the journey spec.

2. Follow the local E2E file organization.
   - Put complete user journeys in `tests/e2e/journeys/*.spec.ts` or the repository's equivalent journey/spec directory.
   - Put reusable screen abstractions in `tests/e2e/pages/**`, grouped by product area; use focused page objects for pages, modals, filter bars, pickers, and detail panels.
   - Put reusable multi-step business flows in `tests/e2e/workflows/**`, such as login, signup via invite, create entity with invite link, or other flows shared by several journeys.
   - Put generated domain data in `tests/e2e/factories/**`, with separate minimum, maximum, and edited payload factories when the journey needs create/edit coverage.
   - Put shared technical/domain helpers in `tests/e2e/utils/**`, such as context creation, constants, API response parsing, date formatting, KPI expectations, number/currency parsers, display-name builders, and journey tree logging.
   - Add a helper to the nearest existing page/workflow/factory/utils module when it is reusable; keep it local to the spec only when it is specific to that one journey's memory or assertions.

3. Map the real-world story.
   - List the roles involved, their permissions, and why each role appears in the scenario.
   - Identify the entities that move through the journey: account, team, organization, customer, order, lead, report, subscription, etc.
   - Define the natural order: setup, invite/signup/login, empty state, creation, assignment, action by another role, management, reporting, audit/review.
   - Prefer one coherent story over feature stuffing. Cover many features only when they belong to the same user journey.

4. Make the report-visible hierarchy explicit.
   - Group journeys with `describe` blocks or the framework equivalent by business phase, such as acquisition, activation, setup, core workflow, limits, billing, and admin review.
   - Split each journey test into named substeps with `test.step(...)`, Cypress command logs, or the local framework equivalent so CI reports and traces show what business phase failed.
   - Name steps from the user or business perspective, such as `Launch plan blocks the third filter`, not from implementation details, such as `Click button`.
   - Use nested substeps for repeated matrices like roles, plans, permissions, limits, or locales, with one visible step per case and smaller substeps for settings, allowed actions, and blocked actions.
   - Preserve local file organization and helper conventions; hierarchy should improve readability without moving unrelated code or hiding assertions.

5. Use serial state only for real dependency chains.
   - Use a serial describe block when later tests intentionally depend on state created by earlier actors.
   - Split the journey into tests by actor/session or meaningful product phase.
   - Use fresh browser contexts or sessions for different roles.
   - Keep setup assertions at the top of each dependent test so failures explain the missing prerequisite.

6. Keep journey memory as the source of truth.
   - Store created IDs, invite links, generated users, current payloads, assignment state, statuses, dates, and monetary values in typed in-memory objects.
   - Update memory immediately after successful UI/API responses.
   - Compute expectations from memory instead of duplicating constants in assertions.
   - Track both `createdPayload` and `currentPayload` when edits are part of the journey.

7. Assert the product contract at each phase.
   - Empty states and initial KPIs for new users.
   - Role-specific navigation, tabs, menu labels, and restricted access.
   - Created rows/cards/details match generated input.
   - Default ownership, assignment, channel/source, payment terms, status, or permission behavior.
   - Cross-role visibility after another role acts.
   - Details modals, edit flows, notes/activity timelines, status changes, derived fields, filters, date ranges, and aggregate KPIs.
   - Final manager/admin review across the whole organization or feature scope.

8. Make derived assertions resilient.
   - Use polling for eventually consistent UI totals, KPI cards, async table updates, revenue/pipeline calculations, closing rates, and status text.
   - Parse formatted numbers, currency, and percentages with shared utilities.
   - Use deterministic date helpers for UI date formatting and date-range assertions.
   - Wait for important create/update responses when IDs or persistence are needed.

9. Prefer expressive helpers.
   - Introduce small helpers for repeated domain assertions, such as row basics, row KPI checks, snapshot comparison, filter setup, and derived totals.
   - Keep helper names product-facing, not implementation-facing.
   - Use page objects and workflow helpers to keep the test readable at the story level.

10. Log or snapshot the journey shape when useful.
   - For long multi-role journeys, optionally keep a small tree or timeline logger showing created roles and entities.
   - Use it for debugging and readability, not as a substitute for assertions.

## Implementation Pattern

Use this shape as a guide, adapting to the repository's test framework:

```ts
test.describe.serial('Domain - Feature journey', () => {
  test.describe.configure({ timeout: 300_000 });

  let organization = createEmptyOrganizationMemory();
  let manager = createEmptyAccountMemory();
  let operator = createEmptyAccountMemory();
  let externalPartner = createEmptyPartnerMemory();
  let itemA = createItemMemory(createMinimumPayload(), { type: 'operator' });
  let itemB = createItemMemory(createMaximumPayload(), { type: 'external-partner' });

  const getCreatedItems = () => [itemA, itemB].filter((item) => item.id);
  const buildKpis = () => ({
    'Total Items': getCreatedItems().length,
    'Completed': getCreatedItems().filter((item) => item.status === 'Completed').length,
  });
  const matrixCases = [{ name: 'Manager' }, { name: 'Operator' }];

  test.describe('Setup and activation', () => {
    test('Admin or owner creates the parent scope', async ({ browser }) => {
      await test.step('Create the organization through the normal product path', async () => {
        // Store IDs, invite links, and display data in memory.
      });
    });

    test('Manager signs up and prepares the working structure', async ({ browser }) => {
      await test.step('Assert restricted navigation and empty state', async () => {});
      await test.step('Create the team and invite the next role', async () => {});
    });
  });

  test.describe('Core workflow', () => {
    test('Primary role performs the core workflow and delegates work', async ({ browser }) => {
      await test.step('Create a minimum item', async () => {});
      await test.step('Assert default ownership and visible table state', async () => {});
      await test.step('Delegate the item to another role', async () => {});
    });

    test('Secondary role acts on assigned state', async ({ browser }) => {
      await test.step('Assert this role only sees assigned work', async () => {});
      await test.step('Create or update a maximum-data item', async () => {});
      await test.step('Assert role-specific defaults and KPIs', async () => {});
    });

    test('Primary role manages resulting activity', async ({ browser }) => {
      await test.step('Open details and validate data from the secondary role', async () => {});
      await test.step('Add notes, edit fields, and change status', async () => {});
      await test.step('Assert recalculated derived values', async () => {});
    });
  });

  test.describe('Review and reporting', () => {
    test('Manager or auditor reviews aggregate state', async ({ browser }) => {
      await test.step('Assert cross-role visibility and filters', async () => {});
      await test.step('Assert aggregate KPIs and final business outcomes', async () => {});
    });

    test('Plan, role, or permission matrix exposes the correct behavior', async ({ browser }) => {
      for (const caseItem of matrixCases) {
        await test.step(`${caseItem.name} shows the right settings and limits`, async () => {
          await test.step(`${caseItem.name} settings match contract`, async () => {});
          await test.step(`${caseItem.name} allowed actions succeed`, async () => {});
          await test.step(`${caseItem.name} blocked actions fail with the expected reason`, async () => {});
        });
      }
    });
  });
});
```

## Coverage Heuristics

Include a feature when it naturally belongs to the journey and creates a durable assertion later. Strong candidates:

- Invite/signup/login boundaries.
- Permission differences between roles.
- Empty state to populated state.
- Minimum-data and maximum-data creation paths.
- Assignment, reassignment, ownership, membership, or sharing.
- Details view, edit view, notes, activity history, and status changes.
- Derived totals, dashboards, reporting cards, and tables.
- Filters, search, date ranges, sorting, and snapshots.
- Cross-role consistency: what one actor creates, another actor sees or manages.

Exclude or move to narrower tests:

- Pure component styling.
- Exhaustive validation errors.
- Every filter permutation.
- Rare edge cases that interrupt the main story.
- Admin-only setup that is unrelated to the requested feature.

## Quality Bar

- The scenario should be explainable as a real customer workflow.
- Each role should do work that role would actually do.
- Assertions should prove business behavior, not only that buttons are clickable.
- Later assertions should depend on earlier created state.
- Names, IDs, and dates should be generated uniquely enough for shared test environments.
- The test should fail near the broken product behavior, with step names that explain the business phase.
- The test report should expose a clear hierarchy of phases, tests, and substeps so a reader can understand the journey without opening the source file.
- Comments should clarify product intent or non-obvious timing behavior, not narrate obvious code.

## Anti-Patterns

- One huge test with no actor boundaries.
- Flat journey tests with no report-visible phases or substeps.
- Serial dependency without explicit prerequisite assertions.
- Hardcoded duplicate KPI values that drift after edits.
- Creating data directly in the database when the product flow under test is creation, signup, invite, assignment, or editing.
- Covering unrelated features just to increase line count.
- Hiding flakiness with arbitrary sleeps instead of waiting on UI state, network responses, or polling derived values.
- Testing only the creator role when the feature's value appears through another role's visibility or management flow.
