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
