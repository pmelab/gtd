# Task: Update README REVIEW.md description

Update `README.md` to document the restored REVIEW.md format: hash marker, hunk
checkboxes (informational, not enforced), and the open-on-top / resolved-at-bottom
question convention.

## What to build

Two locations:

1. **Steering-files list** (`README.md` L62-63):
   ```
   - **REVIEW.md** — a guided human review with file pointers spanning a commit
     diff.
   ```
   Expand to mention: a `# Review: <short-hash>` heading + `<!-- base: <full-hash> -->`
   marker identifying the review base, per-hunk `- [ ]` checkboxes that are
   **informational navigation aids and NOT enforced** (unchecked boxes never gate
   the workflow), and the open-on-top / resolved-at-bottom question convention
   (open comments/questions at the top, resolved items retained at the bottom) —
   consistent with the TODO.md grilling convention.

2. **Clean state row** (`README.md` L235, the state table): note that the agent
   writes REVIEW.md with the hash marker and informational hunk checkboxes.

## Acceptance criteria

- [ ] README mentions the `# Review: <short-hash>` heading and `<!-- base: -->` marker
- [ ] README states the `- [ ]` checkboxes are informational and **not enforced**
- [ ] README documents the open-on-top / resolved-at-bottom question convention,
      noting consistency with TODO.md grilling
- [ ] Clean state table row (~L235) reflects the restored format
- [ ] No claim of any gate/enforcement on boxes or marker

## Files

- Edit: `/Users/pmelab/Code/gtd/gtd/README.md` (L62-63 and L235)

## Constraints

- File-disjoint with all other tasks. You own `README.md` only.
- Do **not** edit `STATES.md` — per project memory it is the redesign target and
  intentionally diverges; defer STATES.md sync.
