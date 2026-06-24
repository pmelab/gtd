# Rewrite spec-harvest.feature for added-line harvest semantics

The current scenarios commit the `!!` in a `feat:` commit that PRECEDES the
`review(gtd): create review …` commit. That ordering is unrealistic — `!!`
comments are always introduced DURING the review session, after the review-create
commit. Rewrite every scenario so the `!!` is introduced as a WORKING-TREE edit
AFTER the review-create commit, matching how the diff-based harvest works.

## Files

- `tests/integration/features/spec-harvest.feature`

The composable Given step `"<file>" is modified to:` ALREADY EXISTS in
`tests/integration/support/steps/common.steps.ts` (line ~30) and writes to the
working tree WITHOUT committing — exactly what we need. NO new step definition is
required, so this task does NOT touch `common.steps.ts`.

## What to do

For each scenario, restructure the fixture ordering to:

1. Commit the source file CLEAN (no `!!`) — or simply omit it — at/before the
   review-create commit.
2. Commit `review(gtd): create review for abc1234` adding `REVIEW.md`.
3. Introduce the `!!` as a working-tree edit AFTER that commit, via
   `And "<file>" is modified to:` with the file body now containing the `!!`
   line. This surfaces it as an added line in `git diff <reviewCommit>`.
4. Tick the REVIEW.md chunk via the existing `And "REVIEW.md" is modified to:`
   step as before.

Note: a single scenario can have multiple `"<file>" is modified to:` steps (one
to add the `!!` to the source, one to tick REVIEW.md) — they are independent
working-tree writes.

Scenarios to keep / adjust:

- "A checked review plus a `!!` comment loops and harvests the comment" — source
  committed clean, `!!` added after review commit; still asserts stdout contains
  the comment text and "# Process Review Feedback".
- "The `!!` marker is recognized regardless of comment syntax" (`# !!` python) —
  same restructuring.
- "Harvesting captures the `!!` text verbatim without parsing intent" — same.
- "A plain `TODO:` marker is ordinary code and does not block conclusion" — add
  the `TODO:` line after the review commit; assert it routes to Close (not
  harvested), `stdout does not contain "# Process Review Feedback"`.

Scenarios to ADD / re-purpose:

- "Unreferenced reviewer-added `!!` IS harvested": the `!!`-bearing file is NOT
  listed in REVIEW.md's chunk refs, yet because it is an added line since the
  review commit, the diff-based harvest STILL catches it. Assert
  `# Process Review Feedback` and the comment text appear. (This is the inverse of
  the old "unreferenced file is NOT harvested" scenario — under the new semantics
  file membership is irrelevant; added-ness is what matters.)
- False-positive guard "A `!!` committed AT/BEFORE the review commit is NOT
  harvested": commit a file containing a `!!` BEFORE the review-create commit and
  leave it untouched in the working tree; tick REVIEW.md only. Assert it routes to
  `## Task: Close the approved review` and `stdout does not contain` the
  pre-existing `!!` text (proving older `!!` are ignored). This replaces the old
  `xyzzy-sentinel` out-of-scope scenario — reuse a sentinel string to assert
  non-harvest.

Update the file's leading comment block (lines 1-5) if it still says `!!` are
"stripped from the code" — harvest is now read-only; the reset removes them.

## Acceptance criteria

- [ ] Every scenario introduces its `!!` AFTER the `review(gtd): create review …`
      commit via `"<file>" is modified to:` (no `!!` committed before review in
      the "harvested" scenarios).
- [ ] An "unreferenced reviewer-added `!!` IS harvested" scenario exists and
      passes.
- [ ] A false-positive guard scenario proves a `!!` committed at/before the
      review commit is NOT harvested.
- [ ] The `TODO:`-is-not-harvested scenario is retained under the new ordering.
- [ ] `npm run test:e2e` passes (the BeforeAll hook rebuilds the bundle from the
      package-01 src, so the new harvest behavior is live).

## Constraints / edge cases

- File-disjoint: touches ONLY the `.feature` file. Do NOT edit `common.steps.ts`
  (the needed step already exists) — keep this task disjoint from the code tasks.
- Keep the `<!-- base: … -->` line in REVIEW.md fixtures (Events.ts requires a
  parseable base ref or it errors).
- The review-create commit subject must literally start with
  `review(gtd): create review for ` so `lastReviewCommit()` matches it.
