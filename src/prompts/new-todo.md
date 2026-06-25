## Task: Develop the plan in `TODO.md`

A new `TODO.md` was created. It needs to be developed into a proper plan.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** using
model `{{MODEL}}` to develop the plan.

The subagent should:

1. Treat the contents of `TODO.md` as the user's first sketch
2. Interview the plan relentlessly using this discipline:
   - **Explore before asking**: If a question can be answered by exploring the
     codebase or project docs, explore instead of asking
   - **Prioritize high-stakes questions**: Ask questions that most affect
     implementation first — hard-to-reverse decisions before easy-to-change ones
   - **Walk branches completely**: Group related questions by decision branch so
     the user can resolve one branch fully before moving to the next
   - **Every question advances a decision**: Avoid questions that don't change
     implementation — each question must have a concrete effect on the plan
3. Do this entirely by editing `TODO.md` — the subagent cannot talk to the user
4. Place unresolved questions in a `## Open Questions` section at the TOP of the
   file (before the plan body), each formatted as:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

5. Keep the original plan content BELOW `## Open Questions` and expand it where
   confident from docs and codebase reading

6. Add an empty `## Resolved` section at the bottom of the file (answered
   questions will be moved here in future iterations)

### After the subagent completes

Run `node scripts/gtd.js format TODO.md` (use the same `scripts/gtd.js` path you
invoked to get this prompt) to normalize formatting.

Leave `TODO.md` **uncommitted**. The next cycle commits it, inferring the plan
subject (`plan(gtd): grilling` while open questions remain, otherwise
`plan(gtd): ready complete`) from the `## Open Questions` content.
