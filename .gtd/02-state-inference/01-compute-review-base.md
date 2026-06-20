# Add computeReviewBase helper

Add a helper to `src/State.ts` that picks the review base ref — the commit
closest to HEAD between the parent-branch merge-base and the last review commit
— using the GitService operations added in package 01.

## Files

- `src/State.ts` — add the helper (not exported is fine, but export it if the
  inference logic in task 02 lives close by and a clear seam helps testing).
  Import `Option` from `effect`.

## Behaviour

`computeReviewBase(git: GitOperations): Effect.Effect<Option.Option<string>, Error>`

(Take the resolved `GitService` value, or take the tag and resolve inside —
match whatever is ergonomic given how `detect` already does
`const git = yield* GitService`.)

1. Gather candidate base hashes (each an `Option<string>`):
   - Parent-branch candidate: `resolveDefaultBranch()`; if `some(branch)`, then
     `mergeBase(branch, "HEAD")`. The result is the candidate (still an Option).
   - Last-review candidate: `lastReviewCommit()`.
2. Collect the present candidates into an array of hashes.
3. Drop any candidate that is **not an ancestor of HEAD**
   (`isAncestor(candidate, "HEAD")` is false). Also drop any candidate that
   equals HEAD's hash — a base == HEAD means nothing to review (the caller
   routes to `verified`). NOTE: `isAncestor(X, "HEAD")` is true when X == HEAD,
   so explicitly exclude the equal-to-HEAD case here, or let the caller detect
   empty diff. Prefer excluding here only via the "closest with non-empty
   distance" rule below; keep base == HEAD handling consistent with the diff
   check the caller does.
4. Among the remaining candidates, pick the one with the **smallest**
   `commitCount(candidate)` (= `git rev-list --count candidate..HEAD`), i.e.
   closest to HEAD.
5. Tie-break: if two candidates have the same count, prefer the one that is the
   **descendant** of the other (use `isAncestor(a, b)` — if `a` is an ancestor
   of `b`, then `b` is the descendant, pick `b`). In practice equal counts on a
   linear history mean the same commit; the tie-break matters only across
   branches.
6. Return `Option.some(chosenHash)` or `Option.none()` if no candidate
   qualified.

## Constraints

- Pure git-state logic; no filesystem access, no commit-subject parsing.
- Model "no base" as `Option.none()`, never a thrown/failed Effect for the
  expected absence cases.
- Reuse the package-01 operations; do not shell out to git directly here.

## Acceptance criteria

- [ ] `computeReviewBase` exists with the signature above.
- [ ] Returns `Option.none()` when neither candidate resolves.
- [ ] Returns `Option.none()` when the only candidate equals HEAD (nothing to
      review) — verify this composes correctly with the inference diff check in
      task 02 (they must not both emit `human-review` for an empty diff).
- [ ] When both candidates are ancestors of HEAD, returns the one closest to
      HEAD (smallest `commitCount`).
- [ ] `npm run typecheck` passes.
