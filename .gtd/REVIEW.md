# Review: 63cfcdd

<!-- base: e49e45dad6cb75b11620a7ab115cd89c89d11717 -->

Fixes `spawn E2BIG` on huge untracked trees two ways: git path lists are split
into 500-path batches, and any rest resolution refuses past 1,000 untracked
files.

## Scenarios

- [ ] ./tests/integration/features/land.feature#241-262 — `gtd next` with 1001
      untracked files under `big/` fails, stderr names the count
      `1001 untracked files` and the directory `big (1001)`, and no commit is
      made.

## Refuse over 1,000 untracked files

Every rest read that computes pending changes first lists untracked, non-ignored
files; past 1,000 it fails naming the count and the 3 parent directories holding
the most files.

- [ ] ./src/edge/Edge.ts#974-993 — the limit (1,000, hard-coded) and the refusal
      message. Directories are grouped by each file's immediate parent, not
      top-level: 1,001 files spread over `node_modules/a/…`, `node_modules/b/…`
      list leaf dirs, never `node_modules`.
- [ ] ./src/edge/Edge.ts#1000-1000 — Risk: the check sits in `pendingChanges`,
      reached by `currentRest`, so it refuses EVERY command that reads the
      current rest — `gtd check --open-threads`, `gtd restore`, `gtd base`,
      `gtd judge`, `gtd judge answer`, `gtd repin`, `gtd validate` — not only
      `gtd next`/`gtd land`. The README states `gtd check --open-threads` never
      refuses; that is false as built. Either scope the refusal to next/land or
      correct the README to list every refusing command.
- [ ] ./src/edge/Edge.test.ts#771-781 — unit pin of the boundary: exactly 1,000
      proceeds to `idle`, 1,001 rejects with count, `big (1001)` and
      `.gitignore` in the message.
- [ ] ./README.md#475-481 — user doc for the limit and the remedy (`.gitignore`
      / `.git/info/exclude` / delete). Carries the false `--open-threads` claim
      flagged above.

## `untrackedPaths` port operation

New reader op returning untracked, non-ignored paths, with live and in-memory
twins and contract coverage.

- [ ] ./src/platform/Git.ts#97-98 — interface addition.
- [ ] ./src/platform/Git.ts#494-495 — live impl:
      `git ls-files --others --exclude-standard -z`. Runs alongside the same
      listing inside `changedPaths`, so every rest read now spawns
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
batches.

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
