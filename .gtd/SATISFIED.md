# Satisfied: 02-lands-step-split

- `tests/integration/support/steps/history.steps.ts`:
  `gtd lands {string} with {string}` calls
  `world.runGtd("land", ...args.trim().split(/\s+/))` (working tree).
- `tests/integration/features/summary-slice.feature`: the cost scenario uses
  `--cost=10 --model=sonnet` through that step.
- `npm run test:e2e:inmem`: 92 files passed, 754 tests passed, including every
  `summary-slice.feature` scenario.
