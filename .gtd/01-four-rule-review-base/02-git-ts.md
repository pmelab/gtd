# Git helper support for scanning commits by subject (likely a no-op)

The four-rule review-base logic in `src/Events.ts` (task 01) needs to scan
commit history for subjects `gtd: grilling`, `gtd: awaiting review`, and
`gtd: done`, oldest→newest, across the whole history (not just `base..HEAD`).

`git.commitHistory(base?)` already provides exactly this:

- Called with no `base`, it returns ALL commits, oldest-first (`--reverse`),
  each as `{ message, removedErrors }`.
- The consumer can filter on `message` first-line to find grilling / awaiting
  review / done commits.

Therefore **this task is expected to be a no-op**: `commitHistory()` is
sufficient and no new Git helper is required.

## Files

- `/Users/pmelab/.herdr/worktrees/gtd/issue-24-branch-review/src/Git.ts`

## Acceptance criteria

- [ ] Confirm `commitHistory()` (no base) returns all commits oldest-first with
      full messages — sufficient for subject scanning. Document that finding
      here or in the task 01 implementation.
- [ ] Only add a helper to `src/Git.ts` if task 01 genuinely cannot resolve a
      needed commit SHA from `commitHistory()` output alone (e.g. it needs the
      SHA of a matched commit, which `commitHistory()` does NOT currently return
      — it returns only `message`/`removedErrors`).

## Constraints / edge cases

- IMPORTANT: `commitHistory()` returns `{ message, removedErrors }` — it does
  **not** expose the commit SHA. Task 01 needs a _ref_ to pass to
  `git.diffRef()`. If task 01 resolves this by counting commits from HEAD
  backwards (e.g. `HEAD~N`) that is fine and needs no Git change. If instead it
  is cleaner to have `commitHistory()` include the SHA, add a `hash` field to
  the returned records here (the `%H` is already captured in the format string
  and split into `parts[0]` — currently discarded). If you add `hash`, keep it
  additive and backward-compatible.
- Coordinate the decision with task 01, but stay file-disjoint: this task edits
  ONLY `src/Git.ts` (and only if actually needed).
- Do not commit anything. Leave changes uncommitted.
