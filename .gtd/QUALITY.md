## `gtd check --open-threads` (and every other `currentRest` reader) refuses on a huge untracked tree

The refusal sits in `pendingChanges` (`src/edge/Edge.ts:1000`), which
`restAt(undefined)` runs for every command reading the current rest. Bare
`gtd check --open-threads` (`runCodeThreadsCheckCommand`,
`src/cli/Program.ts:1107`) reads `currentRest` first, so it fails with the
untracked-files error before looking at any thread.

This breaks the settled requirement ("`gtd check --open-threads` is a read, not
a landing, and never refuses") and the README line added in this change.
`gtd base`, `gtd judge`, `gtd validate`, `gtd restore` and `gtd start` refuse
the same way, though README says only `gtd next`/`gtd land` refuse.

Failure scenario: put 1,001 un-ignored files in `big/`, then run
`gtd check --open-threads`. It exits non-zero with
`gtd: 1001 untracked files (limit 1000)…` and lists no threads.

Fix direction: move the check out of `restAt` and into the `next`/`land` command
paths, or let the open-threads command skip it. Add a test that 1,001 untracked
files still leave `gtd check --open-threads` working. That test would fail
today.

## `.gitignore` lifting the limit is untested, and the in-memory twin ignores it

The design depends on one property: the count uses `--exclude-standard`, so a
`.gitignore` or `.git/info/exclude` entry lifts the refusal. No test holds that
property:

- The new `untrackedPaths` contract case (`src/twins/GitTiers.ts`) only checks
  the count of 4,000 plain files.
- The Edge test only checks 1,000 vs 1,001.

`InMemRepo.untrackedPaths` returns every worktree path missing from the index,
with no ignore handling. On the in-memory tier, a `.gitignore` written next to
`big/` does not lift the refusal, but live git does. This is mock/live drift on
the new operation's one important behaviour.

Failure scenario: an `@inmem` scenario writes `.gitignore` containing `big/`
plus 1,001 files under `big/`. In-memory, `gtd next` still refuses; live, it
proceeds. If a later change dropped `--exclude-standard` from the live call, no
test would fail.

Fix direction: add a contract case where ignored paths are absent from
`untrackedPaths`. Then give the twin ignore support, or mark the gap explicitly.

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
