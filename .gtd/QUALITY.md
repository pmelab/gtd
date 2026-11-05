# Quality

## New code was inserted between existing doc comments and the functions they describe

Two inserts in `src/platform/Git.ts` split a JSDoc from its function:

- `ARGV_CHUNK` and `chunked` sit between the `blobsAtRef` doc comment ("An
  unresolvable `ref` … yields an empty map") and `blobsAtRef` itself. The
  comment now sits above `chunked`.
- `untrackedPaths` is added to `GitReaderOperations` after the `stagedPaths` doc
  comment ("that `changedPaths` misses when the worktree reverted a staged
  edit"). That comment now documents `untrackedPaths`, and `stagedPaths` has
  none.

Failure scenario: a reader or hover tooltip shows the staged-path description on
`untrackedPaths` and the ref-blob description on `chunked`. This is wrong
documentation that the repo's comment policy says to delete, not leave.

Fix direction: put `untrackedPaths` (with its own one-line doc) before the
`stagedPaths` docblock, and move `ARGV_CHUNK`/`chunked` above the `blobsAtRef`
docblock.

## Untracked-file refusal has no `@inmem` scenario and no command-level proof

AGENTS.md requires a tagged cucumber scenario for each new feature. The new
refusal is proven only by one unit test on `currentRest` in
`src/edge/Edge.test.ts`. No scenario under `tests/integration/features/` runs
`gtd next` or `gtd land` against 1,001 untracked files. The README states the
user-facing behaviour of those commands, and nothing pins it: exit status,
stderr text, and that the working tree stays unchanged.

Failure scenario: a later change catches the error inside `next`/`land`, or
moves the check out of `pendingChanges`. The `restAt` unit test may still pass,
while the command quietly runs `git add -A` over the huge tree.

Fix direction: add one `@inmem` scenario with 1,001 untracked files, asserting
that `gtd next` fails with the message and that nothing was committed. Use an
`untrackedPaths`-aware twin so a `.gitignore` case can sit beside it (see the
earlier ignore-drift finding).
