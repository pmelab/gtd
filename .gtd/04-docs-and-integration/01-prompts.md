# Update prompts: await-review.md + clean.md

Reflect the new checkbox-approval rule in the workflow prompts.

## Files

- `src/prompts/await-review.md`
- `src/prompts/clean.md` (lines ~52-55, the closing note re: checkboxes as
  navigational aids)

## Implementation

- `await-review.md`: clarify step 2 (**To approve**): "re-run gtd with no
  changes **or after only checking off REVIEW.md checkboxes**". Step 3 (**To
  request changes**) stays for code edits / inline comments / textual REVIEW.md
  annotations.
- `clean.md`: update the closing note so it matches — ticking checkboxes is
  approval (→ Done), not a change-request; only non-checkbox edits to REVIEW.md
  (or code edits) trigger Accept Review.

## Acceptance criteria

- [ ] `await-review.md` "To approve" mentions checking off REVIEW.md checkboxes
- [ ] `await-review.md` "To request changes" still covers code/text edits
- [ ] `clean.md` closing note states checkbox flips = approval, non-checkbox
      edits = change-request
- [ ] Full test suite is green (prompt snapshot/contract tests, if any, pass)
