# Task: Add the new Git primitives (additive)

Add the git primitives the new 16-state machine needs to `src/Git.ts`, **purely
additively** — do NOT remove or change any existing method. The old pipeline
(Machine/Events/Prompt/main) and every existing test must stay green; these new
methods are simply unused until the cutover package.

Spec pointers:

- `TODO.md` → "Modules to rewrite → **src/Git.ts**" (the authoritative list of
  what to add and what to keep).
- `TODO.md` Resolved Q2 ("look at the commit diff and see if ERRORS.md was
  deleted") for `commitHistory` / `removedErrors`.
- `STATES.md` § Transport (mixed reset), § New Feature (revert), § Accept Review
  (checkout), § Clean (last REVIEW.md deletion = review base), § Close package.

## What to add

Add to the `GitOperations` interface **and** the `GitService.Live`
implementation:

- `revertNoCommit(ref)` → `git revert --no-commit <ref>` (stage the inverse into
  the working tree, no commit). New Feature uses `revertNoCommit("HEAD")`.
- `mixedResetHead()` → `git reset HEAD~1` (default = mixed; keeps changes in the
  tree). Transport's consumer half.
- `checkoutAll()` → `git checkout -- .` (discard tracked working-tree edits back
  to HEAD). Accept Review uses this.
- `lastDeletionOf(path)` → `git log --first-parent --diff-filter=D --format=%H --
  <path>`; return `Option.some(<most-recent sha>)` or `Option.none()`. The Clean
  review base on the default branch = the last commit that deleted `REVIEW.md`.
- `commitHistory(base?)` → one first-parent pass returning, per commit
  (oldest→newest), `{ message: string; removedErrors: boolean }` where
  `removedErrors` is true iff that commit's `--name-status` diff contains a
  deletion (`D`) of `ERRORS.md`. Implementation hint: a single
  `git log --first-parent --reverse --format=<sentinel>%H%x00%B%x00 --name-status
  <range?>` pass, splitting on the sentinel and scanning each commit's
  name-status block for `^D\tERRORS.md$`. Empty repo → `[]`. This is the only
  history probe that needs per-commit file info (Q2).
- `removePackageDir(dir)` → `git rm -r <dir>` (stage the deletion); then if
  `.gtd/` is now empty, remove it too. Idempotent/tolerant if already gone.
- `commitAllWithPrefix(prefix)` → `git add -A` then
  `git commit -m "<prefix>"`. The single commit primitive every state uses (each
  state passes its own flat `gtd: <phase>` subject). No content-derived subjects,
  no trailers, no restore-paths.

Keep (do not touch) the existing methods the new edge will reuse: `mergeBase`,
`resolveDefaultBranch`, `statusPorcelain`, `diffHead`, `diffRef`, `hasCommits`,
`resolveRef`. Leave all the soon-to-be-dead methods
(`recordAndRevertReview`, `approveSpecReview`, `closeReview`,
`diffRefExcludingGtd`, `lastReviewCommit`, `lastCloseCommit`,
`deriveCommitMessage`, the intent-aware `commitPending`) **in place** — the
cutover package deletes them, not this one.

## Constraints / edge cases

- Additive only: `npm run test` and `npm run test:e2e` must both stay green
  (old pipeline unchanged).
- Mirror the existing `exec`/`Effect`/`CommandExecutor` patterns already in
  `src/Git.ts` (e.g. `Command.exitCode` for tolerant ops, `Effect.catchAll` for
  "no-op if absent"). Match the existing `Effect.Effect<…, Error>` signatures.
- `commitHistory` must treat an empty repo (no HEAD) as `[]` like the existing
  `commitMessages` does.
- `lastDeletionOf` returns the **most recent** deletion (first line of
  `git log` output), as `Option`.

## Files

- Modify: `src/Git.ts`
- Modify: `src/Git.test.ts` (add new `describe` blocks for each new primitive,
  using the existing real-temp-repo harness pattern in that file; keep all
  existing tests)

## Acceptance criteria

- [ ] `revertNoCommit`, `mixedResetHead`, `checkoutAll`, `lastDeletionOf`,
      `commitHistory`, `removePackageDir`, `commitAllWithPrefix` exist on the
      `GitOperations` interface and `GitService.Live`.
- [ ] `commitHistory` sets `removedErrors: true` exactly for commits whose diff
      deletes `ERRORS.md`, in oldest→newest order, and returns `[]` for an empty
      repo.
- [ ] `lastDeletionOf("REVIEW.md")` returns the most recent REVIEW.md-deleting
      commit sha (or `none`).
- [ ] `removePackageDir` removes the dir and also removes a now-empty `.gtd/`.
- [ ] No existing `GitOperations` method was removed or changed.
- [ ] New unit tests cover each primitive; `npm run test` passes.
- [ ] `npm run test:e2e` passes (old pipeline behaviour unchanged).
