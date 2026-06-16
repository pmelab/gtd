## Task: Incorporate edits to `TODO.md` and continue grilling

`TODO.md` exists in `HEAD` and the user has edited it. The edits are the user's
answers to questions in the `## Open Questions` section (written inline below
each `### <question>` heading, replacing the `<!-- user answers here -->`
placeholder), plus any free-form changes to the plan.

1. Inspect the diff for `TODO.md` to find which questions were answered.
2. For each answered question:
   - Integrate the answer into the body of the plan above `## Open Questions`.
   - Remove the question from `## Open Questions`.
3. Continue the grilling session: every new piece of information opens new
   branches of the design tree. Generate fresh questions for any ambiguity the
   answers surfaced — sharpening terminology and challenging decisions against
   the existing domain model — and append them to `## Open Questions` in the
   same format as before:

   ```markdown
   ### <one-line question>

   **Recommendation:** <your answer + reasoning>

   <!-- user answers here -->
   ```

4. If `## Open Questions` is now empty, delete the heading.
5. Stage `TODO.md` and commit with `docs: refine plan`.
