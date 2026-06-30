# Cucumber: trunk-based fix-attempt-cap escalation

## What to build

Add a scenario to `tests/integration/features/testing.feature` that exercises
the fix-attempt-cap escalation on the **default branch** (trunk), with NO
`Given a branch "feature"` step. This is the coverage gap that let issue 7 slip
through — every existing cap/reset scenario runs on a feature branch.

Mirror the existing scenario "A red gate at the fix-attempt cap writes ERRORS.md
and escalates" (lines 66-97) exactly, but drop the `And a branch "feature"` step
so all `gtd: errors` commits land on `main`.

Concretely the new scenario:

- `Given a test project`
- `And a default branch "main"` (NO branch step)
- a `chore: test gate` commit adding `gate.sh` that echoes `SENTINEL_FAILURE`
  and `exit 1`
- a `.gtdrc` with `testCommand: bash gate.sh`
- a `gtd: planning` commit adding `.gtd/01-foo/01-task.md`
- three `And a commit "gtd: errors"` steps (reaching the default cap of 3)
- a pending `src/helper.ts` file
- `When I run gtd`
- Assertions matching the feature-branch cap scenario: succeeds, `ERRORS.md`
  exists, `FEEDBACK.md` does not exist, last commit subject is `gtd: errors`,
  stdout contains `## Task: Escalate` and `STOP`, stdout does not contain
  `## Task: Fix the package`

Give it a distinct, descriptive name, e.g. "A red gate at the cap on the default
branch (trunk) writes ERRORS.md and escalates".

## Acceptance criteria

- [ ] New scenario added to `tests/integration/features/testing.feature` with no
      `Given a branch "feature"` step
- [ ] All `gtd: errors` commits land on the default branch `main`
- [ ] Reuses existing composable Given steps only (`a test project`,
      `a default branch`, `a commit ... that adds ... with`,
      `a commit "gtd: errors"`, `a gtd config file at`, `a file ... with`) — no
      new step definitions
- [ ] Step text exposes the actual commits/content per AGENTS.md (no hidden
      setup)
- [ ] Asserts the run reaches Escalate (ERRORS.md written) at the cap, proving
      the budget folds over trunk commits
- [ ] The cucumber suite passes after package 01 is applied

## Files

- `/Users/pmelab/Code/gtd/gtd/tests/integration/features/testing.feature` (only
  this file)

## Constraints / edge cases

- Do NOT add a `Given a branch "feature"` step — that is the whole point.
- Do not add or modify step definitions; only the `.feature` file changes here.
- Keep the existing scenarios untouched; append the new one.
