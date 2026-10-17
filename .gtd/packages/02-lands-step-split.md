# 02 — `gtd lands {string} with {string}` splits on any whitespace

## Requirements

Concern 6: the step in `tests/integration/support/steps/history.steps.ts` splits
its args with `args.split(" ")`; **a doubled or trailing space yields an empty
argument passed to `gtd land`.** Split with `args.trim().split(/\s+/)`;
single-space args stay identical, every existing scenario unchanged.

## Tasks

### Task 1: Whitespace-robust arg split

- [ ] `gtd lands {string} with {string}` calls
      `world.runGtd("land", ...args.trim().split(/\s+/))`
- [ ] No new test: every `gtd lands … with …` scenario exercises it
- [ ] Existing scenarios pass unchanged, incl. `summary-slice.feature`'s
      `--cost=1/10/100/1000` per-slice cost scenario

Paths: `tests/integration/support/steps/history.steps.ts`

## Tests

- e2e: `tests/integration/features/summary-slice.feature`
