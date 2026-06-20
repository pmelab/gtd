# Task: Audit remaining prompts and add format instruction where needed

Audit the rest of the prompt templates for paths where the agent edits
`TODO.md` or `REVIEW.md`. Add the formatter instruction wherever such an edit
occurs.

## Prompts to audit

- `src/prompts/execute-simple.md`
- `src/prompts/execute.md`
- `src/prompts/code-changes.md`
- `src/prompts/todo-markers.md`
- `src/prompts/cleanup.md`
- `src/prompts/verify.md`
- Any partials under `src/prompts/partials/` that touch TODO.md / REVIEW.md.

For each, read the prompt; if it tells the agent to write or edit `TODO.md` or
`REVIEW.md`, add an instruction immediately after that step to run
`node scripts/gtd.js format <file>` (reusing the same `scripts/gtd.js` path).

If a prompt does **not** edit those files, leave it alone and note that in the
PR description.

## Acceptance criteria

- [ ] Every listed prompt audited.
- [ ] Formatter instruction added wherever `TODO.md` / `REVIEW.md` is written or
      edited.
- [ ] `Prompt.test.ts` updated to assert the instruction is present in each
      prompt that now contains it.
- [ ] No spurious instruction added to prompts that don't edit those files.

## Files

- `src/prompts/execute-simple.md` (edit if needed)
- `src/prompts/execute.md` (edit if needed)
- `src/prompts/code-changes.md` (edit if needed)
- `src/prompts/todo-markers.md` (edit if needed)
- `src/prompts/cleanup.md` (edit if needed)
- `src/prompts/verify.md` (edit if needed)
- `src/prompts/partials/*.md` (edit if needed)
- `src/Prompt.test.ts` (edit)
