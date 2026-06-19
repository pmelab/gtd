# Add simple-task instruction to modified-todo.md

## Description

Update the modified-todo.md prompt to instruct the planning-model subagent to evaluate whether the task is simple and append `<!-- simple -->` marker when all questions are resolved.

## Files to modify

- `src/prompts/modified-todo.md`

## Implementation

Add a new numbered step (step 6) after step 5 (about migrating old-format TODO.md), before "### After the subagent completes":

```markdown
6. **Evaluate task complexity**: If `## Open Questions` is now empty (all
   questions resolved), assess whether the task is simple enough to skip
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

- [ ] modified-todo.md includes instruction about evaluating task complexity
- [ ] Instruction mentions appending `<!-- simple -->` at end of file
- [ ] Instruction is conditional on Open Questions being empty
- [ ] Instruction provides heuristics but emphasizes judgment
- [ ] Note about user override included
