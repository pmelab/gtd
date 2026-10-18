# Architecture: PR #392 review round 1 — ship restack fixes

## Interfaces

All code changes land in `claude/hooks/ship.ts`; `ship()` keeps its exported
signature. **Behaviour is pinned by the git/gh argv the scripted test repository
in `claude/hooks/ship.test.ts` matches, plus the refusal texts below.** Every
test drives `ship()`; no internal helper is tested directly.

### ship — git/gh argv contract

```text
# concern 1: explicit refspec, skipped by -n as today
git fetch origin +refs/heads/<default>:refs/remotes/origin/<default>

# concern 6: read before the rebase (and under -n), after the merge-commit shortcut
git worktree list --porcelain        # a remaining lower slice branch listed here refuses

# concern 2: after a non-zero rebase
git rev-parse --git-path rebase-merge
test -d <that path>                  # 0 = rebase in progress → git rebase --abort
git rev-parse --verify --quiet REBASE_HEAD   # names the slice only; absent → top slice

# concern 6 backstop: after a zero-exit rebase, before any git config write or push,
# for each remaining lower slice branch <b>:
git merge-base --is-ancestor origin/<default> refs/heads/<b>   # must be 0
git merge-base --is-ancestor <from> refs/heads/<b>             # must be non-zero
# on failure, roll the restack back, then refuse:
git update-ref refs/heads/<b> <pre-rebase sha> <post-rebase sha>   # each moved lower branch
git reset --keep <pre-rebase HEAD>                                 # read just before the rebase

# concern 5: hand-restack shape test, replacing is-ancestor origin/<default> <lowest>
git merge-base --is-ancestor <lowest>~1 origin/<default>
```

- **`<from>` is always the floor**, `<recorded top>~(last-(done-1))`: the
  `refs/heads/<branch>-<merged slice>` lookup is removed from both the restack
  and the hand-restack path (concern 4, see Answered Questions).
- **Only a `MERGED` view whose `baseRefName` equals the default branch counts as
  merged**; `done` stops at the first slice that does not (concern 3).
- **The dry call `recordedRefusal` makes runs no `git fetch`, no
  `git ls-remote`, no `git worktree list`, no hand-restack check** (concern 7).
- **The restack preview carries no `Retarget:` line**; `stackPreview` prints the
  only one (concern 8).

### ship — refusal texts

```ts
// concern 3 — before any fetch, rebase, config write, push or gh pr edit
;`The pull request for slice ${name} (#${number}, ${sliceBranch}) merged into ${baseRefName}, not ${defaultBranch}; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`
// concern 6, precheck — before the rebase; -n prints it as a refusal too
`Slice branch ${b} is checked out in worktree ${path}, so git rebase --update-refs would skip it; nothing changed. Free it there (git -C ${path} switch --detach), then /gtd ship.`
// concern 6, backstop — after the rebase, refs rolled back, before config/push
`Slice branch ${b} was not restacked${path ? ` (checked out in worktree ${path})` : ""}; the restack is undone and nothing was pushed or recorded.`
// + the existing "the squash was kept; undo it with git reset --soft <preShip>" line
//   when a squash ran in the same ship

// concern 1 — fetch failure names the refspec
`git fetch origin +refs/heads/${base}:refs/remotes/origin/${base} failed; nothing changed.\n${stderr}`
```

### ship — internal seams

```ts
// concern 7: false skips handRestack and restackOf; mergedSlices, topGuard and
// chain still run. recordedRefusal passes false; every other caller omits it.
async function resumable(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  isDry: boolean,
  at: string,
  planRestack?: boolean, // default true
): Promise<Resumed | string>

// concern 3 + 8: takes the default branch; views no longer returned (retarget gone)
async function mergedSlices(
  io: ShipIo,
  recorded: string[],
  branchOf: (i: number) => string,
  baseBranch: string,
): Promise<{ done: number } | string>

// concern 9: the rebased variant carries the top it read, so handRestack never
// re-reads TOP_KEY; resumable reads defaultBranch once and passes it down
async function topGuard(
  git: Git,
  ok: Ok,
  branch: string,
  recorded: string[],
  from: number,
): Promise<
  { top: string } | { rebased: true; top: string } | { refusal: string }
>

// concern 4 + 9: the one from-lookup and link building both paths call.
// from = rev-parse of `${top}~${last - (done - 1)}`, undefined when done is 0 or
// top is "" or it does not resolve; links = recorded.slice(done) with
// commits[j] ?? HEAD.
async function stackRest(
  git: Git,
  c: {
    branch: string
    recorded: string[]
    done: number
    top: string
    commits: string[]
    branchOf: (i: number) => string
  },
): Promise<{ from?: string; links: Link[] }>

// concern 8: `retarget` removed
async function restackOf(
  io: ShipIo,
  git: Git,
  ok: Ok,
  c: {
    branch: string
    baseBranch: string
    from: string
    links: Link[]
    isDry: boolean
  },
): Promise<Restack | string | undefined>

// concern 9: no defaultBranch / TOP_KEY / from reads of its own
async function handRestack(
  io: ShipIo,
  git: Git,
  ok: Ok,
  c: {
    branch: string
    baseBranch: string
    top: string
    from: string
    links: Link[]
  },
): Promise<Resumed | string | undefined>

// concern 6: parses `git worktree list --porcelain` (`worktree <path>` /
// `branch refs/heads/<b>` blocks); first of `branches` checked out anywhere
async function checkedOutElsewhere(
  io: ShipIo,
  branches: string[],
): Promise<{ branch: string; path: string } | undefined | string>
```

- **`restacked` renames its local `names` to `written`**, ending the shadow of
  module-level `names()` (concern 9).
- **`finishResume` drops its `views` parameter**; it refuses
  `The commit of merged slice … cannot be found` when `stackRest` yields no
  `from`, as today.

## Call Stacks

- `/gtd ship`, no process at HEAD → `ship()` → `squash()` → `resumeAlone()` →
  `resumable()` → `defaultBranch()` once → `mergedSlices(baseBranch)` (refuses a
  slice merged off the default branch) → `topGuard()` → `chain()` →
  `stackRest()` → `finishResume()` → `restackOf()` (refspec fetch, merge-commit
  shortcut, `checkedOutElsewhere()`, `originLeases()`) → `Restack.run()` (rebase
  → rebase-merge check/abort, or backstop verify/rollback) → `restacked()` →
  `stackPullRequests()`
- `/gtd ship`, process at HEAD → `squash()` → `stackReads()` → `resumable()`
  (same reads, before the history push) → `squashOntoStack()` →
  `Restack.run(preShip)` → `stackPullRequests()`
- `/gtd ship`, fresh multi-slice process over a record → `stackReads()` →
  `stackPrecheck()` → `recordedRefusal()` → `resumable(…, planRestack=false)` →
  `mergedSlices()`/`topGuard()`/`chain()` only
- next ship after a hand rebase → `resumable()` → `topGuard()` `{rebased, top}`
  → `stackRest()` → `handRestack()` (`<lowest>~1` on `origin/<default>`,
  `<from>` off `<lowest>`, `originLeases()`) → `restacked()`
- `/gtd ship -n` → `resumable(isDry)` → `restackOf()` preview (no fetch, no
  Retarget line) → `stackPreview()` (the only Retarget line)

## E2E Scenarios

No e2e change. The Claude Code mod has no cucumber tier;
`claude/hooks/ship.test.ts`'s scripted repository is ship's whole suite, as for
the #383 restack itself.

## Unit Tests

### ship — git/gh argv contract

- unit: claude/hooks/ship.test.ts — the restack fetches
  `git fetch origin +refs/heads/main:refs/remotes/origin/main`, never the bare
  `git fetch origin main`, then rebases onto `origin/main` (covers 1)
- unit: claude/hooks/ship.test.ts — a failed refspec fetch refuses naming the
  refspec, nothing written (covers 1)
- unit: claude/hooks/ship.test.ts — rebase fails, `REBASE_HEAD` absent,
  `rebase-merge` present: `git rebase --abort` runs, the conflict refusal names
  the top slice, no push, no `git config` write, no `gh pr edit` (covers 2)
- unit: claude/hooks/ship.test.ts — rebase fails with no `rebase-merge` dir (old
  git): no abort, stderr reported, refs unchanged (covers 2)
- unit: claude/hooks/ship.test.ts — lowest PR `MERGED` into `feat/x-other` (a
  slice branch): the merged-into refusal, and no fetch, rebase, `git config`
  write, push or `gh pr edit` (covers 3)
- unit: claude/hooks/ship.test.ts — lowest PR `MERGED` with
  `baseRefName: "main"` still restacks as today (covers 3)
- unit: claude/hooks/ship.test.ts — local `feat/x-refactor` diverged from the
  floor: the rebase uses the floor commit, never the local sha (covers 4)
- unit: claude/hooks/ship.test.ts — hand restack with a stale local merged
  branch: `<from>` is the floor and the hand restack is still adopted (covers 4)
- unit: claude/hooks/ship.test.ts — hand restack, then origin advanced
  (`origin/main` not under the lowest branch, `<lowest>~1` under `origin/main`):
  leased pushes, lowest PR retargeted, stack kept (covers 5)
- unit: claude/hooks/ship.test.ts — `<lowest>~1` not under `origin/main`: not a
  hand restack, the record drops and the branch ships alone (covers 5)
- unit: claude/hooks/ship.test.ts — three slices, `feat/x-middle` listed by
  `git worktree list --porcelain` at `/elsewhere`: refusal names both, no
  rebase, no push, no `git config` write; `-n` prints the same refusal
  (covers 6)
- unit: claude/hooks/ship.test.ts — rebase exits 0 but `feat/x-middle` still
  contains `<from>`: backstop refusal names the branch, `update-ref` and
  `reset --keep` restore pre-rebase refs, no push, no `git config` write
  (covers 6)
- unit: claude/hooks/ship.test.ts — fresh multi-slice ship over a record with a
  merged lower slice: no `ls-remote`, no `fetch`, no `worktree list`; a scripted
  failing `ls-remote` does not refuse (covers 7)
- unit: claude/hooks/ship.test.ts — `-n` after a merged lower slice prints
  exactly one line starting `Retarget:` (covers 8)

### ship — refusal texts

- unit: claude/hooks/ship.test.ts — each refusal above matches its text
  verbatim, asserted in the tests of concerns 1, 3 and 6 (covers 1, 3, 6)

### ship — internal seams

- unit: claude/hooks/ship.test.ts — every existing restack, hand-restack,
  conflict and `-n` case in the `a lower slice merged by squash` block passes
  unchanged against the shared `stackRest` and the renamed local; only argv
  edits forced by concerns 1, 2, 4 and 8 touch it (covers 9)
- unit: claude/hooks/ship.test.ts — a hand-restack ship runs
  `git config --local --get branch.feat/x.gtdStackTop` exactly once (covers 9)

### Chores

- chore: docs/driver.md — restack paragraph: the merged-into-a-slice-branch
  refusal, the other-worktree refusal (and that `-n` shows it), the rolled-back
  backstop, and the hand-restack shape now "the lowest remaining slice sits on a
  commit of `origin/<default>`"; no `src/*.ts` module or function named
  (covers 10)
- chore: README.md — the ship sentence adds that the restack refuses, with
  nothing changed, when a lower pull request merged into another slice branch or
  a slice branch is checked out in another worktree (covers 10)

## Merged Concerns

### Ship restack fixes (concerns 1–9 → one package)

All nine center on `claude/hooks/ship.ts` and `claude/hooks/ship.test.ts`;
concern 9 refactors the logic 4 and 5 change rather than consuming an interface
they create, so one package lands them in order 1–8, then 9. Concern 10 keeps
its own package (`README.md`, `docs/driver.md`).

- **1. Fetch the default branch with an explicit refspec — TECHNICAL**:
  `git fetch origin <base>` updates `origin/<base>` only when the remote carries
  a default refspec. **Fetch `+refs/heads/<base>:refs/remotes/origin/<base>`
  explicitly** in `restackOf`, so the restack always rebases onto the freshly
  fetched tip. Test: a remote with no default fetch refspec still restacks onto
  the new `origin/<base>`.
- **2. Detect an in-progress rebase by the rebase-merge dir — TECHNICAL**:
  Detection reads only `REBASE_HEAD`. **Treat a rebase as in progress whenever
  `git rev-parse --git-path rebase-merge` exists, and abort it in every such
  case.** Test: a stopped rebase with no `REBASE_HEAD` still aborts and refuses
  cleanly.
- **3. Count a slice merged only when it merged into the default branch —
  TECHNICAL**: `mergedSlices` counts any `MERGED` PR as done, whatever base it
  merged into, and the restack then cuts that commit out. **Only a slice whose
  PR `baseRefName` is the default branch counts as merged-into-default; a slice
  merged into another slice branch refuses with nothing changed** — no rebase,
  no config write, no push, no retarget. Test: PR merged into a slice branch
  refuses, tree and refs unchanged.
- **4. Validate the local merged slice branch before using it as `from` —
  TECHNICAL**: `finishResume` prefers the local merged slice branch as `from`
  unchecked. **Use the local branch only when it checks out against HEAD — the
  review states this as "an ancestor of the branch (HEAD) / equals the
  floor-derived commit"; the build picks whichever check the floor makes exact —
  otherwise use the floor.** Test: a stale or diverged local slice branch is
  ignored in favour of the floor.
- **5. Detect a hand restack after origin moves on — TECHNICAL**: `handRestack`
  requires `origin/<default>` to be an ancestor of the lowest remaining slice
  branch, so any fetch after the hand rebase (origin moved forward) drops the
  record and the top ships alone. **Test instead that the commit beneath the
  lowest remaining slice (`lowest~1`) is an ancestor of `origin/<default>`.**
  Test: hand restack, then origin advances, then ship still adopts the restack
  and keeps the stack.
- **6. Refuse when `--update-refs` skipped a slice branch — TECHNICAL**:
  `git rebase --update-refs` silently skips a branch checked out in another
  worktree; `restacked` re-reads refs without checking they moved. **After the
  rebase, verify every remaining slice branch contains `origin/<default>` and
  not `from`; otherwise fail with a clear message naming the branch and the
  worktree, before any config write or push.** Test: a slice checked out in a
  second worktree yields that refusal, no push, no recorded-stack change.
- **7. Skip restack planning in recordedRefusal's dry call — TECHNICAL**:
  `recordedRefusal`'s dry resumable call now plans a restack — an `ls-remote`
  over the network plus restack refusals — on a fresh multi-slice ship. **That
  call skips restack planning and hand-restack checks entirely.** Test: a fresh
  multi-slice ship runs no `ls-remote` and hits no restack refusal.
- **8. Drop the duplicate Retarget preview line — TECHNICAL**: The restack
  preview prints its own `Retarget:` line on top of `stackPreview`'s. **Remove
  `retarget` from `restackOf`; `stackPreview` alone reports it.** Test: `-n`
  output carries exactly one Retarget line.
- **9. Share the from-lookup and link building; fix the shadowed name —
  TECHNICAL**: `handRestack` duplicates `finishResume`'s `from` lookup and link
  building and re-reads the default branch and `TOP_KEY`. **Extract one shared
  helper both call; rename `const names` in `restacked`, which shadows the
  module-level `names()`.** Behaviour-neutral: the existing and new tests stay
  green. Lands after concerns 4 and 5, which change the logic being shared.

## Answered Questions

### Do the three deferred review notes ride along with this work?

No — the human's start edit deleted all three `## Deferred review notes`
sections (836985b, daed27f, eda53bb) when writing this sketch; they stay out of
scope.

### Should a slice merged into another slice branch be restacked some other way instead of refused?

No — the review list states the outcome: refuse with nothing changed.

### Does the other-worktree failure stop before any side effect?

Yes — the review list requires the refusal before any config write or push.

### Which check validates the local merged slice branch (concern 4)?

Equality with the floor: the recorded top sits one commit per lower slice above
the base, so `<top>~(last-(done-1))` is the merged slice's commit exactly, and
"local equals floor" is the same as "use the floor" — the local lookup is
deleted. **Risk: a record with no `gtdStackTop` now yields no `from`, so a hand
restack on it drops the record and ships alone** (the two keys are written as a
pair, so only a hand-edited config hits this).

### What does `lowest~1` mean when only the top branch remains with several commits (concern 5)?

Taken literally. **Risk: a re-shipped multi-commit top as the only remaining
slice fails the shape test after a hand restack and ships alone** — that path
still pushes with a lease and retargets the PR to the default branch, so the
outcome differs only in the "dropped it" log line.

### How is the `rebase-merge` dir tested for existence (concern 2)?

`git rev-parse --git-path rebase-merge`, then `test -d <path>` through `io.run`,
from the repository root where `io.run` already runs; the slice name still comes
from `REBASE_HEAD` when present, else the top slice.

### What state does the other-worktree refusal leave behind (concern 6)?

Nothing changed: a `git worktree list --porcelain` precheck refuses before the
rebase (and under `-n`), and the required post-rebase verify stays as a backstop
that rolls every moved ref back to its pre-rebase sha before refusing. Leaving
refs rebased would make the next ship see a broken chain and silently drop the
stack.

### Does a `MERGED` PR whose base is neither the default branch nor a slice branch count?

No — only `baseRefName` equal to the default branch counts; any other base,
including a missing `baseRefName`, gets the concern-3 refusal.

### With hand-restack checks skipped in `recordedRefusal`, what happens to a hand-restacked live record (concern 7)?

It reads as dead, so a fresh multi-slice ship proceeds over it instead of
refusing. **Risk: that ship replaces a hand-restacked record and leaves its
remaining slice PRs open** — accepted, since concern 7 orders the checks skipped
entirely.
