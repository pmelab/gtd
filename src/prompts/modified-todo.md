## Task: Incorporate edits to `TODO.md` and keep developing the plan

`TODO.md` exists in `HEAD` and the user has edited it. The edits are the
user's answers to questions in the `## Open Questions` section (written
inline below each `### <question>` heading, replacing the
`<!-- user answers here -->` placeholder), plus any free-form changes to the
plan.

For each answered question, integrate the answer into the body of the plan
above `## Open Questions` and remove the question from `## Open Questions`.

Continue the grilling session: every new piece of information opens new
branches of the design tree. Generate fresh questions for any ambiguity the
answers surfaced — sharpening terminology and challenging decisions against
the existing domain model — and append them to `## Open Questions` in the
same format as before:

```markdown
### <one-line question>

**Recommendation:** <your answer + reasoning>

<!-- user answers here -->
```

If `## Open Questions` is now empty, delete the heading. Commit `TODO.md`.
