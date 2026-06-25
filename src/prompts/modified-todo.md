## Task: Incorporate edits to `TODO.md` and keep developing the plan

`TODO.md` exists in `HEAD` and the user has edited it. The edits are answers to
questions in `## Open Questions` (written inline below each question, replacing
the `<!-- user answers here -->` placeholder), plus any free-form changes to the
plan.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** using
model `{{MODEL}}` to continue developing the plan.

The subagent should:

1. For each answered question:
   - Integrate the answer into the body of the plan
   - Move the question to the `## Resolved` graveyard at the bottom of the file
   - Keep the question heading and `**Recommendation:**` block
   - Replace `<!-- user answers here -->` with `**Answer:**` followed by the
     user's response
   - Example format in `## Resolved`:

     ```markdown
     ### What operations?

     **Recommendation:** add, subtract.

     **Answer:** add, subtract, multiply, divide
     ```

2. Continue the grilling session using this discipline:
   - **Explore before asking**: If a question can be answered by exploring the
     codebase or project docs, explore instead of asking
   - **Prioritize high-stakes questions**: Ask questions that most affect
     implementation first — hard-to-reverse decisions before easy-to-change ones
   - **Walk branches completely**: Group related questions by decision branch so
     the user can resolve one branch fully before moving to the next
   - **Every question advances a decision**: Avoid questions that don't change
     implementation — each question must have a concrete effect on the plan
   - Every new piece of information opens new branches; generate fresh questions
     for any ambiguity the answers surfaced

3. Keep new questions in `## Open Questions` at the TOP of the file, in the same
   format:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

4. If `## Open Questions` is now empty, delete the heading (but keep the
   `## Resolved` graveyard with the resolved questions)

5. If processing an old-format TODO.md where `## Open Questions` is at the
   bottom, migrate it: move the section to the top and create a `## Resolved`
   section at the bottom

### After the subagent completes

Run `node scripts/gtd.js format TODO.md` (use the same `scripts/gtd.js` path you
invoked to get this prompt) to normalize formatting.

Leave `TODO.md` **uncommitted**. The next cycle commits it, inferring the plan
subject (`plan(gtd): grilling` while open questions remain, otherwise
`plan(gtd): ready complete`) from the `## Open Questions` content.
