# Unit-test the new GitService operations

Add `vitest` unit tests for the five new operations from
`01-add-git-operations.md`, exercising each against a real temp git repo.

## Files

- `src/Git.test.ts` — add new `describe` blocks. Reuse the existing
  `beforeEach`/`afterEach` temp-repo harness, the `git(...)`, `commit(...)`,
  `run(...)`, and `runEither(...)` helpers already in the file.

## Tests to add

`resolveDefaultBranch`

- [ ] With no remote and only the default `beforeEach` setup: assert it yields
      `Option.none()` OR `Option.some("main"|"master")` depending on the local
      branch name — make the assertion robust by creating an explicit branch
      (e.g. `git("branch", "-M", "main")`) and asserting `Option.some("main")`.
- [ ] (Optional) With a remote whose `origin/HEAD` is set, assert it yields the
      short name. If wiring a fake remote is heavy, cover this via the
      fallback-branch case instead and note it.

`mergeBase`

- [ ] Two commits on a linear history: `mergeBase("HEAD~1", "HEAD")` resolves to
      the `HEAD~1` hash (`Option.some`).
- [ ] Create a divergent branch off `HEAD~1`, switch back; assert the merge-base
      of the two tips equals the shared ancestor.

`lastReviewCommit`

- [ ] No review commits → `Option.none()`.
- [ ] After committing with subject `review(gtd): create review for abc1234` →
      returns `Option.some(<hash>)` equal to that commit's hash; if two such
      commits exist, returns the most recent.

`commitCount`

- [ ] `commitCount("HEAD")` → `0`.
- [ ] After N additional commits, `commitCount("HEAD~N")` → `N`.

`isAncestor`

- [ ] `isAncestor("HEAD~1", "HEAD")` → `true`.
- [ ] `isAncestor("HEAD", "HEAD~1")` → `false`.
- [ ] A commit on a divergent branch is NOT an ancestor of the other tip →
      `false`.

"Closer to HEAD" selection sanity (integration of the primitives, optional but
recommended here since it documents intent):

- [ ] Build a history where both a parent-branch merge-base and a prior review
      commit are ancestors of HEAD at different distances; assert
      `commitCount(parentBase) > commitCount(reviewBase)` (i.e. the review
      commit is closer). This is consumed by `computeReviewBase` in package 02.

## Constraints

- Use the existing harness; do not introduce a new test runner or fixtures dir.
- Assert on `Option` by checking `_tag` / `Option.getOrNull`, consistent with
  how `Effect.either` results are inspected elsewhere in the file.
- Each git state must be set up inline in the test via `git(...)`/`commit(...)`
  so the scenario is self-evident.

## Acceptance criteria

- [ ] New `describe` blocks for all five operations exist.
- [ ] `npm test` (vitest) passes for `src/Git.test.ts`.
- [ ] No changes to existing tests.
