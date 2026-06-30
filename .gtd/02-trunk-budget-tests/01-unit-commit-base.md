# Unit test: COMMIT-stream base folds over trunk commits

## What to build

Add a new `describe` block to `src/Events.test.ts` (next to the existing
`gatherEvents — review base` block, ~line 448) that regresses the exact issue-7
bug: on the default branch, `gtd: errors` commits after `gtd: planning` must
fold into a non-zero `testFixCount`.

Use the existing harness helpers already in the file: `initRepo(branch)`,
`commitFile(msg, file, content)`, the `git(...)` helper, `runGather()`,
`resolveOf(...)`, and `commitsOf(...)`.

The fold counters are surfaced on the `RESOLVE` payload. Inspect whether
`testFixCount` is exposed on `ResolvePayload`; if it is, assert it directly. If
the resolved payload does not surface the counter, assert on the COMMIT event
count instead via `commitsOf(...)` — count the events with `isErrors === true`
and assert there are N of them (proving the COMMIT stream is no longer empty on
trunk). Prefer the counter assertion if available.

Two cases:

1. **Default branch (trunk) regression** — `initRepo(false)`, then commit
   `gtd: planning` followed by N (use N = 2) `gtd: errors` commits on `main`.
   Assert the resolved `testFixCount` is N (or N `isErrors` COMMIT events) —
   NOT 0. This fails before the package-01 fix and passes after.
2. **Feature-branch control** — `initRepo(true)` (branches to `feature` off a
   `main` baseline), commit `gtd: planning` then N `gtd: errors` on `feature`.
   Assert the merge-base range still scopes correctly: the count reflects only
   the post-branch-point commits (the `chore: init` baseline on main is
   excluded). This proves the fix did not regress merge-base scoping.

## Acceptance criteria

- [ ] New `describe` block added to `src/Events.test.ts` for the COMMIT-stream
      base
- [ ] Trunk case: with N `gtd: errors` after `gtd: planning` on the default
      branch, the assertion (testFixCount or `isErrors` count) equals N, not 0
- [ ] Feature-branch control case asserts merge-base scoping still excludes
      pre-branch-point commits
- [ ] Both cases use the existing harness helpers (`initRepo`, `commitFile`,
      `runGather`, `resolveOf`/`commitsOf`)
- [ ] The full test suite passes after package 01 is applied

## Files

- `/Users/pmelab/Code/gtd/gtd/src/Events.test.ts` (only this file)

## Constraints / edge cases

- Do not modify the harness helpers; only append a new `describe`.
- `initRepo(false)` stays on `main` (the default branch); `initRepo(true)`
  checks out `feature`. Pick the right one per case.
- Keep `afterEach(cleanup)` semantics consistent with the surrounding blocks
  (call `initRepo(...)` inside each `it`, as the review-base block does, or in a
  `beforeEach` — match the neighbouring style).
- If asserting on `testFixCount`, confirm the field name on `ResolvePayload` in
  `src/Machine.ts` before relying on it.
