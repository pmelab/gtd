# Task: Enhance `new-todo.md` with Grilling Question Discipline

## File to modify

`src/prompts/new-todo.md`

## Current content (complete)

```markdown
## Task: Develop the plan in `TODO.md`

A new `TODO.md` was created. It needs to be developed into a proper plan.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** to
develop the plan. Check your user/project AGENTS.md for model preferences
(e.g., "use opus for planning"). If no preference is set, default to a
high-reasoning model like Claude Opus.

The subagent should:

1. Treat the contents of `TODO.md` as the user's first sketch
2. Interview the plan relentlessly: walk every branch of the design tree,
   sharpen terminology, challenge each decision against the existing domain
   model and documentation
3. Do this entirely by editing `TODO.md` — the subagent cannot talk to the user
4. Append unresolved questions to a `## Open Questions` section at the end,
   each formatted as:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

5. Keep the original plan content above `## Open Questions` and expand it
   where confident from docs and codebase reading

### After the subagent completes

Commit `TODO.md` with the developed plan.
```

## Source intelligence to embed (from grill-me skill)

> Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
>
> **If a question can be answered by exploring the codebase, explore the codebase instead.**

## What to change

Enhance bullet point 2 in "The subagent should:" section with grilling discipline:

### Current bullet 2:
```markdown
2. Interview the plan relentlessly: walk every branch of the design tree,
   sharpen terminology, challenge each decision against the existing domain
   model and documentation
```

### New bullet 2 (expanded):
```markdown
2. Interview the plan relentlessly using this discipline:
   - **Explore before asking**: If a question can be answered by exploring the
     codebase or project docs, explore instead of asking
   - **Prioritize high-stakes questions**: Ask questions that most affect
     implementation first — hard-to-reverse decisions before easy-to-change ones
   - **Walk branches completely**: Group related questions by decision branch
     so the user can resolve one branch fully before moving to the next
   - **Every question advances a decision**: Avoid questions that don't change
     implementation — each question must have a concrete effect on the plan
```

## Acceptance criteria

- [ ] Bullet 2 is expanded from 3 lines to ~8 lines with sub-bullets
- [ ] Contains "explore before asking" rule (check codebase/docs first)
- [ ] Contains "prioritize high-stakes questions" rule (hard-to-reverse first)
- [ ] Contains "walk branches completely" rule (group related questions)
- [ ] Contains "every question advances a decision" rule (no idle questions)
- [ ] Original context about design tree/terminology/domain model is preserved
- [ ] File is pure markdown, no TypeScript changes
