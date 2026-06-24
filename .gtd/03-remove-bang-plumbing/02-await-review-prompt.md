# Drop the `!!` clause from `await-review.md`

The marker convention is gone — the await-review human-gate prompt must no longer
tell the human to "drop `!!` follow-up comments".

## What to do (`src/prompts/await-review.md`)

- In `## What the human must do`, step 3 currently reads:
  "Optionally leave notes inline, edit source files, or drop `!!` follow-up
  comments in the code for anything that needs more work."
  Remove the `!!` clause, keeping the rest, e.g.:
  "Optionally leave notes inline or edit source files for anything that needs
  more work."
- No other change to the file.

## Acceptance criteria

- [ ] No `!!` mention remains in `src/prompts/await-review.md`.
- [ ] The "edit source files / leave notes" guidance is preserved.
- [ ] `npm run test` green (no gated unit test asserts the `!!` text here, but
      verify the build still embeds the prompt).

## Files

- `src/prompts/await-review.md`

## Constraints

- File-disjoint from the `Git.ts`/`Git.test.ts` task in this package.
