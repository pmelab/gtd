# Requirements: `/gtd ship` restacks after a lower slice merges (pmelab/gtd#383)

## Concerns

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

### 6. PRODUCT: Docs

- `docs/driver.md` ("Inside Claude Code: the gtd mod"): **replace the
  "Squash-merging a lower stacked pull request rewrites its commit … until its
  branch is rebased onto the default branch (a rebase ends the stack …)"
  passage** with the restack behaviour, the conflict path, and the lease refusal
- README: update the ship summary wherever it mentions stacked pull requests

## Answered Questions

### Does restack cover only the bottom "refactor" slice, or any merged lower slices?

Any merged lower slices. The issue was written around a two-slice
refactor/feature stack, but ship's stack is generic over slice names, so restack
rebases from the topmost merged slice's commit and works for stacks of any
height.

### Should a merge-commit merge also trigger a rebase and force-push?

No. A merge commit keeps the stack clean already (the docs say so), so ship only
retargets as today; rewriting and force-pushing then would change nothing for
anyone.

### Does restack need a flag or confirmation?

No. The issue makes re-running `/gtd ship` the trigger; `-n` previews it.

### What if a lower slice's pull request was closed without merging?

Today's refusal stands: a closed slice needs `GTD_SHIP_MODE=commits` to ship the
branch alone.

### Does restack apply in `commits` mode?

No. Commits mode has one pull request and no stack to restack.

### What happens to the three deferred review notes the sketch removed from `.gtd/TODO.md`?

They are dropped. The human deleted them in the entry commit, so they are not
carried into this work.

### After a restack conflict, what does the next `/gtd ship` do?

Ship aborts the rebase and prints the command, leaving tree and refs as before;
the next ship picks up the hand-rebased branches, pushes with a lease,
retargets, and the stack survives.

### What happens to the merged slice's branch after a restack?

Ship leaves it alone, locally and on origin, and only drops it from the recorded
stack.
