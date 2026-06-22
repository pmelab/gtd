# Review: d9ab086

<!-- base: d9ab0867961420a1f2b548759dfa796172707707 -->

## Short-circuit review base when HEAD is a review/close commit

Adds a frontier-at-HEAD guard to `computeReviewBase`: if HEAD itself is the
latest `review(gtd)` or `chore(gtd): close` bookkeeping commit, return
`Option.none` so nothing is re-surfaced for review. Without it the function
would fall back to an older candidate and diff it against HEAD, re-proposing the
close commit's own changes as a fresh review forever. The old equality-check
`headHash` resolution is moved up to serve the new guard.

- [ ] ./src/Events.ts#85
- [ ] ./src/Events.ts#109

## review-process records raw feedback before reset

New Step 6 in the review-process prompt instructs committing the reviewer's
entire dirty tree verbatim as `docs(review): record raw feedback for <base>`
(annotated `REVIEW.md` incl. checkboxes, source edits, untracked files, in-place
`TODO:` markers) before the existing reset + synthesis run on top. Preserves the
user's raw feedback in history; the synthesis commit reverting source edits is
accepted churn. Subsequent steps renumbered (7: Reset, 8: Commit).

- [ ] ./src/prompts/review-process.md#60
- [ ] ./tests/integration/features/review.feature#92

## decompose records TODO.md before deleting it

New guarded step in the decompose prompt: if `TODO.md` is untracked or differs
from HEAD, commit it as `docs(plan): record TODO.md` before deletion —
preserving the plan and its `## Open Questions` / `## Answered Questions`
history on the direct-to-decompose path. No-op in the normal
`new-todo`/`modified-todo` flow where the plan is already committed. Subsequent
steps renumbered.

- [ ] ./src/prompts/decompose.md#59
- [ ] ./tests/integration/features/branches.feature#80

## Document retain-as-commit behavior in README

Updates the states table (review-process and decompose rows), the workflow
walkthrough (steps 5 and 9), and the Build orchestration → Decompose section to
describe that user-authored content lands as a real commit before gtd transforms
or discards it. Commit subjects match the prompts verbatim.

The `scripts/gtd.js` bundle is a generated build artifact (rebuilt from the
edited prompts); not reviewed line-by-line.

- [ ] ./README.md#55
- [ ] ./README.md#145
- [ ] ./README.md#176
