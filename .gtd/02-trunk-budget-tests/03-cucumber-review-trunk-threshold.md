# Cucumber: trunk-based review-fix threshold force-approve

## What to build

Add a scenario to `tests/integration/features/agentic-review.feature` that
exercises the review-fix threshold force-approve on the **default branch**
(trunk), with NO `Given a branch "feature"` step.

Mirror the existing scenario "The review-fix threshold force-approves without
reviewing" (lines 51-67), but drop the `And a branch "feature"` step so all
`gtd: feedback` commits land on `main`.

Concretely the new scenario:

- `Given a test project`
- `And a default branch "main"` (NO branch step)
- a `gtd: planning` commit adding `.gtd/01-foo/01-task.md`
- three `And a commit "gtd: feedback"` steps (reaching the default
  reviewThreshold of 3)
- a `gtd: building` commit
- `When I run gtd`
- Assertions matching the feature-branch threshold scenario: succeeds, last
  commit subject is `gtd: package done`, `.gtd/01-foo/01-task.md` does not
  exist, stdout does not contain `## Task: Agentic review of the built package`

Give it a distinct name, e.g. "The review-fix threshold force-approves on the
default branch (trunk)".

## Acceptance criteria

- [ ] New scenario added to `tests/integration/features/agentic-review.feature`
      with no `Given a branch "feature"` step
- [ ] All `gtd: feedback` commits land on the default branch `main`
- [ ] Reuses existing composable Given steps only — no new step definitions
- [ ] Step text exposes the actual commits per AGENTS.md
- [ ] Asserts force-approve (`gtd: package done`, no agentic-review prompt) at
      the threshold, proving `reviewFixCount` folds over trunk commits
- [ ] The cucumber suite passes after package 01 is applied

## Files

- `/Users/pmelab/Code/gtd/gtd/tests/integration/features/agentic-review.feature`
  (only this file)

## Constraints / edge cases

- Do NOT add a `Given a branch "feature"` step.
- Do not add or modify step definitions; only the `.feature` file changes here.
- Keep the existing scenarios untouched; append the new one.
