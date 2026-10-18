# Architecture: PR #392 review round 3 fixes

All six fixes are in `claude/hooks/ship.ts`, and their tests are in
`claude/hooks/ship.test.ts`. That puts them in one package (see
`## Merged Concerns`). The README and `docs/driver.md` get one rewording each.
**Every fix lands with a `ship.test.ts` case that fails before the fix.**

## Open Questions

### Must a slice merged into a lower slice's branch have merged before that lower slice did?

Concern 3 accepts a MERGED slice b whose base is `<branch>-a` when a counts as
merged into the default branch. **That rule alone is wrong in one case. If a
merged first and its branch was kept (auto-delete off), b's later merge into
`<branch>-a` never reaches the default branch. Ship still counts b as landed and
drops it from the stack, so b's change silently misses the default branch.**

- [x] Add a merge-order check: b counts only if it merged no later than a
  - `viewPr` asks for `mergedAt` too, and `View` gains `mergedAt?: string`
  - every scripted `gh pr view … --json` key in `ship.test.ts` changes, which is
    wide test churn
  - closes the silent-loss case: a b that merged after a refuses with the
    existing "merged into …" text
- [ ] Ship the rule as the requirement words it
  - smallest diff: base names only, no new gh field
  - **risk stays: with branch auto-delete off, a slice merged into an
    already-merged lower branch is counted as landed and its change is lost**
- [ ] _your answer_

## Interfaces

```ts
// Concern 1. Before: the first of `<default>`, `origin/<default>` that
// resolves. Now: when both resolve, return `origin/<default>` if
//   merge-base --is-ancestor <default> origin/<default>        (origin descends)
// or, failing that, if m = merge-base origin/<default> HEAD is non-empty and
//   !merge-base --is-ancestor m <default>                       (stack on origin only).
// Otherwise return `<default>`. With only one of them, return that one, as
// today. Return values stay bare names (`main` / `origin/main`), so messages and
// existing scripted keys keep their form. preflight passes git too.
async function resolveRef(
  git: Git,
  ok: Ok,
  baseBranch: string,
): Promise<string | undefined>
```

```ts
// Concern 2. `known` was a commit to test with is-ancestor. It is now a
// predicate. restackOf passes
//   (l, sha) => ok("merge-base", "--is-ancestor", sha, l.commit)
// handRestack passes keptByHand. On false, the existing text is unchanged:
//   origin/<b> holds commits <b> lacks; nothing changed. Pull or reconcile <b>, then ship.
async function originLeases(
  io: ShipIo,
  ok: Ok,
  links: Link[],
  kept: (l: Link, sha: string) => Promise<boolean>,
): Promise<Link[] | string>

// The identity isRecordedTop already compares, now shared.
const IDENTITY = "%an%x00%ae%x00%at%x00%B"

// Concern 2. True when `sha` exists locally and every commit in
//   git log --format=IDENTITY%x1e <sha> ^<lower> ^<onto> ^<from>
// has its identity in
//   git log --format=IDENTITY%x1e <onto>..refs/heads/<b>
// `lower` is `top` when `cat-file -e top` succeeds. Otherwise it is
// `merge-base <sha> refs/heads/<b>`. `^<from>` drops the merged slice's commit.
// A merge commit on origin counts as a commit: a collaborator's merge refuses.
// Refusing there is the safe side. The reflog is no longer read.
async function keptByHand(
  git: Git,
  ok: Ok,
  c: { branch: string; sha: string; top: string; from: string; onto: string },
): Promise<boolean>
```

```ts
// Concern 6: `merged` is removed. The one call site in resumable stops passing it.
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
    plan: boolean
  },
): Promise<Resumed | string | undefined>
```

```ts
// Concern 3. The signature is unchanged; the loop rule changes. A MERGED slice at
// index `done` counts when its baseRefName is baseBranch, or is
// branchOf(k) for some k < done (a slice already counted). Anything else
// returns the existing "merged into <base>, not <default>" refusal, and nothing
// changes. If the open question picks the merge-order check: View gains
// `mergedAt?: string`, viewPr's --json list gains `mergedAt`, and a lower-branch
// base counts only when its mergedAt <= the lower slice's mergedAt.
async function mergedSlices(
  io: ShipIo,
  recorded: string[],
  branchOf: (i: number) => string,
  baseBranch: string,
): Promise<{ done: number } | string>
```

```ts
// Concern 4. The exported signature is unchanged. One case changes: ls-remote
// shows origin lost the branch (the key is unset). The push then takes
// `--set-upstream origin <b>`, with no lease, even when a stale
// refs/remotes/origin/<b> still resolves.
export async function pushBranch(
  io: ShipIo,
  branch: string,
  head?: string,
  lease?: string,
): Promise<string | undefined>
```

```ts
// Concern 5. Signatures are unchanged. Every git argument that names a slice
// branch or the top branch is written as `refs/heads/<b>`:
//   brokenShape:   rev-parse refs/heads/<b>~1, rev-parse <below>, rev-list --count <under>..HEAD
//   strayBranch:   rev-list <from>..refs/heads/<branch>
//   restacked:     merge-base origin/<default> refs/heads/<lowest>, rev-list --reverse refs/heads/<above>..refs/heads/<branch>
//   isRecordedTop: rev-list --reverse <onto>..refs/heads/<lowest>
//   handRestack:   is-ancestor <from> refs/heads/<lowest>, refs/heads/<lowest>~1, merge-base <onto> refs/heads/<lowest>
// Here <below>/<under> are refs/heads/<b> when they name a slice, and stay
// origin/<default> otherwise. Exception: the branch argument of
// `git rebase --update-refs --onto … <from> <branch>` stays bare, because rebase
// switches to it by branch name, and the hand-restack line users copy shows it.
async function brokenShape(
  git: Git,
  links: Link[],
  branch: string,
  onto: string,
): Promise<string | undefined>
async function strayBranch(
  git: Git,
  links: Link[],
  merged: string[],
  from: string,
  branch: string,
): Promise<string | undefined>
async function restacked(
  io: ShipIo,
  git: Git,
  branch: string,
  baseBranch: string,
  links: Link[],
)
async function isRecordedTop(
  git: Git,
  ok: Ok,
  onto: string,
  lowest: string,
  top: string,
): Promise<boolean>
```

## Call Stacks

- `/gtd ship` → `register.tsx` → `ship()` → `preflight` → `resolveRef`
  (concern 1)
- `ship()` → `preview` | `stackPullRequests` | `pullRequest` →
  `git merge-base <baseRef> HEAD` (used when `floor` is unset) → `createPr` /
  `updatePr` writer prompt log/diff
- `ship()` → `squash` → `plan` → `resumable` → `mergedSlices` → `viewPr`
  (`gh pr view`) (concern 3)
- `resumable` → `topGuard` → `chain` → `stackRest` → `handRestack` →
  `isRecordedTop` → `originLeases(kept = keptByHand)` → `git ls-remote` /
  `git log` (concerns 2, 5, 6)
- `resumable` → `finishResume` → `restackOf` → `strayBranch` →
  `originLeases(kept = is-ancestor)` → `run` → `git rebase --update-refs` →
  `unmovedSlice` → `shapeRefusal` → `brokenShape` → `restacked` (concern 5)
- `stackPullRequests` → `shipLink` → `pushLink` → `pushBranch` → `git ls-remote`
  → `git push` (concern 4)
- `pullRequest` → `pushBranch` (concern 4)

## E2E Scenarios

No e2e change. The mod has no cucumber tier, and `claude/hooks/ship.test.ts`
stands in for one, as the requirements already settled.

## Unit Tests

Every test below drives `ship()` or `pushBranch` through the scripted `repo()`
io. No test calls an internal helper. The shared `feature` fixture gains
`git merge-base --is-ancestor main origin/main` → code 1, so the tests that
exist today still resolve `main`.

### resolveRef

- unit: claude/hooks/ship.test.ts — a restacked stack re-shipped with new work,
  with local `main` stale and diverged (`--is-ancestor main origin/main` fails,
  and `merge-base origin/main HEAD` is not in `main`): the merge base comes from
  `origin/main`, and every writer prompt's `git log`/`git diff --stat` range
  starts there, so it holds only the stack's own commits (covers concern 1)
- unit: claude/hooks/ship.test.ts — a retry after a failed push, with the same
  stale local `main`: the retry's writer log/diff ranges start at the
  `origin/main` merge base (covers concern 1)
- unit: claude/hooks/ship.test.ts — the single-PR path after "one slice left,
  forget the stack", with a stale local `main`: `pullRequest` takes
  `git merge-base origin/main HEAD`, and the writer log/diff hold only the
  branch's own commits (covers concern 1)
- unit: claude/hooks/ship.test.ts — local `main` behind `origin/main`
  (`--is-ancestor main origin/main` succeeds): base ref `origin/main` (covers
  concern 1)
- unit: claude/hooks/ship.test.ts — local `main` ahead of `origin/main`, with
  the branch cut from local `main`: base ref stays `main` (covers concern 1)
- unit: claude/hooks/ship.test.ts — only `origin/main` resolves: base ref
  `origin/main`, as today (covers concern 1)

### originLeases

- unit: claude/hooks/ship.test.ts — the planned restack still leases on origin's
  sha when it is an ancestor of the slice's pre-restack commit, and refuses with
  "Pull or reconcile" when it is not (covers concern 2)

### keptByHand

- unit: claude/hooks/ship.test.ts — a hand restack that dropped collaborator
  commit X (X is in `top..origin` and is missing by identity from
  `origin/main..refs/heads/<b>`, even though X is in the reflog): refuses with
  "Pull or reconcile <b>, then ship", and nothing is pushed, rebased, retargeted
  or written to config (covers concern 2)
- unit: claude/hooks/ship.test.ts — a hand restack that kept every commit (each
  identity in the origin range shows up in the local range): passes and pushes
  with `--force-with-lease=<b>:<origin sha>` (covers concern 2)
- unit: claude/hooks/ship.test.ts — the merged slice's commit sits in origin's
  range and is not in the local branch: it is excluded and does not refuse
  (covers concern 2)
- unit: claude/hooks/ship.test.ts — a stale recorded top (`cat-file -e top`
  fails): the range starts at `merge-base <sha> refs/heads/<b>` and the identity
  check still decides (covers concern 2)

### handRestack

- unit: claude/hooks/ship.test.ts — the existing hand-restack scenarios (a slice
  spotted as hand-restacked previews "spotted a hand restack" and pushes with
  the lease) still pass once `merged` is gone from the signature (covers
  concern 6)

### mergedSlices

- unit: claude/hooks/ship.test.ts — slice a merged into `main`, and slice b
  merged into `feat/x-a`: the restack goes ahead, with b counted as landed
  (covers concern 3)
- unit: claude/hooks/ship.test.ts — b merged into `feat/x-a` while a is still
  OPEN (it never merged into `main`): refuses with the "merged into feat/x-a,
  not main" text, and nothing changes (no fetch, push, rebase or config write)
  (covers concern 3)
- unit: claude/hooks/ship.test.ts — only if the open question picks the
  merge-order check: a merged into `main` first, and b merged into `feat/x-a`
  later (`mergedAt` after a's): refuses, and nothing changes (covers concern 3)

### pushBranch

- unit: claude/hooks/ship.test.ts — a stored lease key, `ls-remote` empty
  (origin deleted the branch), and a stale `refs/remotes/origin/feat/x` that
  still resolves: the key is unset, it runs
  `git push --set-upstream origin feat/x` with no `--force-with-lease`, and
  returns undefined (covers concern 4)

### brokenShape, strayBranch, restacked, isRecordedTop

- unit: claude/hooks/ship.test.ts — a three-slice restack and a hand restack,
  each with a tag named like a slice branch (`feat/x-middle`) that points at an
  unrelated commit. The bare-name keys are scripted to the tag's sha, and the
  `refs/heads/` keys to the branch's. The outcome, pushes and record writes
  match the no-tag run, and no slice-branch resolution uses a bare name (covers
  concern 5)

### Chores

- chore: claude/hooks/ship.ts — remove the `merged` parameter from `handRestack`
  and from its call site in `resumable`. `npm run typecheck` and the existing
  suite stay green (covers concern 6)
- chore: README.md — reword the restack refusal "when that pull request merged
  into another slice branch" to "merged into a slice branch whose chain never
  reached the default branch" (covers concern 3)
- chore: docs/driver.md — reword "the lowest pull request merged into a branch
  other than the default branch" to the same claim: merged into a slice branch
  whose chain never reached the default branch (covers concern 3)
- chore: claude/hooks/ship.test.ts — update existing scripted keys that move to
  `refs/heads/<b>` form (`rev-parse feat/x-middle~1`,
  `merge-base origin/main feat/x[-middle]`,
  `rev-list --count feat/x-middle..HEAD`, and others), and drop the reflog keys
  from the hand-restack fixtures (covers concern 5)

## Merged Concerns

All six concerns share one footprint, `claude/hooks/ship.ts` plus
`claude/hooks/ship.test.ts`, and none of them only consumes another's interface.
They ship as one package. The requirements as written:

### 1. Stale merge base after a restack — TECHNICAL

A restack moves the stack onto `origin/<default>` but never moves the local
default branch. On any later ship — new work, or a retry after a failed push —
`done` is 0, `floor` is unset, and the merge base comes from the base ref, which
picks the **stale local default branch** first. **Result: PR titles and
descriptions describe the merged lower slice and every upstream commit since —
other people's changes.** The plain one-pull-request path after the "one slice
left, forget the stack" case has the same bug.

- **Use `origin/<default>` as base ref and merge base when it descends from the
  local default branch, or when the stack sits on `origin/<default>` and not on
  the local default branch.**
- Otherwise keep today's choice (local default first, then `origin/<default>`).
- Tests: a restacked stack re-shipped with new work, and a retry after a failed
  push, both against a stale local default branch — the writer's log/diff holds
  only the stack's own commits. Same for the single-PR path after the forget.

### 2. Hand-restack lease trusts any reflog sha — TECHNICAL (safety)

Today origin's sha passes as "known" if it appears anywhere in the local
branch's reflog. **Data-loss path: a collaborator pushes X to
`origin/<branch>-b`, the user pulls (X enters the reflog), hand-rebases and
drops X resolving a conflict, and ship force-pushes with lease X — deleting the
collaborator's commit.**

- **Origin's sha passes only if every commit in
  `<recorded top or merge-base>.. <origin sha>`, other than the merged slice's,
  is still represented in the local branch** — same author, author date and
  message (the identity `isRecordedTop` already uses).
- **Otherwise refuse, nothing changed, with the existing "pull or reconcile"
  text.**
- Tests: the collaborator-commit-dropped case refuses and pushes nothing; a hand
  restack that kept every commit still passes.

### 3. Round-1 regression: merged-into-lower-slice refused too eagerly — TECHNICAL

`mergedSlices` refuses any merged lower slice whose PR base is
`<branch>-<lower slice>`, even when that lower slice has since merged into the
default branch — so the change did reach it.

- **Allow a MERGED slice whose base is the branch of a slice already counted as
  merged into the default branch; refuse only when the chain never reaches the
  default branch.**
- README's restack refusal list says it refuses "when that pull request merged
  into another slice branch" — **reword to: merged into a slice branch whose
  chain never reached the default branch.** Check `docs/driver.md` for the same
  claim.
- Tests: slice a → default, slice b → `<branch>-a` (merged), restack proceeds; b
  → `<branch>-a` with a never merged to default still refuses, nothing changed.

### 4. `pushBranch` never pushes fresh when origin lost the branch — TECHNICAL

When `ls-remote` shows origin no longer has the branch, the stored lease key is
unset, but a stale `refs/remotes/origin/<branch>` (no prune) routes the push to
the bare `--force-with-lease` path. **Git rejects it as stale info; the intended
fresh push never happens.**

- **In that case push fresh: `--set-upstream`, no lease.**
- Test: stored lease, origin branch deleted, stale tracking ref present — push
  succeeds and creates the branch.

### 5. Slice branches resolved by bare name — TECHNICAL

`brokenShape`, `strayBranch`, `restacked` and `isRecordedTop` resolve slice
branches by bare name; **a same-named tag wins and the restack reads the wrong
commit.**

- **Use `refs/heads/<b>` everywhere a slice branch is resolved**, these four and
  any other site found while there.
- Test: a tag named like a slice branch, pointing elsewhere, does not change the
  outcome.

### 6. Drop `handRestack`'s unused `merged` parameter — TECHNICAL

Remove it from the signature and every call site. No test needed beyond
typecheck and the existing suite staying green.

## Answered Questions

### Should a re-ship fast-forward the local default branch instead of switching the merge base to `origin/<default>`?

No. The review prescribes the base-ref switch, and ship never moves a branch the
user did not ask it to move.

### Does the hand-restack refusal get new wording?

No. It reuses the existing "pull or reconcile `<branch>`, then ship" text, a
recovery users already know.

### What happens to the three deferred review notes the sketch removed from `.gtd/TODO.md`?

They are dropped. The human deleted them in the entry commit, so they are out of
scope for this round.

### Should `resolveRef` return `refs/remotes/origin/<default>` instead of `origin/<default>`?

No. Bare names keep the user-facing "into origin/main" messages and every
existing scripted key, and concern 5 covers slice branches, not the default
branch.

### Does the hand-restack check still read the reflog?

No. The identity check against `top..origin` (falling back to the merge base)
covers everything the reflog route allowed, and it is the reflog route that lost
the collaborator's commit.

### Does the identity check skip merge commits on origin?

No. A collaborator's merge is a commit the local branch lacks, so refusing there
is the safe side, and the user recovers by reconciling.

### Do tracking refs like `origin/<b>` in `pushBranch` also move to full ref names?

No. Concern 5 is about slice branches shadowed by tags. Rewriting the tracking
ref reads would churn every push test and fix no reported fault.

### Does the `git rebase --update-refs … <branch>` argument become `refs/heads/<branch>`?

No. Rebase switches to that argument by branch name, and the printed by-hand
line users copy must stay runnable as it is.
