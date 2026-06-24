refactor(review): mechanical revert-based review-process teardown

Replace the agent-driven review reset (`git checkout -- .` / `git clean -fd`)
with a deterministic, artifact-free teardown that leaves no `!!`, illustrative
source edits, or REVIEW.md noise in the source history.

The review-process prompt now: commits the whole dirty working tree verbatim as
reference commit "x" (`docs(review): record raw feedback for <base>`), synthesizes
`TODO.md` from `git show <x>`, then `git revert --no-edit <x>` (on conflict:
`git revert --abort`, STOP, escalate), removes `REVIEW.md`, and ends with the
recognized `chore(gtd): close approved review for <sha>` anchor so
`lastCloseCommit`/`computeReviewBase` resolve and the frontier-at-HEAD loop
terminates.

To make commit "x" capture everything, code changes are no longer pre-committed
while a review is in progress: a new `reviewPresent` payload boolean gates the
`codeDirty` guard (`params.codeDirty && !params.reviewPresent`) so the review
branches own routing when REVIEW.md exists (note+dirty → review-process;
unmodified-review+dirty → await-review). Guard order is unchanged.

Reduces `grepBangAdded` (returning `BangComment[]`) to a boolean `hasBangAdded`
that still diverts a forward-tick approval with a reviewer-added `!!` into
review-process via `bangPresent`. Deletes the dead `BangComment` struct, the
`bangComments` plumbing (Events payload, GtdContext, Prompt.ts injection), and
the unused `checkoutTracked`/`cleanUntracked` GitOperations methods. Updates the
unit tests, the `review`/`spec-harvest` e2e features (routing + artifact-free
reverted tree, not harvested `!!` text), and README.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
