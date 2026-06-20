# Task: Add format instruction to REVIEW-editing prompts

Add a "now run the formatter" instruction to every prompt that emits or edits
`REVIEW.md`.

## Prompts to update

- `src/prompts/review-create.md` — after step 4 (writing REVIEW.md) and before
  step 5 (commit), add: "Run `node scripts/gtd.js format REVIEW.md`."
- `src/prompts/review-process.md` — after any edits to `REVIEW.md`, run the
  formatter.

## Instruction phrasing

Same convention as the TODO prompts: give the exact command line and tell the
agent to reuse the same `scripts/gtd.js` path it already invoked.

## Acceptance criteria

- [ ] `review-create.md` instructs the agent to run the formatter on
      `REVIEW.md` between writing it and committing.
- [ ] `review-process.md` instructs the agent to run the formatter after
      editing `REVIEW.md`.
- [ ] Instructions use the literal `format <file>` subcommand syntax.
- [ ] `Prompt.test.ts` updated with assertions on the new instructions.

## Files

- `src/prompts/review-create.md` (edit)
- `src/prompts/review-process.md` (edit)
- `src/Prompt.test.ts` (edit — add assertions)
