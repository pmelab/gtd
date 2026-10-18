# 01 — `/gtd ship` restacks after a lower slice merges (pmelab/gtd#383)

Interfaces, git contract and rules: `.gtd/ARCHITECTURE.md` (`## Interfaces`).
Footprint: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`,
`docs/driver.md`, `README.md`. No e2e change: ship's scripted test repository
stands in for the mod's missing cucumber tier.

## Requirements

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
  tests already stand in for the mod's features (answered: they stand in)

### 6. PRODUCT: Docs

- `docs/driver.md` ("Inside Claude Code: the gtd mod"): **replace the
  "Squash-merging a lower stacked pull request rewrites its commit … until its
  branch is rebased onto the default branch (a rebase ends the stack …)"
  passage** with the restack behaviour, the conflict path, and the lease refusal
- README: update the ship summary wherever it mentions stacked pull requests

## Tasks

Order: lease push first (smallest, consumed by the rest), then the clean
restack, then refusals and conflict, then hand restack, then `-n`, then docs.
Write each task's tests first and watch them fail.

### Task 1: Leased `pushBranch`

**Risk: the lease must be origin's ls-remote sha, never `origin/<b>` — a fetch
rewrites that ref and silently disarms the lease.**

- [ ] `pushBranch(io, branch, head = "HEAD", lease?)`: given `lease`, runs
      `git push --force-with-lease=<b>:<lease> origin <b>` with no ancestor
      shortcut
- [ ] A rejected leased push says origin moved, pull or reconcile
- [ ] `lease` given but origin lacks the branch: today's `--set-upstream` push
- [ ] `lease` omitted: behaviour byte-identical to today; existing tests stay
      green
- [ ] `Link` widens to `{ name; branch; commit; lease? }`; `pushLink()` passes
      `l.lease` through

Paths: `claude/hooks/ship.ts` (`pushBranch`, `Link`, `pushLink`),
`claude/hooks/ship.test.ts`

### Task 2: Clean restack, no process at HEAD

- [ ] `resumable()` returns `restack?: Restack` only when ≥1 bottom slice PR is
      `MERGED` and `<from>` is not an ancestor of `origin/<default>` after
      `git fetch origin <default>`
- [ ] `<from>` = topmost merged slice's local `<branch>-<slice>` branch, else
      `gtdStackTop~n`
- [ ] Reads run before any write, in the contract order: fetch,
      `merge-base --is-ancestor`, `ls-remote` for every moved branch,
      `cat-file -e` + `merge-base --is-ancestor <origin sha> <local tip>`
- [ ] One `git rebase --update-refs --onto origin/<default> <from> <branch>`;
      the local default branch is never touched
- [ ] Record written right after the rebase, before any push: `gtdStack` =
      remaining names, `gtdStackTop` = first commit above the highest remaining
      slice branch; one remaining name → `forget: true` (today's
      retire-then-forget path)
- [ ] Each moved branch pushed bottom up with
      `--force-with-lease=<b>:<ls-remote sha>`; lowest remaining PR gets
      `gh pr edit <#> --base <default>`; upper PRs keep their bases
- [ ] Merged slice's branch never moved, pushed or deleted (no `branch -D`, no
      `branch -f`, no push naming it)
- [ ] Merge-commit merge (`<from>` in `origin/<default>`): no rebase, no force
      push, retarget only, record unchanged
- [ ] Failed fetch refuses; nothing changed
- [ ] `ship()` signature unchanged; `shipNow` in `register.tsx` untouched

Paths: `claude/hooks/ship.ts` (`resumable`, `Resumed`, new `Restack`,
`stackPullRequests`, `sliceStep`), `claude/hooks/ship.test.ts`

### Task 3: Squash first, then restack (process at HEAD)

- [ ] With a process at HEAD, restack reads (incl. lease checks) run in
      `stackReads()` before the history push
- [ ] Order: history push → squash commit → `revive()` → `Restack.run()` →
      `stackPullRequests()`, all in one run
- [ ] Ship records the pre-ship HEAD sha before squashing

Paths: `claude/hooks/ship.ts` (`squash`, `stackReads`, `revive` wiring),
`claude/hooks/ship.test.ts`

### Task 4: Lease refusal

- [ ] Origin's copy of a moved branch unknown locally (`cat-file -e` fails) or
      not an ancestor of the local tip: refuse with exactly
      `origin/<b> holds commits <b> lacks; nothing changed. Pull or reconcile <b>, then ship.`
- [ ] Refusal precedes the rebase, every push and config write, and — with a
      process at HEAD — the squash and history push
- [ ] Lease is the ls-remote sha even when `origin/<b>` differs from it

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### Task 5: Conflict and old git

**Risk: `ORIG_HEAD` after an aborted rebase points at the squash, not the
pre-ship HEAD — print the sha ship read itself.**

- [ ] Rebase non-zero with a rebase in progress: read
      `git rev-parse --verify --quiet REBASE_HEAD`, then `git rebase --abort`
- [ ] Text:
      `Slice <name> failed at restack: git rebase conflicted; tree and refs are as before.`
      plus the exact
      `git rebase --update-refs --onto origin/<default> <from> <branch>` line
      and `then /gtd ship`; `<name>` = the lower slice whose commit
      `REBASE_HEAD` names, else the top slice
- [ ] No push, `git config` write or gh write after a conflict;
      `stackPullRequests()` never runs
- [ ] Conflict after a same-run squash: HEAD stays on the squash, history push
      stays on origin, text adds
      `the squash was kept; undo it with git reset --soft <pre-ship sha>` with
      the real pre-ship HEAD
- [ ] Rebase failing with no rebase in progress (git < 2.38): report
      `git rebase failed` with stderr, run no abort, refs unchanged

Paths: `claude/hooks/ship.ts` (`Restack.run`), `claude/hooks/ship.test.ts`

### Task 6: Hand restack pickup

**Risk: a loose match turns an unrelated rebase into a force push — require
every condition, else keep today's drop-and-ship-alone rule.**

- [ ] Spotted only when: ≥1 merged bottom slice, `gtdStackTop` not an ancestor
      of HEAD, every remaining slice branch present, remaining chain valid to
      HEAD, `<from>` not an ancestor of the lowest remaining branch
- [ ] Then: no rebase; record rewritten (remaining names, new top) before any
      push; each remaining branch pushed with today's tracking-ref lease; lowest
      PR retargeted; stack record kept
- [ ] Follow-up ship after the printed hand rebase (incl. after a kept squash)
      only restacks, stack survives
- [ ] A rebased stack with no merged slice still drops the record and ships
      alone (regression)

Paths: `claude/hooks/ship.ts` (`topGuard`, `chain`, `resumable`),
`claude/hooks/ship.test.ts`

### Task 7: `-n` preview

- [ ] `resumable(isDry)` skips the fetch and judges against last-fetched
      `origin/<default>`
- [ ] `stackPreview()` prints `Restack.preview` (rebase, each leased push, the
      retarget) before the per-slice lines
- [ ] No fetch, rebase, push, `git config` write or `gh pr edit` under `-n`

Paths: `claude/hooks/ship.ts` (`stackPreview`), `claude/hooks/ship.test.ts`

### Task 8: Docs

- [ ] `docs/driver.md`: replace the "Squash-merging a lower stacked pull request
      rewrites its commit … (a rebase ends the stack: ship then ships the branch
      alone) …" passage with: re-ship restacks onto `origin/<default>`, merged
      slice branch left alone, conflict path and its printed command,
      hand-restack pickup, lease refusal
- [ ] `README.md`: ship summary near `GTD_SHIP_MODE` — re-running `/gtd ship`
      after a lower stacked PR merges restacks the rest
- [ ] Neither doc names a `src/*.ts`/`claude/hooks/*.ts` module or internal
      function (AGENTS.md)
- [ ] `docs/**` is a doc-tested input: `npm test` stays green

Paths: `docs/driver.md`, `README.md`

## Verification

- [ ] `npx vitest run --project unit claude/hooks/ship.test.ts` green
- [ ] `npm test` green (full suite, all flag states)

## Tests

- unit: `claude/hooks/ship.test.ts`
