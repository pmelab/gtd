# Replace passive "next invocation" text in prompts

Update prompts that currently use passive language like "The next `/gtd` invocation will..." to use active language that works with auto-advance.

## What to build

Update these prompt templates to replace passive "next invocation" phrasing with active instructions that make sense when gtd auto-advances:

1. **`src/prompts/decompose.md`** — The last section says "The plan is now executable. The next `/gtd` invocation will begin execution." Replace with something like "The plan is now executable."

2. **`src/prompts/todo-markers.md`** — Says "The next `/gtd` invocation will see the uncommitted `TODO.md` and enter the planning phase..." Replace with active phrasing that doesn't reference "next invocation".

## Acceptance criteria

- [ ] `src/prompts/decompose.md` no longer contains "next `/gtd` invocation"
- [ ] `src/prompts/todo-markers.md` no longer contains "next `/gtd` invocation"
- [ ] Replacement text is accurate about what happens next
- [ ] No functional meaning is lost

## Relevant files

- `src/prompts/decompose.md` — find and replace passive text at end
- `src/prompts/todo-markers.md` — find and replace passive text near end

## Constraints

- Keep replacements minimal — only change the "next invocation" references
- Don't add auto-advance instructions here (that's handled by Prompt.ts composition)
