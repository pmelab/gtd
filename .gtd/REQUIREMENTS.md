# Requirements: `/gtd ship` restacks after a lower slice merges (pmelab/gtd#383)

## Open Questions

### After a restack conflict, what does the next `/gtd ship` do?

The issue says "stop and print the rebase command". It leaves open what state
the repository is left in, and whether a hand-resolved rebase keeps the stack or
ends it. Today any rebase ends the stack.

- [x] Abort the rebase, print the command; the next ship picks up the
      hand-rebased branches and finishes the restack
  - tree and refs stay exactly as before the ship; no half-done rebase is left
    behind
  - the next ship spots that the remaining slice branches now sit on the default
    branch, then pushes with lease and retargets, and **the stack survives**
  - needs a new rule for spotting a hand restack, plus tests for it
- [ ] Leave the rebase stopped mid-way; the user resolves, runs
      `git rebase --continue`, then `/gtd ship`
  - the user is already in the conflict, so it saves one step
  - **ship leaves the tree dirty and mid-rebase**, breaking ship's "a refusal
    changes nothing" rule
  - the next ship still needs the same rule for spotting a hand restack
- [ ] Abort the rebase, print the command; a hand rebase ends the stack (today's
      behaviour)
  - nothing new to build after the conflict path
  - **with three or more slices, the slices above the conflict lose their own
    pull requests**: the branch then ships alone
- [ ] _your answer_

### What happens to the merged slice's branch after a restack?

The merged lower slice's `<branch>-<slice>` branch is dead once restacked.
Choose whether ship cleans it up or leaves it alone.

- [x] Leave it alone; only drop it from the recorded stack
  - ship never deletes a ref, and nothing that may be wanted is lost
  - stale `<branch>-<slice>` branches pile up locally and possibly on origin
- [ ] Delete the local branch; leave origin alone
  - a tidy local repository; GitHub's own "delete branch on merge" setting
    handles origin
  - deleting a ref is a new kind of write for ship
- [ ] Delete it locally and on origin
  - fully tidy
  - **a `git push --delete` against origin**; a colleague's branch of the same
    name is gone too
- [ ] _your answer_

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
- What the repository looks like afterwards, and what the next `/gtd ship` does,
  follows the first open question
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
