# Task: Add format instruction to TODO-editing prompts

Add a "now run the formatter" instruction to every prompt that emits or edits
`TODO.md`.

## Prompts to update

- `src/prompts/new-todo.md` — after step 6 (or just before the
  "After the subagent completes" section), add an instruction to run the
  formatter on `TODO.md`.
- `src/prompts/modified-todo.md` — append the same instruction at the end of the
  editing steps.
- `src/prompts/decompose.md` — when `.gtd/<package>/TODO.md` (or any TODO files)
  are written, run the formatter on each.

## Instruction phrasing

Give the exact command line:
`node scripts/gtd.js format TODO.md` (or the appropriate path). Phrase it as
"the same `scripts/gtd.js` you ran to get this prompt, with `format <file>`
appended" so consumer-repo agents reuse whatever absolute path they already
invoked.

## Acceptance criteria

- [ ] Each listed prompt contains a clear instruction to run the formatter on
      every TODO.md it writes/edits.
- [ ] Instruction includes the literal `format <file>` subcommand syntax.
- [ ] Instruction mentions reusing the same `scripts/gtd.js` path that produced
      the prompt.
- [ ] `Prompt.test.ts` updated to assert the instruction is present in each
      updated prompt.

## Files

- `src/prompts/new-todo.md` (edit)
- `src/prompts/modified-todo.md` (edit)
- `src/prompts/decompose.md` (edit)
- `src/Prompt.test.ts` (edit — add assertions)
