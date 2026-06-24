# Update README.md for the revert-based teardown + `reviewPresent` gate

Document the new review-process teardown and the rule that code changes are NOT
pre-committed while a REVIEW.md is present.

This task owns `README.md` exclusively. No behavior dependency — it is a docs-only
task, file-disjoint from all code/prompt/feature tasks in this package.

## Files (exclusive to this task)

- `README.md`

## What to do

1. **`code-changes` row (~60):** clarify it fires only when there is NO REVIEW.md
   present ("Any uncommitted change outside `TODO.md`/`REVIEW.md` **and no
   REVIEW.md present**"). The `reviewPresent` gate suppresses `code-changes`
   while a review is in progress.

2. **`review-process` row (~61):** rewrite the prompt description to the
   revert-based teardown: "Commit the whole dirty tree verbatim as reference
   commit `x`, synthesize `TODO.md` from its diff, then `git revert` `x`, remove
   `REVIEW.md`, and close with the anchor commit — leaving no artifact." Drop the
   "harvest `!!` comments (not plain `TODO:`)" wording (no per-comment harvest
   anymore); keep that an `!!` (or any note) diverts an approved review here.

3. **`!!` follow-up note (~109-119):** rewrite. `!!` (or any reviewer note)
   diverts an otherwise-approved review away from `close-review` into
   `review-process`. Remove the "harvested verbatim into `TODO.md`" claim and the
   now-false sentence "the reviewer's edits reach `review-process` already
   committed, since `code-changes` runs first" (~117-118) — under the new gate,
   while a REVIEW.md is present, source edits are NOT committed by `code-changes`;
   they reach `review-process` UNCOMMITTED and are captured into reference commit
   `x`, then mechanically reverted. Keep that pre-existing `!!` (committed before
   the review baseline) and plain `TODO:` do not divert.

4. **Mermaid (~196-198):** update the `code-changes` edge label to note it fires
   only when no REVIEW.md is present (e.g. "change outside TODO.md/REVIEW.md, no
   review in progress"). Update the `review-process` node/edge so it reflects:
   commit `x` → synthesize TODO.md → `git revert x` → close anchor. The
   `ReviewProcess` node may drop the `:::terminal` only if its auto-advance is
   unchanged — leave `:::terminal` as-is (review-process is still auto-advance).

5. **Workflow prose (~260-266):** update step 9 to: while reviewing, source edits
   are NOT committed (the `reviewPresent` gate); a pure-tick approval with nothing
   left over closes the review; any note or `!!` routes to `review-process`, which
   records reference commit `x`, synthesizes `TODO.md`, then `git revert`s `x` and
   closes with the anchor — leaving no artifact. Drop the
   "harvesting `!!` tokens …" clause.

## Constraints

- Keep all other README sections intact.
- Follow the global instruction: every significant change reflected in the README
  (this task IS that reflection).

## Acceptance criteria

- [ ] The `code-changes` and `review-process` table rows describe the
      `reviewPresent` gate and the revert teardown.
- [ ] The `!!` note no longer claims verbatim harvesting into TODO.md and no
      longer says reviewer edits arrive already committed; it states they are
      captured into commit `x` and reverted.
- [ ] The mermaid edges/nodes reflect: no `code-changes` while reviewing; commit
      `x` → TODO.md → revert → close anchor.
- [ ] Workflow step 9 prose matches the new teardown.
- [ ] No build/test impact (docs only).
