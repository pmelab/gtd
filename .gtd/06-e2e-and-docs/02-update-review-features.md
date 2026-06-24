# Update `review.feature`, `spec-review-conclude.feature`, `spec-verbatim-first.feature`

Bring the remaining review e2e features in line with the new four-outcome routing
(`await-review` / `review-incomplete` / `close-review` / `review-process`) and the
edge-driven review-process (slimmed prompt — no git machinery strings).

## `tests/integration/features/review.feature`

- Scenarios that previously expected `review-process` for an UNCHECKED-box state
  must now expect `review-incomplete`. Specifically:
  - "Un-ticking a checkbox routes to review-process, not close-review" (committed
    `- [x]`, working `- [ ]`) → now routes to `review-incomplete`: assert stdout
    shows the review-incomplete human-gate text + `STOP`, and does NOT contain
    `# Process Review Feedback` or `## Task: Close the approved review`.
  - Any other scenario whose working-tree REVIEW.md still has a `- [ ]` line now
    routes to `review-incomplete` (unchecked-boxes gate wins first) — audit each
    and fix the expectation. The scenarios with prose/source-edit feedback should
    set ALL boxes to `- [x]` so they keep routing to `review-process` (real
    feedback, no unchecked boxes).
- Scenarios asserting the OLD edge-driven prompt strings must be updated, because
  the slimmed `review-process.md` no longer contains them. Remove/replace asserts
  for `git revert --no-edit`, `docs(review): record raw feedback for`, and
  `chore(gtd): close approved review` in the review-process scenarios (the
  "instructs recording raw feedback", "instructs committing TODO.md and REVIEW.md
  deletion together", and "instructs creating TODO.md and deleting REVIEW.md"
  scenarios). Replace with asserts on `# Process Review Feedback` and the
  synthesis/`TODO.md` instructions. KEEP the `close-review` scenario asserting
  `## Task: Close the approved review` + `chore(gtd): close approved review`
  (that string IS still in the close-review prompt).
- ADD a new scenario: an unchecked-box review STOPs at `review-incomplete`
  (assert the gate text + `STOP`, exit 0).
- KEEP unchanged: the await-review gate scenario, the missing-base-ref error
  scenario, and the two post-close `verified` regression scenarios.

## `tests/integration/features/spec-review-conclude.feature`

- KEEP "All boxes checked with no leftover work concludes…" → `close-review`.
- KEEP the "leftover note" and "human source edit" scenarios → `review-process`,
  but ensure their REVIEW.md has ALL boxes ticked (no `- [ ]`) so they don't trip
  the new `review-incomplete` gate; and drop any assertion on the old
  `review-process` git-machinery strings.
- ADD a scenario: all boxes NOT yet ticked (a `- [ ]` remains) → `review-incomplete`.

## `tests/integration/features/spec-verbatim-first.feature`

- The two non-review verbatim scenarios are unchanged (no REVIEW.md present →
  `code-changes`).
- "Review gate routes human edits to review-process when REVIEW.md is present"
  currently leaves a `- [ ]` box (`./src/bar.ts#5`) unticked while adding a
  source file. Under the new rules an unchecked box now routes to
  `review-incomplete`, NOT `review-process`. Either (a) tick ALL boxes so it
  routes to `review-process` (keeping the "not code-changes" assertion and
  swapping the prompt assertion to `# Process Review Feedback` only — drop the
  `git revert` assert since the prompt is slimmed), or (b) re-point the scenario
  to assert `review-incomplete`. Prefer (a) to preserve the original intent
  (source edit during review is feedback). Adjust/remove any `!!` mention.

## Acceptance criteria

- [ ] Unchecked-box scenarios across all three features expect `review-incomplete`.
- [ ] Real-feedback (all-ticked + note/source/untracked) scenarios expect
      `review-process` and assert only on `# Process Review Feedback` /
      synthesis text (NOT on `git revert` / record / close strings).
- [ ] `close-review` scenarios unchanged and green.
- [ ] A new `review-incomplete` STOP scenario exists.
- [ ] `npm run test:e2e` passes for these features.

## Files

- `tests/integration/features/review.feature`
- `tests/integration/features/spec-review-conclude.feature`
- `tests/integration/features/spec-verbatim-first.feature`

## Constraints / edge cases

- Use the existing composable `Given` steps; expose REVIEW.md content in the
  scenario text (AGENTS.md conventions).
- The edge runs real git ops for `review-process`; temp repos already use real
  commits so record/revert/close succeed and the run exits 0.
- File-disjoint from the spec-harvest task (task 01) and the README task
  (task 03).
