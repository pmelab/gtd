# Review: e623be4

<!-- base: e623be415faf5c45f54177ded9326e78ad45c2c4 -->

## Generalize review frontier guard

`computeReviewBase` previously only returned `Option.none()` when the last
review/close commit hash equalled HEAD exactly. Once any commit landed on top
(e.g. a `plan(gtd): grilling` commit), the guard failed and the close commit
became a review base, surfacing a spurious REVIEW.md containing only workflow
noise.

The fix loops over both candidates; for each one that is an ancestor of HEAD, it
fetches subjects in `candidate..HEAD` via `git.commitSubjects` and returns
`Option.none()` if every subject matches `^(?:plan|review|chore)\(gtd\):`. An
empty range trivially passes `every()`, preserving the original fast path.

- [ ] ./src/Events.ts#116

## Unit tests for frontier guard

Three cases in a real temp-git repo: (1) close commit at HEAD → `None`, (2)
close + `plan(gtd)` on top → `None` (the regression), (3) close + plan + real
code → `Some(closeSha)`.

- [ ] ./src/Events.test.ts#285

## Cucumber integration scenarios

Three end-to-end scenarios exercising the same three cases through the full gtd
binary. One new composable step (`a prior close commit for {string}`) mirrors
the existing `a prior review commit` pattern.

- [ ] ./tests/integration/features/review-frontier.feature#1
- [ ] ./tests/integration/support/steps/common.steps.ts#107

## README frontier note

Extended the "Review base" blockquote to document that gtd-workflow commits
above the review/close candidate keep the frontier in place and do not re-open a
review; only a real code commit does.

- [ ] ./README.md#118
