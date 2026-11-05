# Quality

## `gtd check --open-threads` (and every other `currentRest` reader) refuses on a huge untracked tree

_From lens correctness. The judge called it design (p=0.6)._

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

- [ ] fix

## `.gitignore` lifting the limit is untested, and the in-memory twin ignores it

_From lens correctness. The judge called it design (p=0.5)._

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

- [ ] fix
