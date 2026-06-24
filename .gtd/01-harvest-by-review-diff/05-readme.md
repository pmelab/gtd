# Update README `!!` harvest description to added-line semantics

The README's `!!` callout (~109-115) still describes the OLD scoping ("only
files referenced in the current REVIEW.md … plus the dirty working tree") and
says the comments are "stripped from the source". Update it to the new
diff-based, read-only semantics.

## Files

- `README.md` — the `> **`!!` follow-up comments** …` block (~lines 109-115).

## What to do

Rewrite the callout to state:

- `!!` follow-up comments are leftover work harvested verbatim into `TODO.md`
  during `review-process`.
- Harvesting is scoped to the reviewer's session: only `!!` tokens on lines ADDED
  since the `review(gtd): create review …` commit (the review baseline) are
  harvested, regardless of which files `REVIEW.md` references. Pre-existing
  (older) `!!` anywhere in the tree are ignored.
- Their presence still diverts an otherwise-approved review away from
  `close-review`.
- The reviewer-added `!!` lines are removed by the existing review reset (Step 7
  `git checkout -- .` / `git clean -fd`), not by a manual strip — harvest is
  read-only. (Remove/replace the old "stripped from the source" wording.)
- Plain `TODO:` markers are ordinary code and are never swept up.

## Acceptance criteria

- [ ] README describes harvesting as `!!` on lines added since the
      `review(gtd): create review …` commit, regardless of file membership.
- [ ] The old "only files referenced in the current REVIEW.md … plus the dirty
      working tree" scoping wording is gone.
- [ ] The "stripped from the source" claim is replaced by the read-only /
      reset-removes-them description.

## Constraints / edge cases

- File-disjoint: touches ONLY `README.md`.
- Per the global instruction, every significant change must be reflected in the
  README — this task IS that reflection for this change.
