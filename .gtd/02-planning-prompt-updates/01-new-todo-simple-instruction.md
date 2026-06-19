# Add simple-task instruction to new-todo.md

## Description

Update the new-todo.md prompt to instruct the planning-model subagent to evaluate whether the task is simple and append `<!-- simple -->` marker when appropriate.

## Files to modify

- `src/prompts/new-todo.md`

## Implementation

Add a new numbered step (step 7) after the existing instructions, before "### After the subagent completes":

```markdown
7. **Evaluate task complexity**: When the plan is complete (no open questions
   remain in this iteration), assess whether the task is simple enough to skip
   decomposition:
   - Use judgment based on task scope and codebase context
   - Simple tasks typically: single-file change, no architectural decisions,
     obvious implementation, can be described in one sentence
   - If simple: append `<!-- simple -->` at the very end of TODO.md
   - If complex or uncertain: omit the marker (defaults to decompose path)
   
   Note: The user can later remove the marker if they want full decomposition,
   or add it manually to any plan.
```

## Acceptance criteria

- [ ] new-todo.md includes instruction about evaluating task complexity
- [ ] Instruction mentions appending `<!-- simple -->` at end of file
- [ ] Instruction mentions this applies when no open questions remain
- [ ] Instruction provides heuristics but emphasizes judgment
- [ ] Note about user override included
