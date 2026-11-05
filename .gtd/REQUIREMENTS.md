# gtd: spawn E2BIG on a large untracked tree (pmelab/gtd#568)

## Open Questions

### What should gtd do when the worktree holds a huge untracked tree?

Fixing E2BIG alone makes `gtd next`/`gtd land` work again — but the landing
script's `git add -A` then commits every one of those files (12,448 files, 222
MB in the report). The fork: stop the human, warn them, or stay silent.

- [x] Refuse above a threshold, with a clear message
  - `gtd next`/`gtd land` fail with "N untracked files; add a .gitignore?"
    naming the count and the largest untracked directories
  - nothing gets committed until the human ignores or deletes the tree
  - a legitimately large generated tree also blocks until ignored
- [ ] Warn above a threshold, then carry on
  - same message on stderr; the process continues and lands the files
  - a driver reading only `--json` stdout never sees it; the 222 MB lands in
    history
- [ ] No threshold — only fix E2BIG
  - smallest change; any size works
  - an un-ignored `node_modules` silently lands in a commit
- [ ] _your answer_

### Where does the untracked-file threshold come from?

Only matters if the answer above keeps a threshold. Decides whether a project
can raise it and what number ships.

- [x] Fixed at 1,000 untracked files
  - catches `node_modules` early; a big scaffold step (generated fixtures,
    vendored code) trips it
- [ ] Fixed at 10,000 untracked files
  - rarely trips by accident; a 5,000-file `node_modules` slips through
- [ ] Default 1,000, overridable per workflow by a config key
  - new public config key to document in `docs/configuration.md`
  - workflow authors tune it; one more surface to keep compatible
- [ ] _your answer_

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

### 2. A clear signal for a huge untracked tree — PRODUCT

The report asks for "N untracked files; add a .gitignore?" instead of E2BIG.
Behaviour and threshold hang on the two open questions above.

### 3. Any other unbounded argv site — TECHNICAL

Audit found none: every other spawn takes fixed argv, one path, or an
already-chunked list. Landing scripts and formatters never receive a path list.
The builder re-checks `pathspec()` in the emitted scripts, whose callers were
not traced.

## Acceptance Criteria

- AC-1: In a repository whose worktree holds an untracked, un-ignored directory
  with enough files that their joined paths exceed the OS argument limit (e.g.
  20,000 files under nested long names), `gtd next --json` resolves the
  process's rest and prints its normal envelope instead of
  `{"state":"error","prompt":"spawn E2BIG"}` — subject to AC-4 when a threshold
  is chosen
- AC-2: In that same repository, the changed-paths read reports every one of
  those untracked files as added (`A`), exactly as it does for a small untracked
  set
- AC-3: Against a diff base older than HEAD, where most of a large untracked set
  (past the argument limit) already exists at the base, the changed-paths read
  reports each path `M` when its bytes differ from the base, and omits it when
  they match — no E2BIG, no path wrongly reported added
- AC-4: When the worktree holds more untracked, un-ignored files than the
  threshold the open questions settle, `gtd next` and `gtd land` report a
  message naming the untracked file count and suggesting a `.gitignore` entry,
  with the behaviour (refuse or warn) the open question settles

## Impact

- core / `src/platform` — `Git.ts` `changedPaths`, `blobsAtRef`, `hashObjects`:
  the only unbounded argv sites; the live git port changes
- twins / `src/twins` — `GitTiers.ts` `runGitServiceContract` gains a
  large-untracked-set case run against both tiers; `InMemRepo` has no argv
  limit, so the case proves only result parity there
- core / `src/edge` — `pendingChanges` → `restAt`: every current-rest read
  (`gtd next`, `gtd land`, status) goes through `changedPaths`; a threshold
  check (AC-4) lands at or near here
- core / `src/cli` — `gtd check --open-threads` calls `changedPaths(diffBase)`,
  the path that reaches `hashObjects`; error rendering via `report` in `Cli.ts`
  if AC-4 refuses
- Public surface: AC-4's message on `gtd next`/`gtd land` (stdout envelope or
  stderr); a new config key and its `docs/configuration.md` entry if the
  threshold is configurable; `docs/cli.md` exit-code table only if a new exit
  code is introduced (it is pinned to the real set)
- Surprise: E2BIG is a synchronous throw from `spawn`, so it escapes
  `Effect.catch` as a defect — the existing "failure means every path is `A`"
  fallbacks never ran
- Surprise: the landing script's `git add -A` commits every untracked,
  un-ignored file — fixing E2BIG alone lets a stray `node_modules` land
- `tests/integration/features/` — new `@inmem` scenario for AC-4; AC-1–AC-3 need
  real argv limits, so they belong in the live tier of the git contract, not a
  `@live` scenario

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
  `{"state":"error","prompt":…}` under `--json` with `EXIT_RUNTIME_ERROR`;
  AC-4's refusal, if chosen, surfaces through it
- `src/twins/GitTiers.ts` `runGitServiceContract` runs every `changedPaths` case
  against live git and `InMemRepo`; new cases go there so both tiers stay held
  together

## Answered Questions

### Does the fix change which paths are reported or how they are classified?

No — only how argv is built. `A`/`M`/no-entry semantics, clean-filter hashing
and ignore rules stay exactly as today.

### Should the refusal (if chosen) be a new driver content kind?

No — gtd cannot add a sixth content kind without changing every driver; it
surfaces as the existing error envelope (or a stderr warning) with a clear
message.
