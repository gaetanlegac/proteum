# E2E Journey Test Instructions

Follow `REAL_WORLD_JOURNEY_TESTS.md` in this directory when designing, implementing, extending, or reviewing end-to-end tests.

Required structure for substantial E2E work:

- `tests/e2e/journeys/`: real-world journey specs grouped by workflow or domain.
- `tests/e2e/pages/`: page objects or screen helpers that keep selectors stable.
- `tests/e2e/workflows/`: reusable multi-step role and business workflows.
- `tests/e2e/factories/`: deterministic test data builders and fixtures.
- `tests/e2e/utils/`: login, navigation, assertions, network, and cleanup helpers.

Do not reduce E2E coverage to one-screen smoke tests when the feature involves multiple roles, permissions, workflow states, derived KPIs, or cross-view consistency.
