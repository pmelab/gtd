## Task: Seed the plan from a fresh `TODO.md`

A new `TODO.md` was created. Treat its contents as the user's first sketch of a
plan. Run a thorough grilling session using the **grill-with-docs** methodology
documented at the end of this prompt.

Do this entirely by editing `TODO.md` — you cannot talk to the user.

1. Read `TODO.md` carefully along with any project documentation (`README.md`,
   `CONTEXT.md`, `docs/`, etc.).
2. Walk every branch of the design tree. For each decision point, generate a
   precise question and a recommended answer.
3. Append every question to a dedicated `## Open Questions` section at the very
   end of `TODO.md`. Format each as:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

4. Keep the original plan content above the `## Open Questions` heading.
   Expand it where you can do so confidently from the docs and your reading.
5. When you have exhausted productive questions, stage `TODO.md` and commit
   with `docs: seed plan`.
