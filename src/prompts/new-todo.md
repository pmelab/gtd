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
