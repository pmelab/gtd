# Task: Regression scenario — unchecked boxes do not gate Done

Add a Cucumber scenario to `tests/integration/features/review.feature` proving a
committed REVIEW.md containing the `<!-- base: -->` marker **and** unchecked
`- [ ]` boxes still routes to **Done** on a clean tree. This guards "not enforced
any more".

## What to build

Add one scenario (reuse the existing composable `Given` steps — `a test project`,
``a commit "<subject>" that adds "<file>" with:``, etc.; do not invent one-off
setup steps):

- Set up a `feat:` commit adding a source file, then a `gtd: awaiting review`
  commit that adds `REVIEW.md` whose body contains both the
  `<!-- base: <hash> -->` marker **and** unchecked `- [ ]` checkbox pointers.
- Run gtd on a clean tree (no edits).
- Assert: `the last commit subject is "gtd: done"` and `the file "REVIEW.md"
  does not exist` — i.e. unchecked boxes did **not** block approval.

Model it on the existing scenario `A committed REVIEW.md approved with no edits
finishes as gtd: done` (L41-58), but with the restored marker + unchecked-box
fixture content.

## Acceptance criteria

- [ ] New scenario added using existing composable `Given` steps only
- [ ] REVIEW.md fixture contains a `<!-- base: ... -->` marker line
- [ ] REVIEW.md fixture contains at least one unchecked `- [ ]` checkbox
- [ ] Asserts last commit subject `gtd: done` and REVIEW.md removed
- [ ] Scenario text exposes the actual fixture file content inline (per AGENTS.md)
- [ ] The full `review.feature` suite passes (existing scenarios use markerless
      fixtures and assert format-agnostic routing — they stay green)

## Files

- Edit: `/Users/pmelab/Code/gtd/gtd/tests/integration/features/review.feature`

## Constraints

- File-disjoint with all other tasks. You own `review.feature` only.
- Do not add or modify step definitions unless a needed generic step is truly
  missing — prefer the existing composable steps.
- No machine/edge code changes — enforcement is already absent; this scenario
  only locks that in.
