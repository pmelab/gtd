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

3. Append new questions to `## Open Questions` in the same format:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

4. If `## Open Questions` is now empty, delete the heading

### After the subagent completes

Commit `TODO.md`.
