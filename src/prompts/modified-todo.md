## Test gate (run first)

Before doing anything else, run the project's test suite (determine the command
from AGENTS.md / `package.json` scripts / Makefile).

- **On failure:** make exactly **ONE** fix, then commit **all** the fix changes
  into a single commit with a `fix(gtd): <desc>` message. Do not commit
  `TODO.md` — leave it dirty (the working tree should end with only `TODO.md`
  pending, or otherwise clean). Then **re-run gtd** and stop; the gate will
  re-evaluate on the next cycle.
- **On green:** proceed inline with the task below in this same run.

## Task: Incorporate edits to `TODO.md` and keep developing the plan

`TODO.md` exists in `HEAD` and the user has edited it. The edits are answers to
questions in `## Open Questions` (written inline below each question, replacing
the `<!-- user answers here -->` placeholder), plus any free-form changes to the
plan.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** to
continue developing the plan. Check your user/project AGENTS.md for model
preferences (e.g., "use opus for planning"). If no preference is set, default to
a high-reasoning model like Claude Opus.

The subagent should:

1. For each answered question:
   - Integrate the answer into the body of the plan
   - Move the question to `## Answered Questions` at the bottom of the file
   - Keep the question heading and `**Recommendation:**` block
   - Replace `<!-- user answers here -->` with `**Answer:**` followed by the
     user's response
   - Example format in Answered Questions:

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

4. If `## Open Questions` is now empty, delete the heading (but keep
   `## Answered Questions` with the resolved questions)

5. If processing an old-format TODO.md where `## Open Questions` is at the
   bottom, migrate it: move the section to the top and create
   `## Answered Questions` at the bottom

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

### After the subagent completes

Run `node scripts/gtd.js format TODO.md` (use the same `scripts/gtd.js` path you
invoked to get this prompt) to normalize formatting.

Commit `TODO.md`.
