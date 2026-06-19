# Update Prompt.ts to import and compose the partial

Wire the auto-advance partial into the prompt builder so it can be appended to relevant prompts.

## What to build

Update `src/Prompt.ts` to:
1. Import the auto-advance partial from `./prompts/partials/auto-advance.md`
2. Define which branches should auto-advance vs which should STOP
3. Append the auto-advance text after the task section for auto-advance branches

## Acceptance criteria

- [ ] `src/Prompt.ts` imports `autoAdvance` from `./prompts/partials/auto-advance.md`
- [ ] Auto-advance branches: `new-todo`, `modified-todo`, `decompose`, `execute`, `cleanup`, `code-changes`, `todo-markers`, `review-process`
- [ ] NON-auto-advance branches (STOP): `verify`, `review-create`
- [ ] `buildPrompt` appends the auto-advance text after task sections for auto-advance branches
- [ ] Non-auto-advance branches do NOT get the auto-advance text appended

## Relevant files

- `src/Prompt.ts` — the file to modify
- `src/State.ts` — defines `Branch` type

## Constraints

- Keep the approach simple: a Set or array of branch names that auto-advance, check membership in buildPrompt
- Don't modify the individual `.md` template files — composition happens in Prompt.ts
