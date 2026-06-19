# Update new-todo.md prompt

## Description

Update `src/prompts/new-todo.md` to instruct the planning subagent to place `## Open Questions` at the TOP of TODO.md (before the plan body) and create an empty `## Answered Questions` section at the bottom.

## File to Modify

`src/prompts/new-todo.md`

## Changes

### Change 1: Update point 4

**Old text:**
```markdown
4. Append unresolved questions to a `## Open Questions` section at the end,
   each formatted as:
```

**New text:**
```markdown
4. Place unresolved questions in a `## Open Questions` section at the TOP of
   the file (before the plan body), each formatted as:
```

### Change 2: Update point 5

**Old text:**
```markdown
5. Keep the original plan content above `## Open Questions` and expand it
   where confident from docs and codebase reading
```

**New text:**
```markdown
5. Keep the original plan content BELOW `## Open Questions` and expand it
   where confident from docs and codebase reading

6. Add an empty `## Answered Questions` section at the bottom of the file
   (questions will be moved here when answered in future iterations)
```

## Acceptance Criteria

- [ ] Point 4 instructs placing `## Open Questions` at TOP of file
- [ ] Point 5 says plan content goes BELOW open questions
- [ ] New point 6 instructs creating empty `## Answered Questions` at bottom
- [ ] File compiles without syntax errors (markdown is valid)
