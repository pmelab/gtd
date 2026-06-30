# Update STATES.md (Accept Review / Done)

## File

- `STATES.md` (§ Accept Review ~lines 314-330, § Done ~332-341)

## Implementation

- Document that a REVIEW.md with **only checkbox-flip edits** (`- [ ]` ↔
  `- [x]`) routes to **Done**, not Accept Review.
- Accept Review now requires a **non-checkbox** edit (code change, inline
  comment, or textual REVIEW.md annotation).
- Keep consistent with the shipped machine routing (`reviewCommitted` → done;
  `reviewDirty && reviewCheckboxOnly` → done; `reviewDirty` → accept-review;
  else await-review).

## Acceptance criteria

- [ ] § Accept Review notes it requires a non-checkbox edit
- [ ] § Done notes checkbox-only REVIEW.md edits route here
- [ ] No contradiction with the other state sections
