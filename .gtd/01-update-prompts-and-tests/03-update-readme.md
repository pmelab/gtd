# Update README.md documentation

## Description

Update the README.md to document the new TODO.md structure where open questions go at the top and answered questions are retained at the bottom.

## File to Modify

`README.md`

## Changes

### Change 1: Update workflow step 4

**Old text (around line 97):**
```markdown
4. `/gtd` again — the agent integrates your answers, removes resolved
   questions, raises new ones, and commits. Repeat until `## Open
   Questions` is empty.
```

**New text:**
```markdown
4. `/gtd` again — the agent integrates your answers, moves resolved
   questions to `## Answered Questions`, raises new ones, and commits.
   Repeat until `## Open Questions` is empty.
```

### Change 2: Update "Q&A format inside TODO.md" section

**Old text (around line 143-161):**
```markdown
## Q&A format inside TODO.md

The planning sections expect each Open Question to look like this:

```markdown
### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

<!-- user answers here -->
```

To answer, replace the comment with your response:

```markdown
### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

50 — these tables get long and 25 wastes a click for most users.
```

On the next run, the agent integrates the answer into the plan body and drops
the question from `## Open Questions`.
```

**New text:**
```markdown
## Q&A format inside TODO.md

The `## Open Questions` section lives at the TOP of TODO.md (before the plan
body). Each question looks like this:

```markdown
### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

<!-- user answers here -->
```

To answer, replace the comment with your response:

```markdown
### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

50 — these tables get long and 25 wastes a click for most users.
```

On the next run, the agent integrates the answer into the plan body and moves
the question to `## Answered Questions` at the bottom:

```markdown
## Answered Questions

### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

**Answer:** 50 — these tables get long and 25 wastes a click for most users.
```

This preserves the decision history for future reference.
```

## Acceptance Criteria

- [ ] Workflow step 4 says "moves resolved questions to `## Answered Questions`" instead of "removes"
- [ ] Q&A section explains `## Open Questions` is at TOP of file
- [ ] Q&A section shows example of `## Answered Questions` format with `**Answer:**` prefix
- [ ] Q&A section mentions decision history is preserved
