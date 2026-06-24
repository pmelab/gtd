# Delete `hasBangAdded` from `Git.ts` (+ its tests)

After package 02, nothing calls `git.hasBangAdded` any more. Remove the now-dead
operation and its test block.

## What to do (`src/Git.ts`)

- Remove the `readonly hasBangAdded: (baseRef: string) => Effect.Effect<boolean,
  Error>` member (and its doc comment) from the `GitOperations` interface
  (~line 22–23).
- Remove the `hasBangAdded: (baseRef) => Effect.gen(…)` implementation block in
  `GitService.Live` (~line 209–247, including the preceding comment and the
  `baseRef`-since untracked-intent-to-add diff scan inside it).
- Do NOT remove anything else. KEEP `lastReviewCommit`, `lastCloseCommit`,
  `showHead`, `diffRef`, `resolveRef`, etc. — they are still used by
  `computeReviewBase`, the close anchor, and review generation.

## Tests (same task — `src/Git.test.ts`)

- DELETE the entire `describe("hasBangAdded", …)` block (~line 323–388).
- Leave every other `describe` block intact (`showHead`, the commitCount distance
  integration, etc.).

## Acceptance criteria

- [ ] `hasBangAdded` removed from the `GitOperations` interface and the `Live`
      implementation; no other op removed.
- [ ] `describe("hasBangAdded", …)` deleted from `src/Git.test.ts`.
- [ ] No remaining reference to `hasBangAdded` anywhere in the repo
      (grep clean).
- [ ] `npm run test` green.

## Files

- `src/Git.ts`
- `src/Git.test.ts`

## Constraints / edge cases

- DEPENDS ON package 02 (which removed the only caller in `Events.ts`). If a
  caller still existed, deleting the op would break the build — package ordering
  guarantees it does not.
- File-disjoint from the await-review prompt task (task 02).
