# Slice A — `review-process` records raw feedback before reset

## Description

Edit the static prompt markdown `src/prompts/review-process.md` so that the
reviewer's dirty working tree is committed **verbatim** as a dedicated commit
BEFORE the existing reset sequence discards it. This preserves the user-authored
review artifacts (annotated `REVIEW.md`, source edits, in-place `TODO:` markers)
in git history.

This is a **static prompt markdown edit only** — `src/prompts/review-process.md`
is emitted verbatim by `src/Prompt.ts`. Do NOT change any TypeScript / state
machine logic. The plan establishes that no state-machine change is required:
commits are classified only by the `isFixGtd` regex
(`src/Events.ts:163` — `/^fix\(gtd\):/`), so the new `docs(review): ...` commit
folds as an ordinary commit and is never selected as a review base. As part of
this task, sanity-check that assumption holds (grep `src/Events.ts` and
`src/Machine.ts` for any other special-casing of `docs(` commit subjects); if
something special-cases it, STOP and flag it rather than editing TS.

## What to change in `src/prompts/review-process.md`

Insert a new step **before** the current "Step 6: Reset" that instructs the
agent to commit the reviewer's entire dirty tree verbatim:

- Stage and commit everything currently dirty (annotated `REVIEW.md` including
  its checkboxes, all source edits, any untracked files the reviewer added,
  in-place `TODO:` markers) with NO modification.
- Use the base ref noted at the top of `REVIEW.md` (the `<!-- base: … -->`
  comment) in the commit subject:

  ```
  docs(review): record raw feedback for <base>
  ```

- The existing reset (`git add TODO.md` → `git checkout -- .` → `git clean -fd`
  → `rm REVIEW.md`) and the synthesis commit
  (`docs(review): process review feedback into TODO.md`) then run unchanged ON
  TOP of this raw-feedback commit. History keeps both the raw artifact and the
  actionable distillation. The second commit reverting the source edits is
  acceptable churn — note this so the agent does not try to avoid it.

Keep all existing steps intact; renumber subsequent steps as needed so the
document stays coherent. Do not change the reset order or the existing synthesis
commit message.

## Cucumber scenarios (required by AGENTS.md)

Add scenarios to `tests/integration/features/review.feature` asserting the
emitted prompt stdout carries the new instruction. Follow the existing patterns
in that file exactly:

- Reuse the existing composable, content-revealing `Given` steps already defined
  in `tests/integration/support/steps/common.steps.ts`:
  - `a test project`
  - `a commit {string} that adds {string} with:` (to seed `REVIEW.md` via a
    `review(gtd): create review for <hash>` commit)
  - `{string} is modified to:` (to dirty `REVIEW.md` with real feedback prose so
    the run routes to `review-process`, NOT `close-review`)
  - optionally `a file {string} with:` (to add an untracked source edit)
- Assert via the existing `stdout contains {string}` / `stdout does not contain
  {string}` steps.
- Do NOT invent new `Given` steps unless genuinely needed; if you must add one,
  make it generic and content-revealing (one step = one commit), and put it in
  `common.steps.ts`.

At minimum, add a scenario that:
- Seeds a `review(gtd): create review for <hash>` commit adding `REVIEW.md` with
  a `<!-- base: … -->` comment, then modifies `REVIEW.md` to add real feedback
  prose.
- Runs gtd and asserts `stdout contains "# Process Review Feedback"` AND that the
  emitted prompt mentions recording raw feedback before the reset — assert on the
  literal commit subject string `docs(review): record raw feedback for` (this is
  the load-bearing new instruction; matching the exact emitted text keeps the
  test honest).

## Relevant files

- `/Users/pmelab/Code/gtd/gtd/src/prompts/review-process.md` (edit — the prompt)
- `/Users/pmelab/Code/gtd/gtd/src/Prompt.ts` (read only — confirms the md is
  emitted verbatim)
- `/Users/pmelab/Code/gtd/gtd/src/Events.ts` (read only — `isFixGtd` at line
  163, verify the no-TS-change assumption)
- `/Users/pmelab/Code/gtd/gtd/src/Machine.ts` (read only — verify nothing
  special-cases `docs(` subjects)
- `/Users/pmelab/Code/gtd/gtd/tests/integration/features/review.feature` (add
  scenarios)
- `/Users/pmelab/Code/gtd/gtd/tests/integration/support/steps/common.steps.ts`
  (reuse existing steps; add a generic one only if necessary)

## Constraints / edge cases

- Retain `REVIEW.md` VERBATIM in the raw-feedback commit, INCLUDING checkboxes —
  it is the user's artifact. (Answered in TODO.md: yes, verbatim.)
- The pure-check-off case never reaches `review-process` (`close-review` in
  `Machine.ts:141` intercepts forward-only ticks first), so the raw-feedback
  commit always contains real feedback — no need to guard for "empty feedback".
- Use the base ref from the `<!-- base: … -->` comment; the existing prompt
  already reads it in Step 1. If the comment is missing, gtd errors out before
  the prompt is reached (see the "missing base ref" scenario) — do not add new
  handling for that.
- This is a static markdown edit — no TypeScript logic change. If TS appears
  necessary, STOP and flag it.

## Acceptance criteria

- [ ] `src/prompts/review-process.md` has a new step BEFORE the reset that
      commits the reviewer's dirty tree verbatim as
      `docs(review): record raw feedback for <base>`, using the base ref from the
      `<!-- base: … -->` comment.
- [ ] The existing reset sequence and the
      `docs(review): process review feedback into TODO.md` synthesis commit are
      unchanged and now run on top of the raw-feedback commit; steps renumbered
      coherently.
- [ ] No TypeScript / state-machine files were modified; the
      `isFixGtd`-only-classification assumption was verified (no special-casing
      of `docs(` subjects found, or flagged if found).
- [ ] New cucumber scenario(s) added to `review.feature` asserting the emitted
      prompt mentions recording raw feedback before reset (asserts
      `stdout contains "docs(review): record raw feedback for"`), reusing the
      existing composable `Given` steps.
- [ ] The cucumber test suite passes.
