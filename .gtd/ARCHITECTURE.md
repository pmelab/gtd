# Architecture: `/gtd ship` restacks after a lower slice merges (pmelab/gtd#383)

## Open Questions

### A restack conflicts in a run that squashed a process first: does the squash stay?

With a process at HEAD, ship squashes, then restacks. On a conflict the rebase
is aborted either way; the fork is whether HEAD ends on the squash or on the
process's step commits.

- [x] Keep the squash: refs as before the restack, not before the ship
  - the printed `git rebase --onto` moves one squashed commit per slice — the
    hand rebase the human expects
  - the next ship finds no process at HEAD and only restacks
  - breaks the bolded "tree and refs exactly as before the ship" in this one
    case; the failure text says the squash was kept and how to undo it
    (`git reset --soft ORIG_HEAD`)
- [ ] Undo the squash too: `git reset --soft <pre-ship HEAD>` (same tree, so the
      tree stays clean) and delete slice branches this run rebuilt
  - honours "exactly as before the ship" literally
  - the printed command then rebases every gtd step commit of the process; gtd
    must still find its process after its commits were rewritten — untested,
    likely to refuse `The process tip … is not HEAD`
  - the history ref already pushed to origin stays (a later ship re-pushes it,
    forced)
- [ ] _your answer_

## Interfaces

All in `claude/hooks/ship.ts`. `ship()` keeps its signature; its new behaviour
is pinned by the git/gh argv below, which the scripted test repository matches.

```ts
// unchanged signature
export async function ship(
  io: ShipIo,
  isDry: boolean,
  rawMode?: string,
): Promise<Shipped>

// `lease`: origin's sha read by ls-remote before the rebase. Given, the push is
// `git push --force-with-lease=<branch>:<lease> origin <branch>`, never the
// implicit tracking-ref lease. Omitted: today's behaviour. A branch origin
// lacks takes today's `--set-upstream` push either way.
export async function pushBranch(
  io: ShipIo,
  branch: string,
  head?: string, // default "HEAD"
  lease?: string,
): Promise<string | undefined>

// internal, widened
type Link = { name: string; branch: string; commit: string; lease?: string }

type Resumed = {
  links?: Link[]
  floor?: string
  forget?: boolean
  revive?: () => Promise<string | undefined>
  // Set only when a merged lower slice's commit is missing from origin/<default>,
  // or a hand restack was spotted. Read-only until run(); the caller runs it
  // after the squash and revive, so "squash first, then restack" holds.
  restack?: Restack
}

type Restack = {
  onto: string // "origin/<default>"
  from: string // full sha of the topmost merged slice's old commit
  preview: string[] // the -n lines: rebase, each leased push, the retarget
  run(): Promise<{ links: Link[]; floor: string; forget: boolean } | string>
}
```

Git contract, in call order (every read before any write):

```text
git fetch origin <default>                              # skipped by -n
git merge-base --is-ancestor <from> origin/<default>    # 0 = merge commit: no restack
git ls-remote origin refs/heads/<slice-branch>... refs/heads/<branch>
git cat-file -e <origin sha>  +  git merge-base --is-ancestor <origin sha> <local tip>
                                                        # either fails: lease refusal
git rebase --update-refs --onto origin/<default> <from> <branch>
  on failure:  git rev-parse --verify --quiet REBASE_HEAD   # names the slice
               git rebase --abort                           # only when a rebase is in progress
git config --local branch.<branch>.gtdStackTop <new top>    # >1 slice remains
git config --local branch.<branch>.gtdStack "<remaining names>"
git push --force-with-lease=<b>:<origin sha> origin <b>     # per moved branch, bottom up
gh pr edit <lowest remaining #> --base <default>
```

Rules the code holds:

- **Restack trigger**: at least one bottom slice PR `MERGED` (today's
  `mergedSlices`) and `<from>` not an ancestor of `origin/<default>` after the
  fetch. `<from>` is the merged slice's local `<branch>-<slice>` branch, else
  `gtdStackTop~n` — the recorded top object still exists after a rebase.
- **One rebase**: `--update-refs` moves every remaining slice branch with the
  top branch; the merged slice's branch sits at `<from>`, outside the range, and
  is never moved, pushed or deleted. Git older than 2.38 fails the rebase with
  no rebase in progress: ship reports `git rebase failed` with stderr, refs
  unchanged.
- **Lease refusal**: before the rebase, and before any squash or history push.
  Text:
  `origin/<b> holds commits <b> lacks; nothing changed. Pull or reconcile <b>, then ship.`
- **Conflict**: text
  `Slice <name> failed at restack: git rebase conflicted; tree and refs are as before.`
  plus the exact
  `git rebase --update-refs --onto origin/<default> <from> <branch>` line and
  `then /gtd ship`. `<name>` is the slice whose commit `REBASE_HEAD` names (a
  lower slice is one commit; anything else is the top slice).
- **Hand restack**: merged bottom slice(s), `gtdStackTop` not an ancestor of
  HEAD, every remaining slice branch present, the remaining chain valid to HEAD,
  and `<from>` not an ancestor of the lowest remaining branch. Ship then skips
  the rebase, pushes each remaining branch with today's tracking-ref lease, and
  retargets. Today this case drops the stack and ships the branch alone.
- **Record**: written right after the rebase (or on spotting a hand restack),
  before any push: `gtdStack` shrinks to the remaining names, `gtdStackTop`
  becomes the rebased top-slice commit (first commit above the highest remaining
  slice branch). One remaining name: `forget: true`, so today's
  retire-then-forget path ends the stack after the PR step.
- **Merge-commit merge**: no fetch-driven rewrite, no force push, record
  unchanged — exactly today's resume.

## Call Stacks

- `/gtd ship`, no process at HEAD → `register.tsx` `shipNow` → `ship()` →
  `squash()` → `plan()` → `resumable()` → `mergedSlices()` (gh pr view per
  slice) → `topGuard()`/`chain()` → restack reads (fetch, is-ancestor,
  ls-remote) → `revive()` → `Restack.run()` (rebase, git config) →
  `stackPullRequests()` → `shipLink()` → `pushLink()` → `pushBranch(…, lease)` →
  `sliceStep()` (gh pr edit --base)
- `/gtd ship`, process at HEAD → `squash()` → `stackReads()` → `resumable()`
  (same reads, before the history push) → `commitMessages()` →
  `squashOntoStack()` → `pushHistory()` → `commitSquash()` → `revive()` →
  `Restack.run()` → `stackPullRequests()`
- `/gtd ship -n` → `resumable(isDry)` (no fetch, last-fetched
  `origin/<default>`) → `stackPreview()` prints `Restack.preview` before the
  per-slice lines
- conflict → `Restack.run()` → rebase non-zero → `REBASE_HEAD` read →
  `rebase --abort` → failure text; `stackPullRequests()` never runs
- next ship after a hand rebase → `resumable()` → `topGuard()` reports rebased →
  hand-restack rule → record rewrite → `stackPullRequests()`

## E2E Scenarios

No e2e change. The mod has no cucumber tier; `claude/hooks/ship.test.ts`'s
scripted repository is ship's whole suite and stands in, as concern 5 allows.

## Unit Tests

### ship

- unit: claude/hooks/ship.test.ts — two slices, bottom squash-merged: fetch,
  is-ancestor fails, ls-remote, one
  `rebase --update-refs --onto origin/main <from> feat/x`, top pushed with
  `--force-with-lease=feat/x:<sha>`, its PR retargeted to main, stack record
  forgotten (covers 1, 4)
- unit: claude/hooks/ship.test.ts — three slices, bottom merged: the middle
  slice branch moves in the same rebase; `gtdStack` becomes the two remaining
  names and `gtdStackTop` the rebased top commit; middle PR retargeted to main,
  top PR stays on the middle branch (covers 1, 5)
- unit: claude/hooks/ship.test.ts — the merged slice's branch is never moved,
  pushed or deleted: no `branch -D`/`-f`, no push naming it (covers 1)
- unit: claude/hooks/ship.test.ts — merge-commit merge (`<from>` in
  origin/main): no rebase, no force push, retarget only, record unchanged
  (covers 1, 5)
- unit: claude/hooks/ship.test.ts — process at HEAD: history push and squash
  come before the rebase, all in one run (covers 1)
- unit: claude/hooks/ship.test.ts — `-n` prints the rebase command, each leased
  push and the retarget; calls no fetch, rebase, push, `git config` write or
  `gh pr edit` (covers 1, 5)
- unit: claude/hooks/ship.test.ts — origin's copy of a moved branch unknown
  locally, or not an ancestor of it: refusal names the branch and "pull or
  reconcile"; no rebase, push, config write, and with a process at HEAD no
  squash or history push (covers 2, 5)
- unit: claude/hooks/ship.test.ts — the lease is the ls-remote sha even when
  `origin/<b>` differs from it (covers 2)
- unit: claude/hooks/ship.test.ts — a failed fetch refuses, nothing changed
  (covers 4)
- unit: claude/hooks/ship.test.ts — conflict: `rebase --abort` runs, the text
  names the slice from `REBASE_HEAD` and step `restack` and carries the exact
  `git rebase --update-refs --onto …` line; no push, config write or gh write
  (covers 3, 5)
- unit: claude/hooks/ship.test.ts — conflict after a same-run squash ends per
  the open question's answer (covers 3)
- unit: claude/hooks/ship.test.ts — a rebase failing with no rebase in progress
  (old git) reports stderr, runs no abort (covers 4)
- unit: claude/hooks/ship.test.ts — hand restack of a three-slice stack: no
  rebase, each remaining branch pushed with a lease, lowest PR retargeted, stack
  record kept with the remaining names (covers 3, 5)
- unit: claude/hooks/ship.test.ts — a rebased stack with no merged slice still
  drops the record and ships alone (regression of today's rule) (covers 3)

### pushBranch

- unit: claude/hooks/ship.test.ts — with a lease:
  `git push --force-with-lease=<b>:<sha> origin <b>`, no ancestor shortcut; a
  rejection says origin moved, pull or reconcile (covers 2)
- unit: claude/hooks/ship.test.ts — with a lease but no origin copy: today's
  `--set-upstream` push (covers 2)

### Chores

- chore: docs/driver.md — replace the "Squash-merging a lower stacked pull
  request rewrites its commit … (a rebase ends the stack …)" passage with the
  restack, the conflict path and its printed command, the hand-restack pickup,
  and the lease refusal (covers 6)
- chore: README.md — ship summary near `GTD_SHIP_MODE`: re-running `/gtd ship`
  after a lower stacked PR merges restacks the rest (covers 6)

## Merged Concerns

Concerns 1–5 share one footprint, `claude/hooks/ship.ts` and
`claude/hooks/ship.test.ts`, and merge into one package; concern 6
(`docs/driver.md`, `README.md`) stays separate. The merged requirements,
verbatim:

### 1. PRODUCT: Restack on re-ship once a lower slice has merged

Running `/gtd ship` again on a stacked branch, after one or more lower slice
pull requests merged, restacks what is left.

- Spot the merged slices from their pull-request state (`gh pr view`), bottom
  up, as a resume does today
- **Restack only when the merge rewrote the slice's commit** (squash or rebase
  merge): the merged slice's commit is not already in the default branch
- Rebase every remaining slice branch onto the default branch:
  `git rebase --onto <default> <top merged slice's commit> <branch>`, moving the
  slice branches in between with it
- Push each moved branch with a lease, then retarget the lowest remaining pull
  request to the default branch
- **The restacked branches keep their own pull requests**; the stack record
  shrinks to the remaining slices, and it ends when only the top branch remains
- **Leave the merged slice's `<branch>-<slice>` branch alone, locally and on
  origin**: drop it from the recorded stack only; ship deletes no ref
- With a process at HEAD (new work since the last ship), squash it first as
  today, then restack, in the same run
- `/gtd ship -n` prints the planned restack (the rebase, the pushes, the
  retarget) and writes nothing
- The sketch's `.gtd/TODO.md` note pointed at this issue only; it adds no
  requirement of its own

### 2. PRODUCT: Keep the refusal when origin holds commits the branch lacks

- **If origin's copy of any branch the restack moves holds commits the local
  branch lacks, refuse before rebasing; nothing changes**
- The lease must stay meaningful after the fetch the restack needs: lease
  against the commit ship rebased from, not whatever the fetch just wrote into
  `origin/<branch>`
- The refusal message says which branch and to pull or reconcile first

### 3. PRODUCT: Stop on a conflict and print the rebase command

- **A conflicting rebase stops the ship and prints the exact
  `git rebase --onto …` command to run by hand**
- **Abort the rebase before returning: tree and refs stay exactly as before the
  ship**; no half-done rebase is left behind
- The printed command moves the slice branches in between too, so one hand
  rebase restacks the whole stack
- **The next `/gtd ship` spots a hand restack** (the remaining slice branches
  now sit on the default branch), then pushes each with a lease and retargets
  the lowest remaining pull request; **the stack survives**
- Spotting a hand restack is a new rule; it needs its own tests
- The failure names the slice and the step, like other part-way failures

### 4. TECHNICAL: Fetch and the rebase target

- Fetch the default branch before the rebase, and rebase onto
  `origin/<default>`; leave the local default branch alone
- Read the merged slice's old commit from its local slice branch or from the
  recorded stack top (`gtdStackTop`), as a resume does today
- Moving every slice branch in one rebase needs `git rebase --update-refs` (git
  2.38 or newer), or one rebase per branch, bottom up

### 5. TECHNICAL: Tests

- `claude/hooks/ship.test.ts` covers a clean restack, a conflict, and the lease
  refusal (all three named in the issue)
- A conflict leaves tree and refs unchanged; a ship after the printed hand
  rebase finishes the restack and keeps the stack
- Plus a merge-commit merge that skips the rebase, a stack of three or more
  slices, and `-n`
- An `@inmem` cucumber scenario for the restack, per AGENTS.md, unless ship's
  tests already stand in for the mod's features

## Answered Questions

### Does restack cover only the bottom "refactor" slice, or any merged lower slices?

Any merged lower slices; restack rebases from the topmost merged slice's commit,
for stacks of any height.

### Should a merge-commit merge also trigger a rebase and force-push?

No: a merge commit keeps the stack clean, so ship only retargets as today.

### Does restack need a flag or confirmation?

No: re-running `/gtd ship` is the trigger; `-n` previews it.

### What if a lower slice's pull request was closed without merging?

Today's refusal stands: a closed slice needs `GTD_SHIP_MODE=commits`.

### Does restack apply in `commits` mode?

No: commits mode has one pull request and no stack.

### What happens to the three deferred review notes the sketch removed from `.gtd/TODO.md`?

Dropped: the human deleted them in the entry commit.

### After a restack conflict, what does the next `/gtd ship` do?

It picks up the hand-rebased branches, pushes with a lease, retargets, and the
stack survives.

### What happens to the merged slice's branch after a restack?

Left alone locally and on origin; only dropped from the recorded stack.

### One `--update-refs` rebase, or one rebase per branch?

One `--update-refs` rebase: a conflict then needs exactly one printed command,
and verified on git 2.54 it moves the in-between slice branches, leaves the
merged slice's branch at `<from>`, and `rebase --abort` restores every ref.

### What value does the lease carry?

Origin's sha from `git ls-remote`, read before the rebase and checked to be
contained in the local pre-rebase tip; leasing on the pre-rebase tip itself
would always fail the top branch after a same-run squash, whose new commit
origin never saw.

### Does `-n` fetch the default branch?

No: a fetch writes `origin/<default>`, and `-n` writes nothing; it judges
against the last-fetched `origin/<default>`, so a merge-commit merge not yet
fetched previews as a restack the real run then skips.

### How does ship tell a hand restack from an unrelated rebase?

Only with a merged bottom slice whose old commit the lowest remaining branch no
longer contains, every remaining branch present and chaining to HEAD; anything
else keeps today's rule — the stack is dropped and the branch ships alone.

### When is the shrunk stack record written?

Right after the rebase, before any push: a failed push then resumes from a
record that matches the rebased refs instead of a top HEAD no longer contains.

### Does ship remap `prSyncHead` across the rebase?

No: the stored head stops being an ancestor, so the next description refresh
weighs the whole branch once; the writer's usual answer is NO-UPDATE, and a hand
restack offers no old-to-new map to remap with anyway.

### Does old git need a version check?

No: git older than 2.38 rejects `--update-refs`, the rebase fails with no rebase
in progress, and ship reports that stderr with refs unchanged.

### Does the restack need an `@inmem` cucumber scenario?

No: the mod has no cucumber tier; `claude/hooks/ship.test.ts`'s scripted
repository stands in, as concern 5 allows.
