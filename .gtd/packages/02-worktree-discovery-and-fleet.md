# 02 — Worktree discovery and the fleet screen

One requirement, unmerged. It ships alone as a read-only triage dashboard, which
is already worth having.

The number that shapes this package: **one `gtd next --json` costs 520–660 ms**
— a 10.36 MB bundle parse plus its git subprocesses. Thirty worktrees is ~18 s
serial and ~2.5 s at concurrency 8. The fleet screen is the first thing the
phone loads, so beat reads are memoized and only a cold read pays that cost.

## Requirement — concern 2

### 2. Worktree discovery and the fleet screen — PRODUCT

Scan the configured roots for directories containing a `.git` entry — a linked
worktree's `.git` is a file, which is how worktrees parked outside their repo
are found without `git worktree list`. Depth 4, skipping `node_modules`, dotted
directories and symlinks, rescanned on every request. Every worktree found is
listed, including ones with no gtd process. A worktree's URL identity is a short
hash of its absolute path.

Rows group into four buckets: **Wants you** (`!idle && actor: human`, plus every
`kind: stalled`), **Working**, **Broken** (spawn failed, unsupported version,
unparseable beat), and **Quiet** (`idle`), collapsed behind its count. A row is
repo + branch, the state's `label`, and how long it has rested. Wants-you sorts
oldest-first; other buckets newest-first. The wants-you count goes in the
document title.

**Acceptance**: `actor: human` alone must not put a worktree in Wants you — an
idle worktree reports `actor: human` too, so `idle` is load-bearing in the
predicate. A worktree with no gtd config returns `kind: message` and workflow
warnings on stderr; the warnings are not a failure. See
[#212](https://github.com/pmelab/gtd/issues/212) and
[#213](https://github.com/pmelab/gtd/issues/213).

## Tasks

### T1 — the discovery walk

Walk each configured root to depth 4, skipping `node_modules`, dotted
directories and symlinks, and yield every directory containing a `.git` entry of
either shape. A linked worktree's `.git` is a **file** holding a `gitdir:`
pointer, which is how worktrees parked outside their repository are found
without `git worktree list`; `src/WorktreeState.ts` already parses exactly that,
filesystem-only, with no `git` subprocess — reuse it rather than
re-implementing. A worktree's URL identity is the first 12 hex characters of a
SHA-256 of its absolute path.

Paths: `src/serve/Discover.ts`, `src/serve/Discover.test.ts`,
`src/WorktreeState.ts`.

- [ ] a directory with a `.git` directory is found
- [ ] a directory with a `.git` file holding a `gitdir:` pointer is found, even
      when its repository lives outside every configured root
- [ ] a match at depth 4 is found and one at depth 5 is not
- [ ] `node_modules`, dotted directories and symlinked directories are not
      descended into
- [ ] two roots yielding the same absolute path produce one entry, not two
- [ ] the identity is stable across runs and differs for two paths differing in
      one character
- [ ] a configured root that does not exist is skipped without failing the scan
- [ ] the scan re-runs on every request and caches nothing

### T2 — the beat read and its projection

One `gtd next --json` per worktree, spawned with the worktree as its working
directory and its output parsed as JSON. The document is **projected server-side
and never shipped whole**: this repository's own beat is 7.9 KB because its
content and system fields carry the entire prompt, and thirty of those is a
quarter megabyte for five fields. The row is the worktree id, repository name,
branch, the state's label, kind, actor, idle, rest timestamp and bucket.

Rest age is HEAD's committer date. There is no rest timestamp on the beat, and
the last turn commit is the moment the rest began.

Paths: `src/serve/Beat.ts`, `src/serve/Beat.test.ts`, `src/serve/Fleet.ts`.

- [ ] a beat's content and system fields never reach the client on the fleet
      payload
- [ ] a fleet payload for 30 worktrees stays under 32 KB
- [ ] the row's rest timestamp equals HEAD's committer date
- [ ] the spawned read never mutates the worktree — no commit, no file write, no
      reference move

### T3 — the memo

The directory scan is redone on every request, as the requirement settles — it
is filesystem walks, not subprocesses. Each worktree's **beat** is cached
against a key of three things: **HEAD's sha, the mtime of the resting state's
steering file, and the mtime of the log path the beat itself reports**. Cold
reads run at bounded concurrency, never unbounded, so a 30-worktree first load
cannot fork 30 node processes at once.

**Risk, blunt**: a change none of those three cover shows a stale row until
something in the key moves. That is the accepted cost, and it is why the key
includes the loop log rather than HEAD alone.

Paths: `src/serve/Beat.ts`, `src/serve/Beat.test.ts`, `src/serve/Fleet.ts`.

- [ ] a second fleet request with all three key parts unchanged spawns zero
      subprocesses
- [ ] a new commit invalidates that worktree's entry and no other's
- [ ] touching the resting state's steering file invalidates the entry
- [ ] touching the loop log invalidates the entry
- [ ] a warm fleet load of 30 worktrees completes in under 100 ms
- [ ] cold reads are capped at a fixed concurrency and a 30-worktree cold load
      never has more than that many child processes alive at once
- [ ] the directory scan itself is not memoized

### T4 — the four buckets, the sort, and the title

`idle` is load-bearing and `actor` alone is not: an idle worktree reports a
human actor too. So **Wants you** is not-idle-and-human-actor, plus every
stalled kind. **Working** is the loop registry's answer, and until a loop can be
started nothing is ever Working. **Broken** is spawn failure, a JSON parse
failure, or a version outside the supported range. **Quiet** is idle, collapsed
behind its count.

Paths: `src/serve/Fleet.ts`, `src/serve/Fleet.test.ts`,
`src/web/screens/Fleet.tsx`, `src/web/screens/Fleet.stories.tsx`.

- [ ] an idle worktree reporting a human actor lands in Quiet, never in Wants
      you
- [ ] a not-idle worktree with a human actor lands in Wants you
- [ ] a stalled kind lands in Wants you regardless of actor or idle
- [ ] a not-idle worktree with an agent actor lands in neither Wants you nor
      Quiet
- [ ] Wants you sorts oldest rest first; every other bucket sorts newest first
- [ ] Quiet renders collapsed, showing only its count, and expands on tap
- [ ] the document title carries the Wants-you count and updates when it changes
- [ ] every worktree found is listed, including ones with no gtd process

### T5 — the error taxonomy

A worktree with no gtd config is **not** broken: it resolves through the bundled
default workflow, returns a message kind, and prints workflow warnings on
standard error. **Those warnings are not a failure** — standard error on a zero
exit is discarded. Broken rows carry the captured standard error verbatim,
because that text is the only thing distinguishing one refusal from another.

Paths: `src/serve/Beat.ts`, `src/serve/Fleet.ts`, `src/serve/Fleet.test.ts`,
`src/web/screens/Fleet.tsx`.

- [ ] a worktree with no gtd config renders as a normal row with a message kind,
      not as Broken
- [ ] workflow warnings on standard error with a zero exit do not mark a row
      Broken
- [ ] a non-zero exit puts the row in Broken and its standard error is shown
      verbatim, not truncated or summarized
- [ ] output that is not valid JSON puts the row in Broken
- [ ] a version outside the supported range puts the row in Broken and names the
      version found
- [ ] one Broken worktree does not fail the whole fleet request

### T6 — the fleet screen

A row is repository plus branch, the state's label, and how long it has rested.
Buckets in fixed order, phone-first, with pull-to-refresh.

Paths: `src/web/screens/Fleet.tsx`, `src/web/screens/Fleet.stories.tsx`,
`src/web/api.ts`, `src/serve/Router.ts`.

- [ ] a row shows repository, branch, label and rest age
- [ ] a row with no label falls back to the state name rather than rendering
      blank
- [ ] the screen renders correctly at 390 px wide
- [ ] pull-to-refresh re-requests and re-renders
- [ ] an empty fleet renders an explanatory empty state, not a blank screen
- [ ] stories cover all four buckets, a Broken row with standard error, and the
      empty fleet
