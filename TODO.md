# Refactor review-process: reference-commit + mechanical revert

Review feedback on the `!!` session-diff change. The reviewer proposed replacing
the current `review-process` reset mechanics with a more reliable, agent-free
model that leaves **zero** reviewer artifacts in the code. Recorded verbatim
from `REVIEW.md`:

> refactored review process:
>
> - REVIEW.md is initially created
> - user makes changes to REVIEW.md _and_ leaves `!!` comments in code
> - both are committed verbatim in a single commit for reference, no agent
>   involved (commit "x")
> - instruct agent to generate TODO.md from diff of commit "x" and commit
>   TODO.md
> - revert commit "x"
> - remove REVIEW.md
>
> that should leave no artifacts in code and provide maximum reliability

## Why

The just-shipped `!!` harvest is read-only, and the previous review-process
reset (`git checkout -- .` / `git clean -fd`) only reverts **uncommitted**
edits. But by the time `review-process` runs, the reviewer's source edits (`!!`
comments and illustrative changes) are already **committed** (the `code-changes`
leaf commits dirty source before `review-process` can fire). So those edits —
and the `!!` lines — **linger in the source history**; nothing removes them. The
agent is also asked to interpret/strip, which is unreliable. The reviewer wants
a mechanical, deterministic teardown.

## Proposed new flow (replaces review-process Steps 6–8)

1. **Reference commit "x" (mechanical, no agent).** `git add -A && git commit`
   the reviewer's entire working tree verbatim — REVIEW.md edits, any `!!`
   comments, and any illustrative source edits — into a single commit. This is
   the existing `docs(review): record raw feedback for <base>` commit; keep it.
2. **Generate TODO.md from the diff of "x".** Instruct the agent to read the
   diff that commit "x" introduces (`git show <x>` / `git diff <x>^ <x>`) and
   synthesize `TODO.md` from it — REVIEW.md comments, source edits, and `!!`
   follow-ups are all just hunks in that one diff. Commit `TODO.md`.
3. **Revert "x" mechanically.** `git revert --no-edit <x>` so every reviewer
   change is undone in a new commit — `!!` gone, illustrative source edits gone,
   REVIEW.md edits gone — with no agent guessing and nothing left behind. (The
   `TODO.md` commit sits between "x" and its revert, so the revert does not
   touch it.)
4. **Remove REVIEW.md.** After the revert restores REVIEW.md to its
   review-create content, delete it and commit (or fold the deletion into the
   revert commit).

Net result: `TODO.md` captures the feedback; the working tree and history carry
**no** lingering `!!` or illustrative edits.

## Open considerations (to grill)

- **Does `grepBangAdded` / the `!!` harvest event still have a role?** Under
  this model the agent reads the whole commit-"x" diff to build TODO.md, so `!!`
  comments are captured as part of that diff rather than via `grepBang`. Decide
  whether `grepBangAdded` (and `bangComments`/`bangPresent` in `gatherEvents` /
  the machine) is still needed at all — e.g. is `bangPresent` still required to
  divert an otherwise-approved (forward-tick-only) review away from
  `close-review`? If `!!` no longer needs harvesting (the diff carries it), but
  `bangPresent` is still the signal that distinguishes "approve" from "has
  follow-up work", that guard may need a different source. This is the
  highest-stakes decision — it may let us delete `grepBangAdded` entirely, or
  keep only its boolean.
- **Ordering vs. the `code-changes` leaf.** `code-changes` currently commits
  dirty source _before_ `review-process`. Does the reference commit "x" subsume
  `code-changes` for the review path, or do they coexist (x just re-commits an
  already-clean tree)? Trace whether a separate `code-changes` commit then a
  raw-feedback commit produces two commits to revert, and whether the revert
  target is unambiguous.
- **Revert conflicts.** If later commits touched the same lines, `git revert`
  can conflict. In the review-process flow the revert runs immediately on top of
  "x" + the TODO.md commit (which only adds TODO.md), so conflicts are unlikely
  — confirm and decide the failure behavior (abort + escalate vs. leave for
  human).
- **`base`/review-base bookkeeping.** Today the close path writes a
  `chore(gtd): close approved review` commit that becomes the next review base.
  Ensure the new revert-based teardown still leaves a well-defined base for the
  next `human-review` (the revert commit, or the TODO.md commit) and that
  `computeReviewBase` / `lastReviewCommit` still resolve correctly.
- **Prompt + tests.** `src/prompts/review-process.md` Steps 6–8 get rewritten;
  the e2e `review.feature` / `spec-harvest.feature` scenarios that assert the
  post-review tree state must be updated to assert the reverted (artifact-free)
  tree.

## Note on this run

This `review-process` run itself used the OLD flow (record raw feedback → reset
→ commit TODO.md). The refactor above changes that flow for FUTURE runs.
