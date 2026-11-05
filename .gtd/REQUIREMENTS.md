# gtd: spawn E2BIG on a large untracked tree (pmelab/gtd#568)

## Concerns

### 1. Unbounded argv in the changed-paths read — TECHNICAL

`changedPaths` lists every untracked file one by one
(`git ls-files --others --exclude-standard -z`, no `--directory`), then passes
the whole list as argv to `git ls-tree -r -z <ref> -- …` and, for paths already
present at an older base, `git hash-object -- …`. Past the OS argument limit
(roughly 1 MB on macOS) Node's `spawn` throws E2BIG synchronously: a defect, so
the `Effect.catch` around both calls never sees it, and every `gtd next`,
`gtd land` and status read dies with `{"state":"error","prompt":"spawn E2BIG"}`.

Fix: never build argv from an unbounded file list. Builder's choice among
chunking (as `worktreeSync` already does with `HASH_CHUNK = 500`), reading
`ls-tree -r` of the whole ref once and filtering in memory, or stdin-fed
variants that keep NUL-safe paths (a path may hold a newline — the reason
`worktreeSync` avoids stdin). Classification results must stay identical: `A`
absent at ref, `M` differing bytes through clean filters, no entry for identical
bytes.

### 2. Refuse a huge untracked tree — PRODUCT

**Above a fixed 1,000 untracked, un-ignored files, `gtd next` and `gtd land`
refuse** with a message naming the count, the largest untracked directories, and
suggesting a `.gitignore` entry. Nothing lands until the human ignores or
deletes the tree. At 1,000 or fewer, everything works as today.

**Risk: a legitimate step producing over 1,000 files (generated fixtures,
vendored code) blocks until ignored** — accepted; no config key overrides it.

The count is taken fresh on every read, over the same set `changedPaths` lists:
`--exclude-standard`, so `.gitignore` and `.git/info/exclude` both lift it.
`gtd check --open-threads` is a read, not a landing, and never refuses.

### 3. Any other unbounded argv site — TECHNICAL

Audit found none: every other spawn takes fixed argv, one path, or an
already-chunked list. Landing scripts and formatters never receive a path list.
The builder re-checks `pathspec()` in the emitted scripts, whose callers were
not traced.

## Acceptance Criteria

- AC-1: In a repository whose worktree holds an untracked, un-ignored directory
  of 20,000 files under nested long names (their joined paths past the OS
  argument limit), `gtd next --json` reports the untracked-tree refusal of AC-4
  instead of `{"state":"error","prompt":"spawn E2BIG"}`
- AC-2: In that same repository, `gtd check --open-threads` scans the untracked
  files without E2BIG and reports an open thread left in one of them
- AC-3: Against a diff base older than HEAD, where most of a large untracked set
  (past the argument limit) already exists at the base, the changed-paths read
  reports each path `M` when its bytes differ from the base, and omits it when
  they match — no E2BIG, no path wrongly reported added
- AC-4: When the worktree holds more than 1,000 untracked, un-ignored files,
  `gtd next` and `gtd land` refuse: the message names the untracked file count
  and the largest untracked directories and suggests a `.gitignore` entry, and
  nothing is landed
- AC-5: With exactly 1,000 untracked, un-ignored files, `gtd next` and
  `gtd land` proceed as normal and land them
- AC-6: Adding the offending directory to `.gitignore` or `.git/info/exclude`
  after a refusal lets the next `gtd next` proceed

## Impact

- core / `src/platform` — `Git.ts` `changedPaths`, `blobsAtRef`, `hashObjects`:
  the only unbounded argv sites; the live git port changes
- twins / `src/twins` — `GitTiers.ts` `runGitServiceContract` gains a
  large-untracked-set case run against both tiers; `InMemRepo` has no argv
  limit, so the case proves only result parity there
- core / `src/edge` — `pendingChanges` → `restAt`: every current-rest read
  (`gtd next`, `gtd land`, status) goes through `changedPaths`; the 1,000-file
  refusal (AC-4) lands at or near here
- core / `src/cli` — `gtd check --open-threads` calls `changedPaths(diffBase)`,
  the path that reaches `hashObjects`, and must not refuse; the AC-4 refusal
  renders via `report` in `Cli.ts`
- Public surface: AC-4's refusal message in `gtd next`/`gtd land` output and the
  `{"state":"error",…}` envelope; no new config key; `docs/cli.md` exit-code
  table untouched (pinned to the real set; refusal reuses `EXIT_RUNTIME_ERROR`);
  README notes the 1,000-file limit and the `.gitignore` remedy
- Surprise: E2BIG is a synchronous throw from `spawn`, so it escapes
  `Effect.catch` as a defect — the existing "failure means every path is `A`"
  fallbacks never ran
- Surprise: the landing script's `git add -A` commits every untracked,
  un-ignored file — the reason for the AC-4 refusal
- Surprise: with the refusal at 1,000, `gtd next` never reaches the unbounded
  argv on the landing path; the argv fix still matters for
  `gtd check --open-threads` and as defence against long paths
- `tests/integration/features/` — new `@inmem` scenarios for AC-4–AC-6; the
  argv-limit cases (AC-1–AC-3) need real limits, so they belong in the live tier
  of the git contract, not a `@live` scenario

## Already In Place

- `src/platform/Workspace.ts` `worktreeSync` already enumerates untracked files
  with `git status --untracked-files=all` and hashes them in chunks of
  `HASH_CHUNK = 500` argv paths; it must keep working as it is and is the
  pattern the fix may reuse
- `src/platform/Git.ts` `changedPaths` uses `--exclude-standard`, so
  `.gitignore` and `.git/info/exclude` already hide ignored trees — the reported
  workaround; the fix and AC-4's count must keep honouring both
- `src/platform/Git.ts` `hashObjects` must never take `--no-filters`: its ids
  match `ls-tree`'s only through the repo's clean filters, pinned in both tiers;
  any chunked or stdin variant keeps that
- `src/platform/Git.ts` `changedPaths` lets untracked classification override
  the tracked diff for the same path (no phantom `D`), and skips both
  classification reads when nothing is untracked; both must hold after the fix
- `src/platform/Git.ts` `changedPaths` tolerates an empty repository (no HEAD):
  no tracked changes, every untracked path `A`; must keep holding
- `src/cli/Cli.ts` `report` renders any failure as
  `{"state":"error","prompt":…}` under `--json` with `EXIT_RUNTIME_ERROR`; the
  AC-4 refusal surfaces through it
- `src/twins/GitTiers.ts` `runGitServiceContract` runs every `changedPaths` case
  against live git and `InMemRepo`; new cases go there so both tiers stay held
  together

## Answered Questions

### Does the fix change which paths are reported or how they are classified?

No — only how argv is built. `A`/`M`/no-entry semantics, clean-filter hashing
and ignore rules stay exactly as today.

### Should the refusal be a new driver content kind?

No — gtd cannot add a sixth content kind without changing every driver; it
surfaces as the existing error envelope with a clear message.

### What should gtd do when the worktree holds a huge untracked tree?

Refuse above a threshold with a clear message naming the count and the largest
untracked directories; nothing lands until the tree is ignored or deleted.

### Where does the untracked-file threshold come from?

Fixed at 1,000 untracked, un-ignored files; no config key.

### Does `gtd check --open-threads` refuse too?

No — it only reads, never lands; refusing would hide threads the human left.

### Does the refusal get its own exit code?

No — it reuses `EXIT_RUNTIME_ERROR`, keeping the pinned exit-code set unchanged.
