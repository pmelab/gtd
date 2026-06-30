# README: note that budgets engage on the default branch too

## What to build

Update `README.md` to reflect that the loop budgets (`fixAttemptCap` /
`reviewThreshold`) now also engage on the default branch — previously the
merge-base/whole-history wording implied (and the code enforced) that the COMMIT
stream was scoped to `merge-base..HEAD`, which is empty on trunk.

Target the existing merge-base wording around **README.md lines 15-18**:

> it reads the **first-parent** commit subjects since the merge-base with the
> default branch (whole-history fallback when there is no default branch or
> merge-base) plus the working tree …

Extend the parenthetical so it also covers the trunk-based case: the
whole-history fallback now also applies when HEAD **is** the merge-base (i.e.
gtd work happens on the default branch), so the budget counters fold over the
full first-parent history instead of an empty range.

Keep the edit minimal and factually precise. If the "fix loops & counter folds"
section (~lines 250-300) makes any claim that budgets are feature-branch-only,
correct it too; otherwise leave that section as-is.

## Acceptance criteria

- [ ] README's merge-base/whole-history wording (~lines 15-18) notes the
      whole-history fallback also applies when HEAD equals the merge-base
      (default-branch / trunk work)
- [ ] The note makes clear budgets now engage on the default branch, not only on
      feature branches
- [ ] No other README sections contradict the new behavior (scan the fix-loops
      section ~250-300)
- [ ] Wording is concise and accurate; no invented config or behavior

## Files

- `/Users/pmelab/Code/gtd/gtd/README.md` (only this file)

## Constraints / edge cases

- Per global instructions, every significant change is reflected in the README —
  this task is that reflection.
- Do not restructure the README; surgical wording change only.
- The merge-base remains the base on feature branches; the README must not imply
  it was removed.
