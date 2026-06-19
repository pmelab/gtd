# Auto-advance after step completion

gtd should automatically re-run after completing a step, continuing until user interaction is needed or work is done.

## Open Questions

### What's the exact auto-advance phrasing?

Given context: `node scripts/gtd.js` outputs a complete prompt. The consuming agent must follow that prompt's instructions.

**Proposed phrasing:**

```
### After completion

Re-run `node scripts/gtd.js` and follow the output as your next task. Do not stop or ask the user for confirmation.
```

This captures:
- Re-run the command
- Follow what it outputs (the prompt's task sections)
- Don't pause for user

Is this sufficient, or does it need to be more explicit about "the output is your next prompt"?

## Plan

### Implementation

1. **Create auto-advance partial** (`src/prompts/partials/auto-advance.md`)
   - Contains the standardized re-run instruction
   - Export as default

2. **Update prompt templates to include auto-advance**
   
   Add auto-advance to:
   - `new-todo.md` - after "Commit `TODO.md`"
   - `modified-todo.md` - after "Commit `TODO.md`"
   - `decompose.md` - replace passive "next invocation" with active re-run
   - `execute.md` - after all packages complete / cleanup note
   - `cleanup.md` - after ".gtd/ deletion" instruction  
   - `code-changes.md` - after commit instruction
   - `todo-markers.md` - replace passive "next invocation" with active re-run
   - `review-process.md` - after final commit

3. **Update prompts that should NOT auto-advance**
   
   - `verify.md` - add explicit STOP instruction when tests pass
   - `review-create.md` - add explicit STOP instruction (user must edit REVIEW.md)

4. **Update Prompt.ts** to import and compose the partial

5. **Add cucumber tests**
   
   New feature file: `tests/integration/features/auto-advance.feature`
   
   Scenarios to test:
   - Each prompt that should auto-advance contains the re-run instruction
   - verify.md contains STOP instruction when describing success path
   - review-create.md contains STOP instruction

### File changes summary

| File | Change |
|------|--------|
| `src/prompts/partials/auto-advance.md` | NEW - reusable partial |
| `src/prompts/new-todo.md` | Append auto-advance |
| `src/prompts/modified-todo.md` | Append auto-advance |
| `src/prompts/decompose.md` | Replace passive text + append auto-advance |
| `src/prompts/execute.md` | Replace passive text + append auto-advance |
| `src/prompts/cleanup.md` | Append auto-advance |
| `src/prompts/code-changes.md` | Append auto-advance |
| `src/prompts/todo-markers.md` | Replace passive text + append auto-advance |
| `src/prompts/review-process.md` | Append auto-advance |
| `src/prompts/verify.md` | Add explicit STOP at success |
| `src/prompts/review-create.md` | Add explicit STOP |
| `src/Prompt.ts` | Import partial, compose into build |
| `tests/integration/features/auto-advance.feature` | NEW - test coverage |

## Answered Questions

### Should auto-advance be a new footer partial or inline in each prompt?

**Decision:** Partial (`src/prompts/partials/auto-advance.md`)

Cleaner than duplicating text in 9 files. Import and append to relevant prompts in Prompt.ts.

### Should verify have an explicit "STOP" terminal marker?

**Decision:** Yes

Currently verify.md says "done, report success" which is vague. Add explicit terminal instruction:

```
If all pass → report success and STOP. Do not re-run gtd. The working tree is healthy and there is no pending work.
```

Prevents infinite loops where verify keeps re-running itself.

### What happens when the partial approach combines with Prompt.ts imports?

**Decision:** Prompt.ts composes the partial into templates that need it.

Templates that auto-advance get the partial appended. Terminal prompts (verify success, review-create) get explicit STOP instead.
