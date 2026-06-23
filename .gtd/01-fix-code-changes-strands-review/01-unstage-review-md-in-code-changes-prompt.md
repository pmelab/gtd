# Task: Stop `code-changes` from committing `REVIEW.md`

## Problem

When the working tree has BOTH review feedback (an edited `REVIEW.md`) AND an
edit to some other source file, the `code-changes` leaf fires first (its
`codeDirty` guard sits above `reviewModified`). Its prompt
(`src/prompts/code-changes.md`) currently says `git add -A` then commit,
excluding only `TODO.md`. That sweeps the modified `REVIEW.md` into the commit,
so on the next run `REVIEW.md` is committed-and-unmodified → resolves to
`await-review` instead of `review-process`, silently stranding the reviewer's
notes.

This contradicts `src/Events.ts` (`codeEntries`, ~lines 212-214), which already
excludes BOTH `TODO.md` and `REVIEW.md` from the "code" set — the prompt must
match that contract.

## Change

Edit `src/prompts/code-changes.md`:

- After `git add -A`, instruct unstaging `REVIEW.md` the same way the prompt
  already handles `TODO.md`: `git restore --staged REVIEW.md` (only if present),
  leaving it pending/uncommitted.
- Update the "Important" note so it names BOTH control files (`TODO.md` and
  `REVIEW.md`) as excluded, and states why: `REVIEW.md` belongs to the review
  branch (review-process / await-review), not a code commit — committing it
  would strand reviewer feedback.

## Acceptance criteria

- [ ] `src/prompts/code-changes.md` instructs `git restore --staged REVIEW.md`
      (guarded on REVIEW.md being present) after `git add -A`, mirroring the
      existing `TODO.md` handling
- [ ] The "Important" note explicitly lists both `TODO.md` and `REVIEW.md` as
      excluded from the commit, with the reason for excluding `REVIEW.md`
- [ ] The instruction to commit the remaining source edits verbatim is preserved
- [ ] No other prompt or source file is touched by this task

## Files

- `src/prompts/code-changes.md` (only this file)

## Constraints / edge cases

- The unstage must be conditional / harmless when `REVIEW.md` is not staged
  (e.g. phrased "if present", same shape as the existing `TODO.md` line) so the
  common case (no REVIEW.md in the tree) still works.
- Prompt wording only — do not change any guard logic in `src/Events.ts` or
  `src/Machine.ts`; the `codeEntries` exclusion there is already correct.
