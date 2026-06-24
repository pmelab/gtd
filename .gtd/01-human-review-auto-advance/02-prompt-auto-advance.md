# Replace the human-review prompt's closing STOP with the auto-advance instruction

`human-review` now auto-advances (sibling task 01 adds the `auto-advance` tag),
so the prompt must tell the agent to re-run gtd instead of STOPping. Mirror the
precedent producer prompts' phrasing.

This task is vitest-neutral — prompt text is only exercised by `npm run test:e2e`
(the feature inversion lives in a sibling task). It touches exactly one file, so
it is file-disjoint from every other task in this package.

## Files (exclusive to this task)

- `src/prompts/human-review.md`

## What to do

- Replace the closing STOP paragraph (lines 70–72):

  ```
  After writing `REVIEW.md` and the marker, **STOP**. Do not re-run gtd. The user
  must review and edit `REVIEW.md` before proceeding; the next run they trigger
  commits it.
  ```

  with the auto-advance instruction, mirroring `new-todo.md:72` ("Re-run gtd —
  the next cycle commits the developed `TODO.md` and deletes the marker.") and
  `modified-todo.md:81` ("Re-run gtd — the next cycle commits `TODO.md` and
  deletes the marker."). Use the parallel phrasing for review, e.g.:

  ```
  Re-run gtd — the next cycle commits `REVIEW.md` and deletes the marker, then
  stops at the human-review gate for the user to work through it.
  ```

- Keep steps 1–6 (generate `REVIEW.md` + `format` + write the `.gtd-commit-intent`
  marker) exactly as-is. Step 6's note (lines 66–68) already describes the edge
  commit and STAYS unchanged.
- The word "STOP" must no longer appear in this prompt (the e2e inversion asserts
  `stdout does not contain "STOP"` for the human-review prompt).

## Constraints

- Do NOT touch the marker contents (`human-review`) or the `format REVIEW.md`
  step.
- Do NOT touch `src/Machine.ts`, tests, README, or the bundle.

## Acceptance criteria

- [ ] The closing STOP paragraph is replaced by a "Re-run gtd — the next cycle
      commits `REVIEW.md` and deletes the marker …" instruction matching the
      `new-todo.md` / `modified-todo.md` precedent.
- [ ] Steps 1–6 and step 6's edge-commit note are unchanged.
- [ ] The string "STOP" no longer appears anywhere in `src/prompts/human-review.md`.
