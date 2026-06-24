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
4. Add a YAML frontmatter block at the very top with `status: grilling` while
   questions remain (this `status:` field is the source of truth for the
   planning phase):

   ```markdown
   ---
   status: grilling
   ---
   ```

5. Place unresolved questions in a `## Open Questions` section at the TOP of the
   file (below the frontmatter, before the plan body), each formatted as:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

6. Keep the original plan content BELOW `## Open Questions` and expand it where
   confident from docs and codebase reading

7. Add an empty `## Resolved` section at the bottom of the file (answered
   questions will be moved here in future iterations)

8. **Set the status when the plan is complete**: If no open questions remain in
   this iteration, decide the scope and set the frontmatter `status:`
   accordingly:
   - **`status: simple`** if the change is confined to **five files or fewer**
     (single, obvious implementation) — the next cycle executes it directly with
     no decomposition.
   - **`status: complete`** otherwise — the next cycle decomposes it into work
     packages.
   - If questions still remain, keep `status: grilling`.

### After the subagent completes

Run `node scripts/gtd.js format TODO.md` (use the same `scripts/gtd.js` path you
invoked to get this prompt) to normalize formatting.

Commit `TODO.md` with the developed plan.
