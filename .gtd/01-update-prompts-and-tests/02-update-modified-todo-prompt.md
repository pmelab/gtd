# Update modified-todo.md prompt

## Description

Update `src/prompts/modified-todo.md` to instruct the planning subagent to MOVE answered questions to `## Answered Questions` at the bottom instead of REMOVING them. The user's answer should be preserved below the recommendation.

## File to Modify

`src/prompts/modified-todo.md`

## Changes

### Change 1: Update point 1

**Old text:**
```markdown
1. For each answered question, integrate the answer into the body of the plan
   above `## Open Questions` and remove the question from the section
```

**New text:**
```markdown
1. For each answered question:
   - Integrate the answer into the body of the plan
   - Move the question to `## Answered Questions` at the bottom of the file
   - Keep the question heading and `**Recommendation:**` block
   - Replace `<!-- user answers here -->` with `**Answer:**` followed by the user's response
   - Example format in Answered Questions:
     ```markdown
     ### What operations?

     **Recommendation:** add, subtract.

     **Answer:** add, subtract, multiply, divide
     ```
```

### Change 2: Update point 3

**Old text:**
```markdown
3. Append new questions to `## Open Questions` in the same format:
```

**New text:**
```markdown
3. Keep new questions in `## Open Questions` at the TOP of the file, in the same format:
```

### Change 3: Update point 4

**Old text:**
```markdown
4. If `## Open Questions` is now empty, delete the heading
```

**New text:**
```markdown
4. If `## Open Questions` is now empty, delete the heading (but keep
   `## Answered Questions` with the resolved questions)
```

### Change 4: Add migration note (new point 5)

Add after point 4:
```markdown
5. If processing an old-format TODO.md where `## Open Questions` is at the
   bottom, migrate it: move the section to the top and create
   `## Answered Questions` at the bottom
```

## Acceptance Criteria

- [ ] Point 1 instructs moving answered questions to `## Answered Questions` instead of removing
- [ ] Point 1 shows the exact format with `**Answer:**` prefix
- [ ] Point 3 clarifies questions stay at TOP
- [ ] Point 4 mentions keeping `## Answered Questions`
- [ ] Point 5 handles migration of old-format files
- [ ] File compiles without syntax errors (markdown is valid)
