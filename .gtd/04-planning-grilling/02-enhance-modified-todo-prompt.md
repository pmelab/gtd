# Task: Enhance `modified-todo.md` with Grilling Question Discipline

## File to modify

`src/prompts/modified-todo.md`

## Current content (complete)

```markdown
## Task: Incorporate edits to `TODO.md` and keep developing the plan

`TODO.md` exists in `HEAD` and the user has edited it. The edits are answers
to questions in `## Open Questions` (written inline below each question,
replacing the `<!-- user answers here -->` placeholder), plus any free-form
changes to the plan.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** to
continue developing the plan. Check your user/project AGENTS.md for model
preferences (e.g., "use opus for planning"). If no preference is set, default
to a high-reasoning model like Claude Opus.

The subagent should:

1. For each answered question, integrate the answer into the body of the plan
   above `## Open Questions` and remove the question from the section

2. Continue the grilling session: every new piece of information opens new
   branches of the design tree. Generate fresh questions for any ambiguity
   the answers surfaced — sharpening terminology and challenging decisions
   against the existing domain model

3. Append new questions to `## Open Questions` in the same format:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

4. If `## Open Questions` is now empty, delete the heading

### After the subagent completes

Commit `TODO.md`.
```

## Source intelligence to embed (from grill-me skill)

> Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
>
> **If a question can be answered by exploring the codebase, explore the codebase instead.**

## What to change

Enhance bullet point 2 in "The subagent should:" section with grilling discipline:

### Current bullet 2:
```markdown
2. Continue the grilling session: every new piece of information opens new
   branches of the design tree. Generate fresh questions for any ambiguity
   the answers surfaced — sharpening terminology and challenging decisions
   against the existing domain model
```

### New bullet 2 (expanded):
```markdown
2. Continue the grilling session using this discipline:
   - **Explore before asking**: If a question can be answered by exploring the
     codebase or project docs, explore instead of asking
   - **Prioritize high-stakes questions**: Ask questions that most affect
     implementation first — hard-to-reverse decisions before easy-to-change ones
   - **Walk branches completely**: Group related questions by decision branch
     so the user can resolve one branch fully before moving to the next
   - **Every question advances a decision**: Avoid questions that don't change
     implementation — each question must have a concrete effect on the plan
   - Every new piece of information opens new branches; generate fresh questions
     for any ambiguity the answers surfaced
```

## Acceptance criteria

- [ ] Bullet 2 is expanded from 4 lines to ~9 lines with sub-bullets
- [ ] Contains "explore before asking" rule (check codebase/docs first)
- [ ] Contains "prioritize high-stakes questions" rule (hard-to-reverse first)
- [ ] Contains "walk branches completely" rule (group related questions)
- [ ] Contains "every question advances a decision" rule (no idle questions)
- [ ] Preserves the "new info opens new branches" concept from original
- [ ] File is pure markdown, no TypeScript changes
