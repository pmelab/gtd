# Add GitService operations for review-base resolution

Add five new git operations to `GitService` that the `human-review` step needs
to resolve a review base ref from git state.

## Files

- `src/Git.ts` — add the operations to the `GitOperations` interface and the
  `GitService.Live` implementation.

## Operations to add

Add all five to the `GitOperations` interface and implement them in the object
returned by `GitService.Live`. Use the existing `exec(...)` helper and the same
`Effect`/`Option` conventions already in the file. Import `Option` from `effect`
where needed.

1. `resolveDefaultBranch(): Effect.Effect<Option.Option<string>, Error>`
   - Run `git rev-parse --abbrev-ref origin/HEAD` and trim. On success it yields
     e.g. `origin/main`; return `Option.some` of that value.
   - If that command fails (no remote / `origin/HEAD` unset), fall back: probe
     `git rev-parse --verify --quiet refs/heads/main` then `refs/heads/master`;
     return `Option.some("main")` / `Option.some("master")` for whichever
     resolves.
   - If nothing resolves, return `Option.none()`. Never fail the effect for the
     "unresolvable" case — model absence as `Option.none()`.

2. `mergeBase(a: string, b: string): Effect.Effect<Option.Option<string>, Error>`
   - Run `git merge-base a b`, trim, return `Option.some(hash)`. If the command
     fails (unrelated histories), return `Option.none()`.

3. `lastReviewCommit(): Effect.Effect<Option.Option<string>, Error>`
   - Run `git log --grep` for the subject pattern
     `review(gtd): create review for ` and take the most recent matching commit
     hash. Suggested:
     `git log -1 --format=%H --grep=^review\\(gtd\\): create review for --extended-regexp`
     (or `-F` fixed-string grep — pick the form that reliably matches the
     literal subject prefix). Trim.
   - If a hash is returned, `Option.some(hash)`; if output is empty or the
     command fails, `Option.none()`.

4. `commitCount(base: string): Effect.Effect<number, Error>`
   - Run `git rev-list --count base..HEAD`, trim, parse as integer, return the
     number.

5. `isAncestor(a: string, b: string): Effect.Effect<boolean, Error>`
   - Run `git merge-base --is-ancestor a b`. This command exits 0 when `a` is an
     ancestor of `b`, 1 otherwise. The current `exec` helper maps non-zero exit
     to an `Error`, so implement as: run the command, `Effect.map(() => true)`,
     `Effect.catchAll(() => Effect.succeed(false))` (mirror the existing
     `hasCommits` pattern).

## Constraints

- Follow the existing module style exactly: `exec(...)` helper, `Effect.gen`,
  `.pipe(...)`, `Effect.mapError` for string error coercion already in place.
- Absence/soft-failure is modelled with `Option`, NOT by failing the Effect —
  except `commitCount` which may fail (the caller will only call it on a base
  known to be an ancestor).
- Do not change any existing operation.
- Keep the `GitOperations` interface and the `Live` object in the same order so
  the file stays readable.

## Acceptance criteria

- [ ] `GitOperations` interface declares `resolveDefaultBranch`, `mergeBase`,
      `lastReviewCommit`, `commitCount`, `isAncestor` with the signatures above.
- [ ] `GitService.Live` implements all five.
- [ ] `resolveDefaultBranch` returns `Option.none()` (not an error) when there
      is no remote and no `main`/`master` branch.
- [ ] `mergeBase` returns `Option.none()` on unrelated histories instead of
      failing.
- [ ] `lastReviewCommit` returns `Option.none()` when no matching commit exists.
- [ ] `isAncestor` returns `false` (not an error) when `a` is not an ancestor.
- [ ] `npm run typecheck` (or `tsc --noEmit`) passes.
