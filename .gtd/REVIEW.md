# Review: c9a53c9

<!-- base: e49e45dad6cb75b11620a7ab115cd89c89d11717 -->

Fixes `spawn E2BIG` on huge untracked trees two ways: git path lists are split
into 500-path batches, and the landing commands refuse past 1,000 untracked
files.

## Scenarios

- [ ] ./tests/integration/features/land.feature#242-262 — `gtd next` with 1001
      untracked files under `big/` fails, stderr names the count
      `1001 untracked files` and the directory `big (1001)`, and no commit is
      made.
- [ ] ./tests/integration/features/land.feature#265-286 — `gtd land` with 1001
      untracked files fails naming the count and commits nothing; in the same
      repo `gtd check --open-threads` still exits 0.

## Refuse over 1,000 untracked files — landing commands only

The fix moved the refusal out of rest resolution: it now guards only the four
commands that land — `gtd next`, `gtd land`, `gtd judge answer` (via the shared
landing path) and `gtd start`. Read-only commands resolve the rest normally. The
prior risk (every rest reader refused) is resolved.

- [ ] ./src/edge/Edge.ts#974-995 — the limit (1,000, hard-coded) and the refusal
      message, now an exported standalone effect instead of a step inside
      `pendingChanges`. Directories group by each file's immediate parent, not
      top-level: 1,001 files spread over `node_modules/a/…`, `node_modules/b/…`
      list leaf dirs, never `node_modules`.
- [ ] ./src/edge/index.ts#6-6 — exports the guard to the CLI.
- [ ] ./src/cli/Program.ts#314-314 — guard on the shared landing path; covers
      `gtd land` and `gtd judge answer`.
- [ ] ./src/cli/Program.ts#601-601 — guard on `gtd start`, after workflow-name
      validation, before the rest resolves.
- [ ] ./src/cli/Program.ts#973-973 — guard on `gtd next`, before the rest
      resolves.
- [ ] ./src/edge/Edge.test.ts#772-782 — unit pin of the boundary: exactly 1,000
      passes, 1,001 rejects with count, `big (1001)` and `.gitignore` in the
      message.
- [ ] ./src/edge/Edge.test.ts#784-791 — pins that resolving the current rest
      with 1,001 untracked files succeeds and lists all 1,001 changes.
- [ ] ./README.md#475-482 — user doc: names the four refusing commands, the
      remedy (`.gitignore` / `.git/info/exclude` / delete), and that every other
      command never refuses. Now matches the code.

## `untrackedPaths` port operation

New reader op returning untracked, non-ignored paths, with live and in-memory
twins and contract coverage.

- [ ] ./src/platform/Git.ts#97-98 — interface addition.
- [ ] ./src/platform/Git.ts#494-495 — live impl:
      `git ls-files --others --exclude-standard -z`. On landing commands it runs
      alongside the same listing inside `changedPaths`, so those spawn
      `ls-files --others` twice.
- [ ] ./src/twins/InMemRepo.ts#301-304 — in-memory impl: worktree keys absent
      from the index. Applies no ignore rules, unlike live; the contract test
      seeds no ignored file, so the gap is untested (same gap the twin's
      `changedPaths` already has).
- [ ] ./src/twins/FakeGitOperations.ts#80-80 — wires the in-memory op into the
      fake port.
- [ ] ./src/twins/GitTiers.ts#441-441 — registers the op as contract-covered.

## Batch git path arguments

`ls-tree` and `hash-object` received every untracked path as argv; a long list
threw `E2BIG` synchronously as a defect. Both now run in sequential 500-path
batches. This is what lets read-only commands handle >1,000 untracked files.

- [ ] ./src/platform/Git.ts#210-216 — `ARGV_CHUNK = 500` and the `chunked`
      helper. 500 paths still overflow argv only if the average path exceeds
      ~500 bytes on macOS's 256 KiB `ARG_MAX` minus environment; the contract
      test uses ~610-byte paths and passes.
- [ ] ./src/platform/Git.ts#223-248 — `blobsAtRef`: per-batch `ls-tree`, each
      failure swallowed to empty, outputs merged. An unresolvable ref fails
      every batch alike, so behaviour matches the old single call.
- [ ] ./src/platform/Git.ts#261-281 — `hashObjects`: per-batch `hash-object`,
      each batch's oids zipped to its own paths; one failing batch still empties
      the whole map, as before.
- [ ] ./src/twins/GitTiers.ts#1108-1124 — contract case: 4,000 untracked
      ~610-byte paths against an older base; half classify `M`, `untrackedPaths`
      returns all 4,000. Runs on both tiers.
- [ ] ./src/twins/GitTiers.ts#133-139 — live tier's test git helper gets a 256
      MiB `maxBuffer` so seeding 4,000 long paths doesn't overflow.
- [ ] ./src/twins/GitTiers.ts#152-159 — same `maxBuffer` on the commit helper.

## Test step

- [ ] ./tests/integration/support/steps/common.steps.ts#61-66 — new generic
      Given: `{int} files {string} numbered from 0, each with:` writes N files,
      replacing `{n}` with the index.

## Process pin

- [ ] ./.gtd/process.gtdpin#1-1 — gtd's binary process pin (593 KB), workflow
      state, not code.

## Quality lap

What the quality lenses found, and what became of it. Write a note under a line
to reopen it.

Fixed automatically:

- New code was inserted between existing doc comments and the functions they
  describe (fe2314c, lens ponytail-review)
- Untracked-file refusal has no `@inmem` scenario and no command-level proof
  (fe2314c, lens test-audit)

Dropped at the finding gate:

- `gtd check --open-threads` (and every other `currentRest` reader) refuses on a
  huge untracked tree (lens correctness)
- `.gitignore` lifting the limit is untested, and the in-memory twin ignores it
  (lens correctness)
