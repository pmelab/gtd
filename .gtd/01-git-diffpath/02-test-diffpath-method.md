# Unit test for `diffPath(path)`

Add a unit test in `src/Git.test.ts` covering the new `diffPath` method.

## Context

`src/Git.test.ts` already tests `diffHead` / `diffRef`. Add a parallel test for
`diffPath` using the same harness/fixtures. This file is separate from
`src/Git.ts`, so it can be written in parallel with the implementation task.

## Implementation

- Follow the existing `diffHead` test setup in `src/Git.test.ts`.
- Create/modify a single file in a temp repo, commit a baseline, then change
  that file, and assert `diffPath(<thatFile>)` returns a diff scoped to it.
- Assert that changes to OTHER paths do NOT appear in `diffPath(<targetPath>)`
  output (path scoping works).

## Acceptance criteria

- [ ] Test asserts `diffPath` returns the working-tree diff for the given path
- [ ] Test asserts the diff is scoped: unrelated file changes are excluded
- [ ] Test lives in `src/Git.test.ts` and reuses the existing test harness style
- [ ] Full test suite is green
